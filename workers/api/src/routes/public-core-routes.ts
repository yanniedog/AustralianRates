import type { Hono } from 'hono'
import { API_BASE_PATH, MELBOURNE_TIMEZONE } from '../constants'
import { getReadDb } from '../db/read-db'
import { queryExecutiveSummaryReport } from '../db/executive-summary'
import { getLandingOverview } from '../db/landing-overview'
import { getLenderStaleness, getQualityDiagnostics } from '../db/queries'
import { queryHomeLoanRateChangeIntegrity, queryHomeLoanRateChanges } from '../db/rate-change-log'
import type { AppContext } from '../types'
import { withPublicCache } from '../utils/http'
import { getMelbourneNowParts, parseIntegerEnv } from '../utils/time'
import { queryChangesWithFallback, queryIntegritySafely } from './change-route-utils'
import { registerSiteUiPublicRoute } from './site-ui-public'

export function registerPublicCoreRoutes(publicRoutes: Hono<AppContext>): void {
  registerSiteUiPublicRoute(publicRoutes)
  publicRoutes.get('/overview', async (c) => {
    withPublicCache(c, 60)
    const section = (c.req.query('section') || 'home_loans').trim() as 'home_loans' | 'savings' | 'term_deposits'
    const valid = section === 'home_loans' || section === 'savings' || section === 'term_deposits'
    const overview = await getLandingOverview(c.env.DB, valid ? section : 'home_loans')
    return c.json({ ok: true, ...overview })
  })

  publicRoutes.get('/health', async (c) => {
    withPublicCache(c, 30)

    const melbourne = getMelbourneNowParts(new Date(), c.env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE)
    const targetHour = parseIntegerEnv(c.env.MELBOURNE_TARGET_HOUR, 6)

    return c.json({
      ok: true,
      service: 'australianrates-api',
      phase: 'phase1',
      version: c.env.WORKER_VERSION || 'dev',
      api_base_path: c.env.PUBLIC_API_BASE_PATH || API_BASE_PATH,
      melbourne,
      scheduled_target_hour: targetHour,
      features: {
        prospective: String(c.env.FEATURE_PROSPECTIVE_ENABLED || 'true').toLowerCase() === 'true',
        backfill: String(c.env.FEATURE_BACKFILL_ENABLED || 'true').toLowerCase() === 'true',
        historical_pull: true,
        public_historical_max_range_days: Math.max(1, parseIntegerEnv(c.env.PUBLIC_HISTORICAL_MAX_RANGE_DAYS, 30)),
      },
      bindings: {
        db: Boolean(c.env.DB),
        raw_bucket: Boolean(c.env.RAW_BUCKET),
        ingest_queue: Boolean(c.env.INGEST_QUEUE),
        run_lock_do: Boolean(c.env.RUN_LOCK_DO),
      },
    })
  })

  publicRoutes.get('/staleness', async (c) => {
    withPublicCache(c, 60)
    const staleness = await getLenderStaleness(c.env.DB)
    const staleLenders = staleness.filter((l) => l.stale)
    return c.json({
      ok: true,
      stale_count: staleLenders.length,
      lenders: staleness,
    })
  })

  publicRoutes.get('/quality/diagnostics', async (c) => {
    const diagnostics = await getQualityDiagnostics(c.env.DB)
    return c.json({
      ok: true,
      diagnostics,
    })
  })

  publicRoutes.get('/executive-summary', async (c) => {
    withPublicCache(c, 120)
    const requestedWindowDays = Number(c.req.query('window_days') || 30)
    const report = await queryExecutiveSummaryReport(c.env.DB, {
      windowDays: requestedWindowDays,
    })
    return c.json({
      ok: true,
      ...report,
    })
  })

  publicRoutes.get('/changes', async (c) => {
    withPublicCache(c, 120)
    const q = c.req.query()
    const limit = Number(q.limit || 200)
    const offset = Number(q.offset || 0)
    const [changeResult, integrity] = await Promise.all([
      queryChangesWithFallback(c.env.DB, getReadDb(c.env), 'home_loans', { limit, offset }, queryHomeLoanRateChanges),
      queryIntegritySafely('home_loans', () => queryHomeLoanRateChangeIntegrity(c.env.DB)),
    ])
    return c.json({
      ok: true,
      source: changeResult.source,
      count: changeResult.result.rows.length,
      total: changeResult.result.total,
      rows: changeResult.result.rows,
      integrity,
    })
  })
}
