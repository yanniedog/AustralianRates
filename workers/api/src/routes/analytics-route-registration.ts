import type { Context, Hono } from 'hono'
import {
  getCachedOrCompute,
  resolveDefaultChartCacheScope,
  resolveChartDateRangeFromDb,
  type ChartCacheScope,
  type ChartCacheSection,
} from '../db/chart-cache'
import { getCachedOrComputeSnapshot } from '../db/snapshot-cache'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import { buildGroupedChartRows } from '../utils/chart-row-groups'
import { log } from '../utils/logger'
import { withPublicCache } from '../utils/http'
import type { ChartWindow } from '../utils/chart-window'
import {
  parseAnalyticsRepresentation,
  type AnalyticsRepresentation,
} from './analytics-route-utils'
import type { ResolvedAnalyticsRows } from './analytics-data'

const CHART_CACHE_MAX_AGE = 300

type QueryRecord = Record<string, string | undefined>

type AnalyticsDbs = {
  canonicalDb: D1Database
  analyticsDb: D1Database
}

type AnalyticsFilters = Record<string, unknown> & {
  startDate?: string
  endDate?: string
  chartWindow?: ChartWindow | null
}

type AnalyticsResult = Pick<ResolvedAnalyticsRows, 'rows' | 'representation' | 'fallbackReason'>

type AnalyticsRouteOptions<TFilters extends AnalyticsFilters> = {
  section: ChartCacheSection
  buildFilters: (query: QueryRecord) => TFilters
  collectRowsResolved: (
    dbs: AnalyticsDbs,
    representation: AnalyticsRepresentation,
    filters: TFilters,
  ) => Promise<AnalyticsResult>
}

function toQueryParams(input: QueryRecord): QueryRecord {
  const params: QueryRecord = {}
  for (const [key, value] of Object.entries(input)) {
    params[key] = value == null ? undefined : String(value)
  }
  return params
}

function wantsCompactRows(query: QueryRecord): boolean {
  const value = String(query.compact || '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function defaultSnapshotScope(section: ChartCacheSection, params: QueryRecord): ChartCacheScope | null {
  const scope = resolveDefaultChartCacheScope(section, params)
  if (!scope) return null
  if (scope === 'default') return section === 'term_deposits' ? 'window:30D' : 'window:90D'
  if (scope === 'preset:consumer-default') return 'preset:consumer-default:window:90D'
  if (scope === 'window:90D' || scope === 'window:30D' || scope === 'preset:consumer-default:window:90D') {
    return scope
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

async function getPackagedCompactSeries(
  c: Context<AppContext>,
  section: ChartCacheSection,
  representation: AnalyticsRepresentation,
  params: QueryRecord,
): Promise<{ payload: Record<string, unknown>; cache: 'kv' | 'd1' | 'live'; scope: ChartCacheScope } | null> {
  if (!wantsCompactRows(params) || representation !== 'day') return null
  const scope = defaultSnapshotScope(section, params)
  if (!scope) return null
  try {
    const snapshot = await getCachedOrComputeSnapshot(
      c.env,
      section,
      scope,
      async () => {
        throw new Error('snapshot_live_compute_disabled')
      },
      { allowD1Fallback: false, allowLiveCompute: false },
    )
    const entry = asRecord(asRecord(snapshot.data)?.analyticsSeries)
    if (!entry || entry.ok !== true || entry.rows_format !== 'grouped_v1') return null
    return { payload: entry, cache: snapshot.fromCache, scope }
  } catch {
    return null
  }
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function clampAnalyticsFiltersToToday<TFilters extends AnalyticsFilters>(filters: TFilters): TFilters {
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

async function handleAnalyticsRequest<TFilters extends AnalyticsFilters>(
  c: Context<AppContext>,
  options: AnalyticsRouteOptions<TFilters>,
  merged: QueryRecord,
) {
  const requestedRepresentation = parseAnalyticsRepresentation(merged.representation)
  const db = getReadDb(c)
  const dbs = { canonicalDb: db, analyticsDb: db }
  const baseFilters = options.buildFilters(merged)

  const packaged = await getPackagedCompactSeries(c, options.section, requestedRepresentation, toQueryParams(merged))
  if (packaged) {
    withPublicCache(c, CHART_CACHE_MAX_AGE)
    if (c.req.method === 'GET') {
      c.header('X-AR-Cache', packaged.cache)
      c.header('X-AR-Snapshot-Scope', packaged.scope)
      c.header('X-AR-Analytics-Source', 'snapshot')
    }
    return c.json(packaged.payload)
  }

  const seriesStarted = Date.now()
  const result = await getCachedOrCompute(
    c.env,
    options.section,
    requestedRepresentation,
    toQueryParams(merged),
    () =>
      Promise.resolve()
        .then(async () => {
          const resolvedFilters = clampAnalyticsFiltersToToday(
            (
              baseFilters.startDate && baseFilters.endDate
                ? baseFilters
                : (await resolveChartDateRangeFromDb(dbs.canonicalDb, options.section, baseFilters, {
                  window: baseFilters.chartWindow ?? null,
                }))
            ) as TFilters,
          )
          return options.collectRowsResolved(dbs, requestedRepresentation, resolvedFilters)
        })
        .then((rows) => ({
          rows: rows.rows,
          representation: rows.representation,
          fallbackReason: rows.fallbackReason,
        })),
  )
  const seriesElapsedMs = Date.now() - seriesStarted
  if (seriesElapsedMs >= 8000) {
    log.warn('public', 'analytics_series_slow', {
      code: 'analytics_series_slow',
      context: {
        section: options.section,
        representation: requestedRepresentation,
        ms: seriesElapsedMs,
        fromCache: result.fromCache,
        rowCount: result.rows.length,
        compact: wantsCompactRows(merged),
      },
    })
  }
  const compactRows = wantsCompactRows(merged) ? buildGroupedChartRows(result.rows) : null

  withPublicCache(c, CHART_CACHE_MAX_AGE)
  if (c.req.method === 'GET') {
    c.header('X-AR-Cache', result.fromCache)
  }
  return c.json({
    ok: true,
    representation: result.representation,
    requested_representation: requestedRepresentation,
    fallback_reason: result.fallbackReason,
    count: result.rows.length,
    total: result.rows.length,
    rows: compactRows ? [] : result.rows,
    rows_format: compactRows ? 'grouped_v1' : 'flat_v1',
    grouped_rows: compactRows,
  })
}

export function registerAnalyticsRoutes<TFilters extends AnalyticsFilters>(
  publicRoutes: Hono<AppContext>,
  options: AnalyticsRouteOptions<TFilters>,
): void {
  publicRoutes.get('/analytics/series', async (c) =>
    handleAnalyticsRequest(c, options, { ...c.req.query() } as QueryRecord),
  )

  publicRoutes.post('/analytics/pivot', async (c) => {
    const body =
      (await c.req.json<Record<string, string | undefined>>().catch(() => ({}))) as QueryRecord
    return handleAnalyticsRequest(c, options, {
      ...c.req.query(),
      ...body,
    } as QueryRecord)
  })
}
