import type { Context, Hono } from 'hono'
import {
  resolveChartDateRangeFromDb,
  type ChartCacheSection,
} from '../db/chart-cache'
import { getReadDb } from '../db/read-db'
import { getCachedOrComputeReportPlot } from '../db/report-plot-cache'
import { queryReportPlotPayload } from '../db/report-plot'
import type { ReportPlotMode } from '../db/report-plot-types'
import type { AppContext } from '../types'
import { jsonError, withPublicCache } from '../utils/http'
import type { ChartWindow } from '../utils/chart-window'
import { isPublicLiveD1FallbackDisabled } from '../utils/d1-budget'
import { getMelbourneNowParts } from '../utils/time'

const REPORT_PLOT_CACHE_MAX_AGE = 300
const IMPLICIT_BAND_END_DATE_ALIGNED_SECTIONS = new Set<ChartCacheSection>(['term_deposits'])

type QueryRecord = Record<string, string | undefined>
type ReportFilters = Record<string, unknown> & {
  startDate?: string
  endDate?: string
  chartWindow?: ChartWindow | null
}

type ReportPlotRouteOptions<TFilters extends ReportFilters> = {
  section: ChartCacheSection
  buildFilters: (query: QueryRecord) => TFilters
}

function toQueryParams(input: QueryRecord): QueryRecord {
  const params: QueryRecord = {}
  for (const [key, value] of Object.entries(input)) {
    params[key] = value == null ? undefined : String(value)
  }
  return params
}

export function todayYmd(): string {
  return getMelbourneNowParts().date
}

export function clampFiltersToToday<TFilters extends ReportFilters>(filters: TFilters): TFilters {
  const today = todayYmd()
  const startDate = typeof filters.startDate === 'string' ? filters.startDate.trim() : ''
  const rawEndDate = typeof filters.endDate === 'string' ? filters.endDate.trim() : ''
  const endDate = !rawEndDate || rawEndDate > today ? today : rawEndDate
  const nextStartDate = startDate && startDate <= endDate ? startDate : endDate
  return {
    ...filters,
    startDate: nextStartDate,
    endDate,
  }
}

function parseReportPlotMode(value: string | undefined): ReportPlotMode | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'moves' || normalized === 'bands') return normalized
  return null
}

function hasExplicitEndDate(query: QueryRecord): boolean {
  return typeof query.end_date === 'string' && query.end_date.trim().length > 0
}

function addCalendarDaysUtcYmd(ymd: string, deltaDays: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + deltaDays * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

function shouldAlignImplicitBandEndDate(section: ChartCacheSection, mode: ReportPlotMode, query: QueryRecord): boolean {
  return IMPLICIT_BAND_END_DATE_ALIGNED_SECTIONS.has(section) && mode === 'bands' && !hasExplicitEndDate(query)
}

export function alignTdImplicitBandEndDateToToday<TFilters extends ReportFilters>(
  filters: TFilters,
  section: ChartCacheSection,
  mode: ReportPlotMode,
  query: QueryRecord,
  today: string,
): TFilters {
  if (!shouldAlignImplicitBandEndDate(section, mode, query)) return filters
  if (filters.endDate === today) return filters
  const endDate = typeof filters.endDate === 'string' && filters.endDate.trim()
    ? filters.endDate.trim()
    : today
  const rawStartDate = typeof filters.startDate === 'string' && filters.startDate.trim()
    ? filters.startDate.trim()
    : endDate
  const deltaMs = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${endDate}T00:00:00Z`)
  const deltaDays = Math.max(0, Math.round(deltaMs / 86400000))
  const startDate = addCalendarDaysUtcYmd(rawStartDate, deltaDays)
  return {
    ...filters,
    startDate: startDate <= today ? startDate : today,
    endDate: today,
  }
}

function buildReportPlotCacheParams(
  query: QueryRecord,
  section: ChartCacheSection,
  mode: ReportPlotMode,
  effectiveFilters: ReportFilters,
): QueryRecord {
  const params = toQueryParams(query)
  if (shouldAlignImplicitBandEndDate(section, mode, query) && typeof effectiveFilters.endDate === 'string') {
    params.__implicit_end_date = effectiveFilters.endDate
  }
  return params
}

async function handleReportPlotRequest<TFilters extends ReportFilters>(
  c: Context<AppContext>,
  options: ReportPlotRouteOptions<TFilters>,
  merged: QueryRecord,
) {
  const mode = parseReportPlotMode(merged.mode)
  if (!mode) {
    return c.json({
      ok: false,
      error: {
        code: 'INVALID_REPORT_PLOT_MODE',
        message: 'Mode must be "moves" or "bands".',
      },
    }, 400)
  }

  const filterQuery = {
    ...merged,
    mode: merged.dataset_mode,
  }
  const baseFilters = options.buildFilters(filterQuery)
  const resolvedFilters = clampFiltersToToday(
    (
      baseFilters.startDate && baseFilters.endDate
        ? baseFilters
        : (await resolveChartDateRangeFromDb(getReadDb(c), options.section, baseFilters, {
          window: baseFilters.chartWindow ?? null,
        }))
    ) as TFilters,
  )
  const effectiveFilters = alignTdImplicitBandEndDateToToday(resolvedFilters, options.section, mode, merged, todayYmd())
  const cacheParams = buildReportPlotCacheParams(merged, options.section, mode, effectiveFilters)

  const liveAllowed = !(await isPublicLiveD1FallbackDisabled(c.env))
  let payload: Awaited<ReturnType<typeof getCachedOrComputeReportPlot>>
  try {
    payload = await getCachedOrComputeReportPlot(
      c.env,
      options.section,
      mode,
      cacheParams,
      () => queryReportPlotPayload(getReadDb(c), options.section, mode, effectiveFilters),
      { allowLiveCompute: liveAllowed },
    )
  } catch (error) {
    if (!liveAllowed) {
      return jsonError(
        c,
        503,
        'PUBLIC_LIVE_D1_FALLBACK_DISABLED',
        'Live report chart data is temporarily restricted by D1 usage guardrails. Cached data will be served when available.',
      )
    }
    throw error
  }

  withPublicCache(c, REPORT_PLOT_CACHE_MAX_AGE)
  c.header('X-AR-Cache', payload.fromCache)
  return c.json({
    ok: true,
    ...payload,
  })
}

export function registerReportPlotRoutes<TFilters extends ReportFilters>(
  publicRoutes: Hono<AppContext>,
  options: ReportPlotRouteOptions<TFilters>,
): void {
  publicRoutes.get('/analytics/report-plot', async (c) =>
    handleReportPlotRequest(c, options, { ...c.req.query() } as QueryRecord),
  )
}
