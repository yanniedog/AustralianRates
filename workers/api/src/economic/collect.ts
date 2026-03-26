import { getEconomicStatusMap, upsertEconomicObservations, upsertEconomicStatus } from '../db/economic-series'
import type { EnvBindings } from '../types'
import { RBA_GOV_AU_FETCH_INIT, fetchWithTimeout, hostFromUrl } from '../utils/fetch-with-timeout'
import { log } from '../utils/logger'
import {
  ECONOMIC_SERIES_DEFINITIONS,
  type EconomicSeriesDefinition,
  type EconomicSeriesId,
} from './registry'
import { addDays } from './parser-utils'
import { parseFedTargetHistoryHtml, parseFredChinaGdpProxyCsv, parseRbnzOcrText } from './external-parsers'
import { extractRbaSeriesObservations, parseRbaTableCsv, type EconomicObservationInput, type ParsedRbaTable } from './rba-table'

type CollectionSummary = {
  ok: boolean
  checked_at: string
  updated_series: string[]
  stale_series: string[]
  failed_series: string[]
}

function sortObservations(rows: EconomicObservationInput[]): EconomicObservationInput[] {
  return rows.slice().sort((left, right) => left.observationDate.localeCompare(right.observationDate))
}

function latestObservation(rows: EconomicObservationInput[]) {
  if (rows.length === 0) return null
  return sortObservations(rows)[rows.length - 1]
}

function shouldMarkStale(definition: EconomicSeriesDefinition, lastObservationDate: string | null, checkedDate: string): boolean {
  if (!lastObservationDate) return true
  return addDays(lastObservationDate, definition.staleAfterDays) < checkedDate
}

function shouldUpsertRows(
  definition: EconomicSeriesDefinition,
  rows: EconomicObservationInput[],
  previousStatus: { last_observation_date: string | null; last_value: number | null } | undefined,
): EconomicObservationInput[] {
  if (rows.length === 0) return []
  if (!previousStatus?.last_observation_date) return rows

  const latest = latestObservation(rows)
  if (!latest) return []
  if (
    previousStatus.last_observation_date === latest.observationDate &&
    previousStatus.last_value != null &&
    Number(previousStatus.last_value) === latest.value
  ) {
    return []
  }

  if (definition.frequency !== 'daily') return rows
  const cutoff = addDays(previousStatus.last_observation_date, -30)
  return rows.filter((row) => row.observationDate >= cutoff)
}

function requestInitForUrl(url: string): RequestInit | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === 'www.rba.gov.au' || host.endsWith('.rba.gov.au')) {
      return RBA_GOV_AU_FETCH_INIT
    }
  } catch {
    /* invalid url */
  }
  return undefined
}

async function fetchText(url: string, env: EnvBindings, sourceCode: string): Promise<string> {
  const fetched = await fetchWithTimeout(url, requestInitForUrl(url), { env })
  log.info('economic', 'upstream_fetch', {
    context:
      `source=${sourceCode} host=${hostFromUrl(url)}` +
      ` elapsed_ms=${fetched.meta.elapsed_ms}` +
      ` attempts=${fetched.meta.attempts}` +
      ` status=${fetched.meta.status ?? fetched.response.status}`,
  })
  if (!fetched.response.ok) {
    throw new Error(`upstream_not_ok:${fetched.response.status}:${url}`)
  }
  return fetched.response.text()
}

async function fetchTextWithFallback(
  primaryUrl: string,
  fallbackUrl: string | undefined,
  env: EnvBindings,
  sourceCode: string,
): Promise<string> {
  try {
    return await fetchText(primaryUrl, env, sourceCode)
  } catch (error) {
    if (!fallbackUrl || fallbackUrl === primaryUrl) throw error
    log.warn('economic', 'Primary upstream fetch failed; retrying fallback transport', {
      code: 'economic_series_fetch_failed',
      context: JSON.stringify({
        source: sourceCode,
        primary_url: primaryUrl,
        fallback_url: fallbackUrl,
        message: (error as Error)?.message ?? String(error),
      }),
    })
    return fetchText(fallbackUrl, env, sourceCode)
  }
}

async function persistSeries(
  env: EnvBindings,
  definition: EconomicSeriesDefinition,
  rows: EconomicObservationInput[],
  checkedAt: string,
  previousStatus: { last_observation_date: string | null; last_value: number | null } | undefined,
): Promise<{ updated: boolean; stale: boolean }> {
  const sorted = sortObservations(rows)
  const latest = sorted[sorted.length - 1] ?? null
  const checkedDate = checkedAt.slice(0, 10)
  const stale = shouldMarkStale(definition, latest?.observationDate ?? null, checkedDate)
  const rowsToUpsert = shouldUpsertRows(definition, sorted, previousStatus)

  if (rowsToUpsert.length > 0) {
    await upsertEconomicObservations(env.DB, rowsToUpsert)
  }

  if (stale) {
    log.warn('economic', 'Economic series is stale', {
      code: 'economic_series_stale',
      context: JSON.stringify({
        series_id: definition.id,
        source_url: definition.sourceUrl,
        last_observation_date: latest?.observationDate ?? null,
      }),
    })
  }

  await upsertEconomicStatus(env.DB, {
    seriesId: definition.id,
    lastCheckedAt: checkedAt,
    lastSuccessAt: checkedAt,
    lastObservationDate: latest?.observationDate ?? null,
    lastValue: latest?.value ?? null,
    status: stale ? 'stale' : 'ok',
    message: stale
      ? `Latest observation ${latest?.observationDate ?? 'missing'} is older than the freshness threshold.`
      : rowsToUpsert.length > 0
        ? `Upserted ${rowsToUpsert.length} observation(s).`
        : 'Source checked; no new observations.',
    sourceUrl: definition.sourceUrl,
    proxy: definition.proxy,
  })

  return { updated: rowsToUpsert.length > 0, stale }
}

async function markSeriesFailure(env: EnvBindings, definition: EconomicSeriesDefinition, checkedAt: string, error: unknown) {
  log.warn('economic', 'Economic series collection failed', {
    code: 'economic_series_fetch_failed',
    context: JSON.stringify({
      series_id: definition.id,
      source_url: definition.sourceUrl,
      message: (error as Error)?.message ?? String(error),
    }),
  })
  const previous = (await getEconomicStatusMap(env.DB, [definition.id])).get(definition.id)
  await upsertEconomicStatus(env.DB, {
    seriesId: definition.id,
    lastCheckedAt: checkedAt,
    lastSuccessAt: previous?.last_success_at ?? null,
    lastObservationDate: previous?.last_observation_date ?? null,
    lastValue: previous?.last_value ?? null,
    status: 'error',
    message: (error as Error)?.message ?? String(error),
    sourceUrl: definition.sourceUrl,
    proxy: definition.proxy,
  })
}

async function loadRbaTable(
  env: EnvBindings,
  cache: Map<string, ParsedRbaTable>,
  url: string,
): Promise<ParsedRbaTable> {
  const cached = cache.get(url)
  if (cached) return cached
  const text = await fetchText(url, env, 'economic_rba_csv')
  const parsed = parseRbaTableCsv(text, url)
  cache.set(url, parsed)
  return parsed
}

async function collectRbaSeries(
  env: EnvBindings,
  cache: Map<string, ParsedRbaTable>,
  definition: EconomicSeriesDefinition,
) {
  if (definition.collector.kind !== 'rba_csv') return []
  const table = await loadRbaTable(env, cache, definition.collector.url)
  return extractRbaSeriesObservations(table, definition.id, definition.collector.seriesId, definition.proxy, {
    source_label: definition.sourceLabel,
  })
}

async function collectLendingProxy(
  env: EnvBindings,
  cache: Map<string, ParsedRbaTable>,
  definition: EconomicSeriesDefinition,
) {
  if (definition.collector.kind !== 'rba_lending_proxy') return []
  const housingTable = await loadRbaTable(env, cache, definition.collector.housingUrl)
  const businessTable = await loadRbaTable(env, cache, definition.collector.businessUrl)
  const housingRows = extractRbaSeriesObservations(
    housingTable,
    definition.id,
    definition.collector.housingSeriesId,
    definition.proxy,
    { component: 'housing_discounted_owner_occupier' },
  )
  const businessRows = extractRbaSeriesObservations(
    businessTable,
    definition.id,
    definition.collector.businessSeriesId,
    definition.proxy,
    { component: 'small_business_total' },
  )

  const dates = Array.from(
    new Set([...housingRows.map((row) => row.observationDate), ...businessRows.map((row) => row.observationDate)]),
  ).sort()
  const housingByDate = new Map(housingRows.map((row) => [row.observationDate, row]))
  const businessByDate = new Map(businessRows.map((row) => [row.observationDate, row]))

  let latestHousing: EconomicObservationInput | null = null
  let latestBusiness: EconomicObservationInput | null = null
  const combined: EconomicObservationInput[] = []

  for (const date of dates) {
    latestHousing = housingByDate.get(date) ?? latestHousing
    latestBusiness = businessByDate.get(date) ?? latestBusiness
    if (!latestHousing || !latestBusiness) continue
    combined.push({
      seriesId: definition.id,
      observationDate: date,
      value: Number((((latestHousing.value + latestBusiness.value) / 2)).toFixed(3)),
      sourceUrl: definition.sourceUrl,
      releaseDate: [latestHousing.releaseDate, latestBusiness.releaseDate].filter(Boolean).sort().slice(-1)[0] ?? date,
      frequency: 'monthly',
      proxy: true,
      notesJson: JSON.stringify({
        housing_rate: latestHousing.value,
        business_rate: latestBusiness.value,
      }),
    })
  }

  return combined
}

async function collectRbnzSeries(env: EnvBindings, definition: EconomicSeriesDefinition) {
  if (definition.collector.kind !== 'rbnz_ocr_history') return []
  const text = await fetchTextWithFallback(
    definition.collector.url,
    definition.collector.transportUrl,
    env,
    'economic_rbnz_ocr',
  )
  return parseRbnzOcrText(text, definition.id, definition.sourceUrl, definition.proxy)
}

async function collectFedSeries(env: EnvBindings, definition: EconomicSeriesDefinition) {
  if (definition.collector.kind !== 'fed_target_history') return []
  const html = await fetchTextWithFallback(
    definition.collector.url,
    definition.collector.transportUrl,
    env,
    'economic_fed_target',
  )
  return parseFedTargetHistoryHtml(html, definition.id, definition.sourceUrl, definition.proxy)
}

async function collectFredSeries(env: EnvBindings, definition: EconomicSeriesDefinition) {
  if (definition.collector.kind !== 'fred_csv') return []
  const csv = await fetchText(definition.collector.url, env, 'economic_fred_proxy')
  if (definition.collector.valueMode === 'china_yoy_from_level') {
    return parseFredChinaGdpProxyCsv(csv, definition.id, definition.sourceUrl, definition.proxy)
  }
  return []
}

async function collectSeriesRows(
  env: EnvBindings,
  cache: Map<string, ParsedRbaTable>,
  definition: EconomicSeriesDefinition,
): Promise<EconomicObservationInput[]> {
  switch (definition.collector.kind) {
    case 'rba_csv':
      return collectRbaSeries(env, cache, definition)
    case 'rba_lending_proxy':
      return collectLendingProxy(env, cache, definition)
    case 'rbnz_ocr_history':
      return collectRbnzSeries(env, definition)
    case 'fed_target_history':
      return collectFedSeries(env, definition)
    case 'fred_csv':
      return collectFredSeries(env, definition)
  }
}

export async function collectEconomicSeries(env: EnvBindings): Promise<CollectionSummary> {
  const checkedAt = new Date().toISOString()
  const statusMap = await getEconomicStatusMap(env.DB, ECONOMIC_SERIES_DEFINITIONS.map((definition) => definition.id))
  const rbaCache = new Map<string, ParsedRbaTable>()
  const updatedSeries: string[] = []
  const staleSeries: string[] = []
  const failedSeries: string[] = []

  for (const definition of ECONOMIC_SERIES_DEFINITIONS) {
    try {
      const rows = await collectSeriesRows(env, rbaCache, definition)
      if (rows.length === 0) {
        throw new Error(`No parseable observations for ${definition.id}`)
      }
      const persisted = await persistSeries(env, definition, rows, checkedAt, statusMap.get(definition.id))
      if (persisted.updated) updatedSeries.push(definition.id)
      if (persisted.stale) staleSeries.push(definition.id)
    } catch (error) {
      failedSeries.push(definition.id)
      await markSeriesFailure(env, definition, checkedAt, error)
      log.warn('economic', 'Economic series parsing failed', {
        code: 'economic_series_parse_failed',
        context: JSON.stringify({
          series_id: definition.id,
          message: (error as Error)?.message ?? String(error),
        }),
      })
    }
  }

  return {
    ok: failedSeries.length === 0,
    checked_at: checkedAt,
    updated_series: updatedSeries,
    stale_series: staleSeries,
    failed_series: failedSeries,
  }
}

export function defaultEconomicSeriesIds(): EconomicSeriesId[] {
  return ['unemployment_rate', 'trimmed_mean_cpi', 'inflation_expectations', 'neutral_rate', 'bank_bill_90d']
}
