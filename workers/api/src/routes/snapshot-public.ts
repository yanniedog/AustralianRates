/**
 * GET /snapshot — unified bootstrap payload for a public section.
 *
 * Bundles per-page dependencies (site-ui, filters, overview, latest-all, changes,
 * executive-summary, rba/cpi history, report-plot moves+bands, analytics/series day)
 * into one JSON so the browser can render the default view without a waterfall.
 *
 * Query params (v2):
 *   - chart_window: 30D | 90D | 180D | 1Y | ALL (optional; default = "default" scope / ~365 days)
 *   - preset: consumer-default (optional; applies section-specific filter layering)
 *
 * Scopes match the `ChartCacheScope` strings used by chart_request_cache and
 * report_plot_request_cache, so all three caches refresh in lockstep.
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
import {
  collectHomeLoanAnalyticsRowsResolved,
  collectSavingsAnalyticsRowsResolved,
  collectTdAnalyticsRowsResolved,
  type ResolvedAnalyticsRows,
} from './analytics-data'
import { buildGroupedChartRows } from '../utils/chart-row-groups'
import { buildDefaultChartModel, type ChartModelPayload } from '../chart-model/chart-model'
import { buildReportProductHistoryPayload } from '../chart-model/report-product-history'
import { buildSiteUiPayload } from './site-ui-public'
import {
  getCachedOrComputeSnapshot,
  type SnapshotPayload,
  type SnapshotScope,
} from '../db/snapshot-cache'
import {
  buildPrecomputedChartScopeForPreset,
  type ChartCacheSection,
} from '../db/chart-cache'
import { resolveFiltersForScope, type ScopedFilters, type ScopePreset } from '../db/scope-filters'
import { parseChartWindow, type ChartWindow } from '../utils/chart-window'
import { getAppConfig } from '../db/app-config'
import type { AppContext } from '../types'
import { withPublicCache } from '../utils/http'
import { buildSnapshotCurrentLeaders } from './snapshot-current-leaders'
import { trimSnapshotDataForHtmlInline } from '../utils/snapshot-inline-trim'

const SNAPSHOT_CACHE_MAX_AGE = 300

/** Feature flag key: if set to "0"/"false"/"off" snapshot omits the heavy analyticsSeries.day entry. */
const SNAPSHOT_INCLUDE_SERIES_KEY = 'snapshot_include_series'

type DatasetKind = ChartCacheSection

const SECTION_API_BASE: Record<DatasetKind, string> = {
  home_loans: '/api/home-loan-rates',
  savings: '/api/savings-rates',
  term_deposits: '/api/term-deposit-rates',
}

function parsePreset(value: string | undefined | null): ScopePreset | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === 'consumer-default' ? 'consumer-default' : null
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

function buildLatestAllFilters(filters: ScopedFilters): ScopedFilters & { limit: number } {
  // `/latest-all` is latest-as-of snapshot, so date-range fields don't apply.
  // Carry preset fields (security_purpose etc.) through so consumer-default snapshots stay scoped.
  return {
    ...filters,
    limit: 5000,
  }
}

async function buildLatestAllEntry(
  db: D1Database,
  section: DatasetKind,
  filters: ScopedFilters,
): Promise<Record<string, unknown>> {
  const latestFilters = buildLatestAllFilters(filters)
  const rows =
    section === 'home_loans'
      ? await queryLatestAllRates(db, latestFilters)
      : section === 'savings'
        ? await queryLatestAllSavingsRates(db, latestFilters)
        : await queryLatestAllTdRates(db, latestFilters)
  return { ok: true, count: rows.length, rows }
}

async function collectAnalyticsRows(
  db: D1Database,
  section: DatasetKind,
  filters: ScopedFilters,
): Promise<ResolvedAnalyticsRows> {
  const dbs = { canonicalDb: db, analyticsDb: db }
  const internalFilters = { ...filters, disableRowCap: true, chartInternalRefresh: true }
  if (section === 'home_loans') return collectHomeLoanAnalyticsRowsResolved(dbs, 'day', internalFilters)
  if (section === 'savings') return collectSavingsAnalyticsRowsResolved(dbs, 'day', internalFilters)
  return collectTdAnalyticsRowsResolved(dbs, 'day', internalFilters)
}

function buildAnalyticsSeriesEntry(result: ResolvedAnalyticsRows): Record<string, unknown> {
  // Ship the compact grouped form — dense per-product meta + sparse per-day points.
  // Client handles `rows_format: 'grouped_v1'` via `expandGroupedRows` already.
  const grouped = buildGroupedChartRows(result.rows)
  return {
    ok: true,
    representation: result.representation,
    requested_representation: 'day' as const,
    fallback_reason: result.fallbackReason,
    count: result.rows.length,
    total: result.rows.length,
    rows: [] as Array<Record<string, unknown>>,
    rows_format: 'grouped_v1' as const,
    grouped_rows: grouped,
  }
}

async function shouldIncludeAnalyticsSeries(db: D1Database): Promise<boolean> {
  try {
    const raw = await getAppConfig(db, SNAPSHOT_INCLUDE_SERIES_KEY)
    if (raw == null) return true
    const normalized = String(raw).trim().toLowerCase()
    return !(normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no')
  } catch {
    return true
  }
}

/** Build the full snapshot bundle for a section + scope. Each sub-fetch is isolated. */
export async function buildSnapshotPayload(
  env: { DB: D1Database; CHART_CACHE_KV?: KVNamespace },
  section: DatasetKind,
  scope: SnapshotScope = 'default',
): Promise<SnapshotPayload> {
  const db = env.DB
  const filters = await resolveFiltersForScope(db, section, scope)
  const includeSeries = await shouldIncludeAnalyticsSeries(db)

  // Fetch analytics rows once (if bundling); derive both the grouped wire form and
  // the server-side chart model from the same row set so they can't drift.
  const analyticsPromise = collectAnalyticsRows(db, section, filters).catch((error) => {
    return { error: error instanceof Error ? error.message : String(error) }
  })

  const fetchers: Array<Promise<{ ok: true; name: string; value: unknown } | { ok: false; name: string; error: string }>> = [
    safeEntry('siteUi', () => buildSiteUiPayload(db)),
    safeEntry('filters', async () => {
      if (section === 'home_loans') return { ok: true, filters: await getFilters(db) }
      if (section === 'savings') return { ok: true, filters: await getSavingsFilters(db) }
      return { ok: true, filters: await getTdFilters(db) }
    }),
    safeEntry('overview', async () => ({ ok: true, ...(await getLandingOverview(db, section)) })),
    safeEntry('latestAll', () => buildLatestAllEntry(db, section, filters)),
    safeEntry('changes', () => buildRateChangesEntry(db, section)),
    safeEntry('executiveSummary', async () => ({ ok: true, ...(await queryExecutiveSummaryReport(db, { windowDays: 30 })) })),
    safeEntry('rbaHistory', async () => ({ ok: true, rows: await getRbaHistory(db) })),
    safeEntry('cpiHistory', async () => ({ ok: true, rows: await getCpiHistory(db) })),
    safeEntry('reportPlotMoves', () =>
      queryReportPlotPayload(db, section, 'moves', filters as Parameters<typeof queryReportPlotPayload>[3]),
    ),
    safeEntry('reportPlotBands', () =>
      queryReportPlotPayload(db, section, 'bands', filters as Parameters<typeof queryReportPlotPayload>[3]),
    ),
  ]

  const results = await Promise.all(fetchers)

  const data: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  for (const result of results) {
    if (result.ok) data[result.name] = result.value
    else errors[result.name] = result.error
  }
  const latestAllEntry = data.latestAll as { rows?: Array<Record<string, unknown>> } | undefined
  if (latestAllEntry && Array.isArray(latestAllEntry.rows) && latestAllEntry.rows.length) {
    data.currentLeaders = buildSnapshotCurrentLeaders(section, latestAllEntry.rows)
  }

  const analyticsResult = await analyticsPromise
  if ('error' in analyticsResult) {
    errors.analyticsSeries = analyticsResult.error
  } else {
    data.reportProductHistory = buildReportProductHistoryPayload(section, analyticsResult.rows)
    if (includeSeries) {
      data.analyticsSeries = buildAnalyticsSeriesEntry(analyticsResult)
    }
    try {
      const chartModel: ChartModelPayload = buildDefaultChartModel({
        section,
        rows: analyticsResult.rows,
      })
      data.chartModels = { default: chartModel }
    } catch (error) {
      errors.chartModels = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    builtAt: new Date().toISOString(),
    scope,
    section,
    data: {
      ...data,
      filtersResolved: {
        startDate: filters.startDate,
        endDate: filters.endDate,
        preset: filters.accountType ? 'consumer-default' : filters.securityPurpose ? 'consumer-default' : null,
      },
      urls: buildEntryUrls(section),
      errors: Object.keys(errors).length ? errors : undefined,
    },
  }
}

function resolveRequestScope(section: DatasetKind, windowRaw: string | undefined, presetRaw: string | undefined): SnapshotScope {
  const window: ChartWindow | null = parseChartWindow(windowRaw)
  let preset: ScopePreset | null = parsePreset(presetRaw)
  if (preset === 'consumer-default' && section === 'term_deposits') {
    // TD has no consumer-default preset in the cache enumeration; fall back to base scope.
    preset = null
  }
  return buildPrecomputedChartScopeForPreset(window, preset)
}

function parseBooleanQuery(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

async function handleSnapshotRequest(c: Context<AppContext>, section: DatasetKind) {
  const query = c.req.query()
  const scope = resolveRequestScope(section, query.chart_window, query.preset)
  const wantsLite = parseBooleanQuery(query.lite)
  let payload: Awaited<ReturnType<typeof getCachedOrComputeSnapshot>>
  try {
    payload = await getCachedOrComputeSnapshot(
      c.env,
      section,
      scope,
      () => buildSnapshotPayload(c.env, section, scope),
      { allowD1Fallback: false, allowLiveCompute: false },
    )
  } catch {
    c.header('Cache-Control', 'no-store')
    c.header('X-AR-Cache', 'miss')
    c.header('X-AR-Snapshot-Scope', scope)
    return c.json(
      {
        ok: false,
        error: 'SNAPSHOT_PACKAGE_UNAVAILABLE',
        section,
        scope,
      },
      503,
    )
  }
  const data = wantsLite
    ? trimSnapshotDataForHtmlInline(payload.section, String(payload.scope), payload.builtAt, payload.data) || {}
    : payload.data
  withPublicCache(c, SNAPSHOT_CACHE_MAX_AGE)
  c.header('X-AR-Cache', payload.fromCache)
  c.header('X-AR-Snapshot-Scope', scope)
  c.header('X-AR-Snapshot-Shape', wantsLite ? 'lite' : 'full')
  return c.json({
    ok: true,
    section: payload.section,
    scope: payload.scope,
    builtAt: payload.builtAt,
    data,
  })
}

/** Register GET /snapshot on the section's public routes. */
export function registerSnapshotRoute(routes: Hono<AppContext>, section: DatasetKind): void {
  routes.get('/snapshot', async (c) => handleSnapshotRequest(c, section))
}
