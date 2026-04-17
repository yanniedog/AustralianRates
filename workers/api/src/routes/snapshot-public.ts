/**
 * GET /snapshot — unified bootstrap payload for a public section.
 *
 * Bundles the small per-page dependencies (site-ui, filters, overview, latest-all,
 * changes, executive-summary, rba/cpi history, report-plot moves+bands) into one
 * JSON so the browser can render the default view without a waterfall of requests.
 *
 * Heavy series data (analytics/series for 365d) is intentionally NOT bundled — it
 * has its own edge + KV + D1 cache (chart_request_cache) and staying separate keeps
 * the snapshot small so Cloudflare can cache it aggressively.
 *
 * Refreshed hourly alongside chart_request_cache / report_plot_request_cache (cron).
 */

import type { Hono, Context } from 'hono'
import { getReadDb } from '../db/read-db'
import { getLandingOverview } from '../db/landing-overview'
import { getFilters } from '../db/home-loans/filters'
import { getSavingsFilters } from '../db/savings/filters'
import { getTdFilters } from '../db/term-deposits/filters'
import { queryLatestAllRates } from '../db/home-loans/latest'
import { queryLatestAllSavingsRates } from '../db/savings/latest'
import { queryLatestAllTdRates } from '../db/term-deposits/latest'
import {
  queryHomeLoanRateChanges,
  queryHomeLoanRateChangeIntegrity,
  querySavingsRateChanges,
  querySavingsRateChangeIntegrity,
  queryTdRateChanges,
  queryTdRateChangeIntegrity,
} from '../db/rate-change-log'
import { queryChangesWithFallback, queryIntegritySafely } from './change-route-utils'
import { queryExecutiveSummaryReport } from '../db/executive-summary'
import { getRbaHistory } from '../db/rba-cash-rate'
import { getCpiHistory } from '../db/cpi-data'
import { queryReportPlotPayload } from '../db/report-plot'
import { buildSiteUiPayload } from './site-ui-public'
import {
  getCachedOrComputeSnapshot,
  type SnapshotPayload,
  type SnapshotScope,
} from '../db/snapshot-cache'
import {
  resolveChartDateRangeFromDb,
  type ChartCacheSection,
} from '../db/chart-cache'
import type { AppContext } from '../types'
import { withPublicCache } from '../utils/http'

const SNAPSHOT_CACHE_MAX_AGE = 300

type DatasetKind = ChartCacheSection

const SECTION_API_BASE: Record<DatasetKind, string> = {
  home_loans: '/api/home-loan-rates',
  savings: '/api/savings-rates',
  term_deposits: '/api/term-deposit-rates',
}

/** Map a snapshot data entry to the concrete URL(s) the client would otherwise have requested. */
function buildEntryUrls(section: DatasetKind): Record<string, string[]> {
  const base = SECTION_API_BASE[section]
  return {
    siteUi: [`${base}/site-ui`],
    filters: [`${base}/filters`],
    overview: [`${base}/overview`, `${base}/overview?section=${section}`],
    latestAll: [`${base}/latest-all?limit=5000`, `${base}/latest-all?limit=1000`],
    changes: [`${base}/changes?limit=200&offset=0`, `${base}/changes`],
    executiveSummary: [`${base}/executive-summary?window_days=30`, `${base}/executive-summary`],
    rbaHistory: [`${base}/rba/history`],
    cpiHistory: [`${base}/cpi/history`],
    reportPlotMoves: [], /* populated dynamically by client since params vary */
    reportPlotBands: [],
  }
}

/** Safely invoke a per-section fetcher. Errors become `{ ok: false, error }` entries so one failure doesn't kill the bundle. */
async function safeEntry<T>(name: string, fn: () => Promise<T>): Promise<{ ok: true; name: string; value: T } | { ok: false; name: string; error: string }> {
  try {
    return { ok: true, name, value: await fn() }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, name, error: message }
  }
}

async function buildRateChangesEntry(db: D1Database, section: DatasetKind): Promise<Record<string, unknown>> {
  const legacyChanges =
    section === 'home_loans'
      ? queryHomeLoanRateChanges
      : section === 'savings'
        ? querySavingsRateChanges
        : queryTdRateChanges
  const integrityQuery =
    section === 'home_loans'
      ? () => queryHomeLoanRateChangeIntegrity(db)
      : section === 'savings'
        ? () => querySavingsRateChangeIntegrity(db)
        : () => queryTdRateChangeIntegrity(db)
  const [changeResult, integrity] = await Promise.all([
    queryChangesWithFallback(db, db, section, { limit: 200, offset: 0 }, legacyChanges),
    queryIntegritySafely(section, integrityQuery),
  ])
  return {
    ok: true,
    source: changeResult.source,
    count: changeResult.result.rows.length,
    total: changeResult.result.total,
    rows: changeResult.result.rows,
    integrity,
  }
}

async function buildLatestAllEntry(db: D1Database, section: DatasetKind): Promise<Record<string, unknown>> {
  const baseFilters = { limit: 5000, includeRemoved: false, sourceMode: 'all' as const }
  const rows =
    section === 'home_loans'
      ? await queryLatestAllRates(db, baseFilters)
      : section === 'savings'
        ? await queryLatestAllSavingsRates(db, baseFilters)
        : await queryLatestAllTdRates(db, baseFilters)
  return {
    ok: true,
    count: rows.length,
    rows,
  }
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Default report-plot filter set: last 365 days (or dataset min) clipped to today, no selective filters. */
async function defaultReportPlotFilters(
  db: D1Database,
  section: DatasetKind,
): Promise<Record<string, unknown> & { startDate: string; endDate: string }> {
  const base = { mode: 'all' as const, includeRemoved: false, sourceMode: 'all' as const }
  const resolved = await resolveChartDateRangeFromDb(db, section, base, { window: null })
  const today = todayYmd()
  const endDate = !resolved.endDate || resolved.endDate > today ? today : resolved.endDate
  const startDate = resolved.startDate && resolved.startDate <= endDate ? resolved.startDate : endDate
  return { ...resolved, startDate, endDate }
}

/** Build the full snapshot bundle for a section. Each sub-fetch is isolated so a single failure is non-fatal. */
export async function buildSnapshotPayload(
  env: { DB: D1Database; CHART_CACHE_KV?: KVNamespace },
  section: DatasetKind,
  scope: SnapshotScope = 'default',
): Promise<SnapshotPayload> {
  const db = env.DB
  const reportPlotFiltersPromise = defaultReportPlotFilters(db, section).catch(() => null)
  const fetchers: Array<Promise<{ ok: true; name: string; value: unknown } | { ok: false; name: string; error: string }>> = [
    safeEntry('siteUi', () => buildSiteUiPayload(db)),
    safeEntry('filters', async () => {
      if (section === 'home_loans') return { ok: true, filters: await getFilters(db) }
      if (section === 'savings') return { ok: true, filters: await getSavingsFilters(db) }
      return { ok: true, filters: await getTdFilters(db) }
    }),
    safeEntry('overview', async () => ({ ok: true, ...(await getLandingOverview(db, section)) })),
    safeEntry('latestAll', () => buildLatestAllEntry(db, section)),
    safeEntry('changes', () => buildRateChangesEntry(db, section)),
    safeEntry('executiveSummary', async () => ({ ok: true, ...(await queryExecutiveSummaryReport(db, { windowDays: 30 })) })),
    safeEntry('rbaHistory', async () => ({ ok: true, rows: await getRbaHistory(db) })),
    safeEntry('cpiHistory', async () => ({ ok: true, rows: await getCpiHistory(db) })),
    safeEntry('reportPlotMoves', async () => {
      const filters = await reportPlotFiltersPromise
      if (!filters) throw new Error('report_plot_filters_unresolved')
      return queryReportPlotPayload(db, section, 'moves', filters as Parameters<typeof queryReportPlotPayload>[3])
    }),
    safeEntry('reportPlotBands', async () => {
      const filters = await reportPlotFiltersPromise
      if (!filters) throw new Error('report_plot_filters_unresolved')
      return queryReportPlotPayload(db, section, 'bands', filters as Parameters<typeof queryReportPlotPayload>[3])
    }),
  ]
  const results = await Promise.all(fetchers)

  const data: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  for (const result of results) {
    if (result.ok) data[result.name] = result.value
    else errors[result.name] = result.error
  }

  return {
    builtAt: new Date().toISOString(),
    scope,
    section,
    data: {
      ...data,
      urls: buildEntryUrls(section),
      errors: Object.keys(errors).length ? errors : undefined,
    },
  }
}

async function handleSnapshotRequest(c: Context<AppContext>, section: DatasetKind) {
  const payload = await getCachedOrComputeSnapshot(c.env, section, 'default', () => buildSnapshotPayload(c.env, section, 'default'))
  withPublicCache(c, SNAPSHOT_CACHE_MAX_AGE)
  c.header('X-AR-Cache', payload.fromCache)
  return c.json({
    ok: true,
    section: payload.section,
    scope: payload.scope,
    builtAt: payload.builtAt,
    data: payload.data,
  })
}

/** Register GET /snapshot on the section's public routes. */
export function registerSnapshotRoute(routes: Hono<AppContext>, section: DatasetKind): void {
  routes.get('/snapshot', async (c) => handleSnapshotRequest(c, section))
}
