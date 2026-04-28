import type { Context, Hono } from 'hono'
import { resolveChartDateRangeFromDb, type ChartCacheSection } from '../db/chart-cache'
import { getReadDb } from '../db/read-db'
import { getCachedOrComputeSlicePairStats } from '../db/slice-pair-cache'
import {
  queryHomeLoanSlicePairStats,
  querySavingsSlicePairStats,
  queryTdSlicePairStats,
  type SlicePairStatsCounts,
  type SlicePairStatsPayload,
} from '../db/slice-pair-stats'
import type { LatestFilters } from '../db/home-loans/shared'
import type { LatestSavingsFilters } from '../db/savings/shared'
import type { LatestTdFilters } from '../db/term-deposits/shared'
import type { AppContext } from '../types'
import { jsonError, withPublicCache } from '../utils/http'
import { isPublicLiveD1FallbackDisabled } from '../utils/d1-budget'
import type { ChartWindow } from '../utils/chart-window'
import { clampFiltersToToday, todayYmd } from './report-plot-route-registration'

const SLICE_PAIR_CACHE_MAX_AGE = 300

type QueryRecord = Record<string, string | undefined>
type ReportFilters = Record<string, unknown> & {
  startDate?: string
  endDate?: string
  chartWindow?: ChartWindow | null
}

export type SlicePairRouteOptions = {
  section: ChartCacheSection
  buildChartFilters: (query: QueryRecord) => ReportFilters
  buildLatestFilters: (merged: QueryRecord) => LatestFilters | LatestSavingsFilters | LatestTdFilters
}

function toQueryParams(input: QueryRecord): QueryRecord {
  const params: QueryRecord = {}
  for (const [key, value] of Object.entries(input)) {
    params[key] = value == null ? undefined : String(value)
  }
  return params
}

/** Calendar previous day in UTC, matching SQLite `date(D, '-1 day')` for YYYY-MM-DD. */
export function previousCalendarUtcDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid_calendar_day:${ymd}`)
  }
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function querySlicePairStatsForSection(
  db: D1Database,
  section: ChartCacheSection,
  latest: LatestFilters | LatestSavingsFilters | LatestTdFilters,
  pYmd: string,
  dYmd: string,
): Promise<SlicePairStatsCounts> {
  if (section === 'home_loans') {
    return queryHomeLoanSlicePairStats(db, latest as LatestFilters, pYmd, dYmd)
  }
  if (section === 'savings') {
    return querySavingsSlicePairStats(db, latest as LatestSavingsFilters, pYmd, dYmd)
  }
  return queryTdSlicePairStats(db, latest as LatestTdFilters, pYmd, dYmd)
}

async function handleSlicePairStatsRequest(
  c: Context<AppContext>,
  options: SlicePairRouteOptions,
  merged: QueryRecord,
) {
  const filterQuery = {
    ...merged,
    mode: merged.dataset_mode,
  }
  const baseFilters = options.buildChartFilters(filterQuery)
  const resolvedFilters = clampFiltersToToday(
    (
      baseFilters.startDate && baseFilters.endDate
        ? baseFilters
        : (await resolveChartDateRangeFromDb(getReadDb(c), options.section, baseFilters, {
          window: baseFilters.chartWindow ?? null,
        }))
    ) as typeof baseFilters,
  )

  const endRaw = typeof resolvedFilters.endDate === 'string' ? resolvedFilters.endDate.trim() : ''
  const dYmd = endRaw && /^\d{4}-\d{2}-\d{2}$/.test(endRaw) ? endRaw : todayYmd()
  const pYmd = previousCalendarUtcDay(dYmd)

  const latestFilters = options.buildLatestFilters({
    ...merged,
    mode: merged.dataset_mode,
  })

  const liveAllowed = !(await isPublicLiveD1FallbackDisabled(c.env))
  let payload: SlicePairStatsPayload & { fromCache: 'kv' | 'live' }
  try {
    payload = await getCachedOrComputeSlicePairStats(
      c.env,
      options.section,
      toQueryParams(merged),
      async () => {
        const counts = await querySlicePairStatsForSection(
          getReadDb(c),
          options.section,
          latestFilters,
          pYmd,
          dYmd,
        )
        const data: SlicePairStatsPayload = {
          ...counts,
          section: options.section,
          d: dYmd,
          p: pYmd,
        }
        return data
      },
      { allowLiveCompute: liveAllowed },
    )
  } catch (error) {
    if (!liveAllowed) {
      return jsonError(
        c,
        503,
        'PUBLIC_LIVE_D1_FALLBACK_DISABLED',
        'Live slice-pair stats are temporarily restricted by D1 usage guardrails. Cached data will be served when available.',
      )
    }
    throw error
  }

  const { fromCache, ...data } = payload
  withPublicCache(c, SLICE_PAIR_CACHE_MAX_AGE)
  c.header('X-AR-Cache', fromCache)
  return c.json({
    ok: true,
    data,
  })
}

export function registerSlicePairStatsRoutes(
  publicRoutes: Hono<AppContext>,
  options: SlicePairRouteOptions,
): void {
  publicRoutes.get('/analytics/slice-pair-stats', async (c) =>
    handleSlicePairStatsRequest(c, options, { ...c.req.query() } as QueryRecord),
  )
}
