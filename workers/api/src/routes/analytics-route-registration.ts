import type { Context, Hono } from 'hono'
import {
  getCachedOrCompute,
  resolveChartDateRangeFromDb,
  type ChartCacheSection,
} from '../db/chart-cache'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import { buildGroupedChartRows } from '../utils/chart-row-groups'
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

async function handleAnalyticsRequest<TFilters extends AnalyticsFilters>(
  c: Context<AppContext>,
  options: AnalyticsRouteOptions<TFilters>,
  merged: QueryRecord,
) {
  const requestedRepresentation = parseAnalyticsRepresentation(merged.representation)
  const dbs = { canonicalDb: c.env.DB, analyticsDb: getReadDb(c.env) }
  const baseFilters = options.buildFilters(merged)
  const resolvedFilters =
    baseFilters.startDate && baseFilters.endDate
      ? baseFilters
      : (await resolveChartDateRangeFromDb(dbs.canonicalDb, options.section, baseFilters, {
          window: baseFilters.chartWindow ?? null,
        })) as TFilters

  const result = await getCachedOrCompute(
    c.env,
    options.section,
    requestedRepresentation,
    toQueryParams(merged),
    () =>
      options.collectRowsResolved(dbs, requestedRepresentation, resolvedFilters).then((rows) => ({
        rows: rows.rows,
        representation: rows.representation,
        fallbackReason: rows.fallbackReason,
      })),
  )
  const compactRows = wantsCompactRows(merged) ? buildGroupedChartRows(result.rows) : null

  withPublicCache(c, CHART_CACHE_MAX_AGE)
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
