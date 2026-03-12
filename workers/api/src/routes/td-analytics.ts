import type { Hono } from 'hono'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import { parseSourceMode } from '../utils/source-mode'
import { collectTdAnalyticsRows } from './analytics-data'
import { parseAnalyticsRepresentation } from './analytics-route-utils'
import { parseCsvList, parseIncludeRemoved, parseOptionalNumber } from './public-query'

function buildFilters(query: Record<string, string | undefined>) {
  return {
    startDate: query.start_date,
    endDate: query.end_date,
    bank: query.bank,
    banks: parseCsvList(query.banks),
    termMonths: query.term_months,
    depositTier: query.deposit_tier,
    interestPayment: query.interest_payment,
    minRate: parseOptionalNumber(query.min_rate),
    maxRate: parseOptionalNumber(query.max_rate),
    includeRemoved: parseIncludeRemoved(query.include_removed),
    mode: String(query.mode || 'all').toLowerCase() === 'historical' ? 'historical' : String(query.mode || 'all').toLowerCase() === 'daily' ? 'daily' : 'all',
    sourceMode: parseSourceMode(query.source_mode, query.include_manual),
  } as const
}

export function registerTdAnalyticsRoutes(publicRoutes: Hono<AppContext>): void {
  publicRoutes.get('/analytics/series', async (c) => {
    const representation = parseAnalyticsRepresentation(c.req.query('representation'))
    const rows = await collectTdAnalyticsRows(
      { canonicalDb: c.env.DB, analyticsDb: getReadDb(c.env) },
      representation,
      buildFilters(c.req.query()),
    )
    return c.json({ ok: true, representation, count: rows.length, total: rows.length, rows })
  })

  publicRoutes.post('/analytics/pivot', async (c) => {
    const body = (await c.req.json<Record<string, string | undefined>>().catch(() => ({}))) as Record<string, string | undefined>
    const merged = { ...c.req.query(), ...body }
    const representation = parseAnalyticsRepresentation(merged.representation)
    const rows = await collectTdAnalyticsRows(
      { canonicalDb: c.env.DB, analyticsDb: getReadDb(c.env) },
      representation,
      buildFilters(merged),
    )
    return c.json({ ok: true, representation, count: rows.length, total: rows.length, rows })
  })
}
