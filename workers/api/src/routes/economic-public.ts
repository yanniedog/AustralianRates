import { Hono } from 'hono'
import { getEconomicObservationsForSeries, getEconomicStatusMap, expandEconomicObservationsDaily } from '../db/economic-series'
import { buildDerivedEconomicSeries } from '../economic/derived-series'
import { buildRbaSignals } from '../economic/rba-signals'
import { ECONOMIC_PRESETS, ECONOMIC_SERIES_DEFINITIONS, getEconomicPreset, getEconomicSeriesDefinition, groupEconomicSeriesByCategory, isDerivedEconomicSeries } from '../economic/registry'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import { jsonError, withPublicCache } from '../utils/http'
import { registerDebugLogRoutes } from './debug-log'
import { registerDoctorSchedulePublicRoute } from './doctor-schedule-public'
import { registerSiteUiPublicRoute } from './site-ui-public'

const DEFAULT_LOOKBACK_YEARS = 5
const MAX_SERIES_PER_REQUEST = 12
const ECONOMIC_STALE_DAYS_BY_FREQUENCY: Record<string, number> = {
  daily: 10,
  weekly: 21,
  monthly: 120,
  quarterly: 220,
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function clampDateRange(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const today = todayIso()
  const nextEndDate = endDate > today ? today : endDate
  const nextStartDate = startDate > nextEndDate ? nextEndDate : startDate
  return { startDate: nextStartDate, endDate: nextEndDate }
}

function shiftYears(isoDate: string, years: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  date.setUTCFullYear(date.getUTCFullYear() + years)
  return date.toISOString().slice(0, 10)
}

function isIsoDate(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function splitCsv(value: string | null | undefined): string[] {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function resolveSeriesIds(idsParam: string | null | undefined, presetParam: string | null | undefined): string[] {
  const requested = splitCsv(idsParam).filter((id) => !!getEconomicSeriesDefinition(id))
  if (requested.length > 0) return requested.slice(0, MAX_SERIES_PER_REQUEST)
  const preset = presetParam ? getEconomicPreset(presetParam) : getEconomicPreset('rba_watchlist')
  return (preset?.seriesIds || []).slice(0, MAX_SERIES_PER_REQUEST)
}

function statusPayload(
  status:
    | {
        last_checked_at: string
        last_success_at: string | null
        last_observation_date: string | null
        last_value: number | null
        status: string
        message: string | null
      }
    | undefined,
) {
  return status
    ? {
        last_checked_at: status.last_checked_at,
        last_success_at: status.last_success_at,
        last_observation_date: status.last_observation_date,
        last_value: status.last_value,
        status: status.status,
        message: status.message,
      }
    : null
}

function daysBetweenIso(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`)
  const endMs = Date.parse(`${end}T00:00:00.000Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  return Math.max(0, Math.floor((endMs - startMs) / 86400000))
}

function economicSeriesQuarantineStatus(
  status:
    | {
        last_observation_date: string | null
        status: string
      }
    | undefined,
  frequency: string,
  endDate: string,
): { quarantined: boolean; reason: string | null } {
  if (!status) return { quarantined: true, reason: 'missing_status' }
  if (status.status !== 'ok') {
    return { quarantined: true, reason: `status_${String(status.status || 'unknown')}` }
  }
  if (!status.last_observation_date) {
    return { quarantined: true, reason: 'missing_observation' }
  }
  const maxStaleDays = ECONOMIC_STALE_DAYS_BY_FREQUENCY[frequency] ?? 120
  const staleDays = daysBetweenIso(status.last_observation_date, endDate)
  if (staleDays > maxStaleDays) {
    return { quarantined: true, reason: `stale_${staleDays}d` }
  }
  return { quarantined: false, reason: null }
}

function shouldExcludeEconomicSeriesFromPublic(
  status:
    | {
        last_observation_date: string | null
        status: string
      }
    | undefined,
  frequency: string,
  endDate: string,
): boolean {
  if (!status) return false
  return economicSeriesQuarantineStatus(status, frequency, endDate).quarantined
}

export const economicPublicRoutes = new Hono<AppContext>()

registerDebugLogRoutes(economicPublicRoutes)
registerSiteUiPublicRoute(economicPublicRoutes)
registerDoctorSchedulePublicRoute(economicPublicRoutes)

economicPublicRoutes.get('/health', async (c) => {
  withPublicCache(c, 30)
  return c.json({
    ok: true,
    service: 'economic-data',
    api_base_path: '/api/economic-data',
    series_count: ECONOMIC_SERIES_DEFINITIONS.length,
    preset_count: ECONOMIC_PRESETS.length,
  })
})

economicPublicRoutes.get('/catalog', async (c) => {
  withPublicCache(c, 3600)
  const statusMap = await getEconomicStatusMap(getReadDb(c))
  const endDate = todayIso()
  const categories = groupEconomicSeriesByCategory().map((category) => ({
    id: category.id,
    label: category.label,
    series: category.series.map((definition) => ({
      id: definition.id,
      label: definition.label,
      short_label: definition.shortLabel,
      category: definition.category,
      unit: definition.unit,
      frequency: definition.frequency,
      proxy: definition.proxy,
      source_label: definition.sourceLabel,
      source_url: definition.sourceUrl,
      description: definition.description,
      presets: definition.presets,
      freshness: statusPayload(statusMap.get(definition.id)),
      quarantine: economicSeriesQuarantineStatus(statusMap.get(definition.id), definition.frequency, endDate),
    })),
  }))

  return c.json({
    ok: true,
    generated_at: new Date().toISOString(),
    presets: ECONOMIC_PRESETS,
    categories,
  })
})

economicPublicRoutes.get('/signals', async (c) => {
  withPublicCache(c, 300)
  return c.json(await buildRbaSignals(getReadDb(c)))
})

economicPublicRoutes.get('/series', async (c) => {
  withPublicCache(c, 300)
  const ids = resolveSeriesIds(c.req.query('ids'), c.req.query('preset'))
  if (ids.length === 0) {
    return jsonError(c, 400, 'INVALID_SERIES', 'No valid economic series were requested.')
  }

  const requestedEndDate = c.req.query('end_date') || c.req.query('endDate') || todayIso()
  const requestedStartDate =
    c.req.query('start_date') || c.req.query('startDate') || shiftYears(requestedEndDate, -DEFAULT_LOOKBACK_YEARS)
  if (!isIsoDate(requestedStartDate) || !isIsoDate(requestedEndDate) || requestedStartDate > requestedEndDate) {
    return jsonError(c, 400, 'INVALID_DATE_RANGE', 'Dates must be YYYY-MM-DD and start_date must be on or before end_date.')
  }
  const { startDate, endDate } = clampDateRange(requestedStartDate, requestedEndDate)

  const statusMap = await getEconomicStatusMap(getReadDb(c), ids)
  const series = await Promise.all(
    ids.map(async (id) => {
      const definition = getEconomicSeriesDefinition(id)
      if (!definition) return null
      const quarantine = economicSeriesQuarantineStatus(statusMap.get(id), definition.frequency, endDate)
      if (shouldExcludeEconomicSeriesFromPublic(statusMap.get(id), definition.frequency, endDate)) return null
      const expanded = isDerivedEconomicSeries(definition)
        ? await buildDerivedEconomicSeries(getReadDb(c), definition, startDate, endDate)
        : expandEconomicObservationsDaily(
            await getEconomicObservationsForSeries(getReadDb(c), id, startDate, endDate),
            startDate,
            endDate,
          )
      return {
        id: definition.id,
        label: definition.label,
        short_label: definition.shortLabel,
        category: definition.category,
        unit: definition.unit,
        frequency: definition.frequency,
        proxy: definition.proxy,
        source_label: definition.sourceLabel,
        source_url: definition.sourceUrl,
        description: definition.description,
        presets: definition.presets,
        freshness: statusPayload(statusMap.get(id)),
        quarantine,
        baseline_date: expanded.baselineDate,
        baseline_value: expanded.baselineValue,
        points: expanded.points,
      }
    }),
  )

  return c.json({
    ok: true,
    start_date: startDate,
    end_date: endDate,
    normalized_compare: true,
    series: series.filter(Boolean),
  })
})
