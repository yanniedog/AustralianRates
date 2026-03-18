import type { Hono } from 'hono'
import { applyDefaultChartDateRange, getCachedOrCompute } from '../db/chart-cache'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import { withPublicCache } from '../utils/http'
import { parseSourceMode } from '../utils/source-mode'
import { collectHomeLoanAnalyticsRowsResolved } from './analytics-data'
import { parseAnalyticsRepresentation } from './analytics-route-utils'
import { parseCsvList, parseIncludeRemoved, parseOptionalNumber } from './public-query'

const CHART_CACHE_MAX_AGE = 300

function buildFilters(query: Record<string, string | undefined>) {
  return {
    startDate: query.start_date,
    endDate: query.end_date,
    bank: query.bank,
    banks: parseCsvList(query.banks),
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    minRate: parseOptionalNumber(query.min_rate),
    maxRate: parseOptionalNumber(query.max_rate),
    minComparisonRate: parseOptionalNumber(query.min_comparison_rate),
    maxComparisonRate: parseOptionalNumber(query.max_comparison_rate),
    includeRemoved: parseIncludeRemoved(query.include_removed),
    mode: String(query.mode || 'all').toLowerCase() === 'historical' ? 'historical' : String(query.mode || 'all').toLowerCase() === 'daily' ? 'daily' : 'all',
    sourceMode: parseSourceMode(query.source_mode, query.include_manual),
  } as const
}

function toParams(merged: Record<string, string | undefined>): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(merged)) params[k] = v == null ? undefined : String(v)
  return params
}

export function registerHomeLoanAnalyticsRoutes(publicRoutes: Hono<AppContext>): void {
  publicRoutes.get('/analytics/series', async (c) => {
    const merged = { ...c.req.query() } as Record<string, string | undefined>
    const requestedRepresentation = parseAnalyticsRepresentation(merged.representation)
    const dbs = { canonicalDb: c.env.DB, analyticsDb: getReadDb(c.env) }
    const result = await getCachedOrCompute(
      c.env,
      'home_loans',
      requestedRepresentation,
      toParams(merged),
      () =>
        collectHomeLoanAnalyticsRowsResolved(dbs, requestedRepresentation, applyDefaultChartDateRange(buildFilters(merged))).then((r) => ({
          rows: r.rows,
          representation: r.representation,
          fallbackReason: r.fallbackReason,
        })),
    )
    withPublicCache(c, CHART_CACHE_MAX_AGE)
    return c.json({
      ok: true,
      representation: result.representation,
      requested_representation: requestedRepresentation,
      fallback_reason: result.fallbackReason,
      count: result.rows.length,
      total: result.rows.length,
      rows: result.rows,
    })
  })

  publicRoutes.post('/analytics/pivot', async (c) => {
    const body = (await c.req.json<Record<string, string | undefined>>().catch(() => ({}))) as Record<string, string | undefined>
    const merged = { ...c.req.query(), ...body } as Record<string, string | undefined>
    const requestedRepresentation = parseAnalyticsRepresentation(merged.representation)
    const dbs = { canonicalDb: c.env.DB, analyticsDb: getReadDb(c.env) }
    const result = await getCachedOrCompute(
      c.env,
      'home_loans',
      requestedRepresentation,
      toParams(merged),
      () =>
        collectHomeLoanAnalyticsRowsResolved(dbs, requestedRepresentation, applyDefaultChartDateRange(buildFilters(merged))).then((r) => ({
          rows: r.rows,
          representation: r.representation,
          fallbackReason: r.fallbackReason,
        })),
    )
    withPublicCache(c, CHART_CACHE_MAX_AGE)
    return c.json({
      ok: true,
      representation: result.representation,
      requested_representation: requestedRepresentation,
      fallback_reason: result.fallbackReason,
      count: result.rows.length,
      total: result.rows.length,
      rows: result.rows,
    })
  })
}
