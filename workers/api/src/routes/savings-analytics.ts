import type { Hono } from 'hono'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import { parseSourceMode } from '../utils/source-mode'
import { collectSavingsAnalyticsRowsResolved } from './analytics-data'
import { parseAnalyticsRepresentation } from './analytics-route-utils'
import { parseCsvList, parseIncludeRemoved, parseOptionalNumber } from './public-query'

function buildFilters(query: Record<string, string | undefined>) {
  return {
    startDate: query.start_date,
    endDate: query.end_date,
    bank: query.bank,
    banks: parseCsvList(query.banks),
    accountType: query.account_type,
    rateType: query.rate_type,
    depositTier: query.deposit_tier,
    minRate: parseOptionalNumber(query.min_rate),
    maxRate: parseOptionalNumber(query.max_rate),
    includeRemoved: parseIncludeRemoved(query.include_removed),
    mode: String(query.mode || 'all').toLowerCase() === 'historical' ? 'historical' : String(query.mode || 'all').toLowerCase() === 'daily' ? 'daily' : 'all',
    sourceMode: parseSourceMode(query.source_mode, query.include_manual),
  } as const
}

export function registerSavingsAnalyticsRoutes(publicRoutes: Hono<AppContext>): void {
  publicRoutes.get('/analytics/series', async (c) => {
    const requestedRepresentation = parseAnalyticsRepresentation(c.req.query('representation'))
    const result = await collectSavingsAnalyticsRowsResolved(
      { canonicalDb: c.env.DB, analyticsDb: getReadDb(c.env) },
      requestedRepresentation,
      buildFilters(c.req.query()),
    )
    return c.json({
      ok: true,
      representation: result.representation,
      requested_representation: result.requestedRepresentation,
      fallback_reason: result.fallbackReason,
      count: result.rows.length,
      total: result.rows.length,
      rows: result.rows,
    })
  })

  publicRoutes.post('/analytics/pivot', async (c) => {
    const body = (await c.req.json<Record<string, string | undefined>>().catch(() => ({}))) as Record<string, string | undefined>
    const merged = { ...c.req.query(), ...body }
    const requestedRepresentation = parseAnalyticsRepresentation(merged.representation)
    const result = await collectSavingsAnalyticsRowsResolved(
      { canonicalDb: c.env.DB, analyticsDb: getReadDb(c.env) },
      requestedRepresentation,
      buildFilters(merged),
    )
    return c.json({
      ok: true,
      representation: result.representation,
      requested_representation: result.requestedRepresentation,
      fallback_reason: result.fallbackReason,
      count: result.rows.length,
      total: result.rows.length,
      rows: result.rows,
    })
  })
}
