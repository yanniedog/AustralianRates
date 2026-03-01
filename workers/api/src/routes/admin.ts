import { Hono } from 'hono'
import { requireAdmin } from '../auth/admin'
import { getAdminRealtimeSnapshot } from '../db/admin-realtime'
import { getRecentFetchEvents } from '../db/fetch-events'
import { getRunReport, listRunReports } from '../db/run-reports'
import { getHistoricalPullDetail, startHistoricalPullRun } from '../pipeline/client-historical'
import { triggerBackfillRun, triggerDailyRun } from '../pipeline/bootstrap-jobs'
import { adminClearRoutes } from './admin-clear'
import { adminConfigRoutes } from './admin-config'
import { adminDbRoutes } from './admin-db'
import { adminHealthRoutes } from './admin-health'
import { adminLogRoutes } from './admin-logs'
import type { AppContext } from '../types'
import { jsonError, withNoStore } from '../utils/http'
import { log } from '../utils/logger'
import type { DatasetKind } from '../../../../packages/shared/src'

export const adminRoutes = new Hono<AppContext>()

adminRoutes.use('*', async (c, next) => {
  withNoStore(c)
  await next()
})

adminRoutes.use('*', requireAdmin())

adminRoutes.route('/', adminConfigRoutes)
adminRoutes.route('/', adminDbRoutes)
adminRoutes.route('/', adminClearRoutes)
adminRoutes.route('/', adminLogRoutes)
adminRoutes.route('/', adminHealthRoutes)

adminRoutes.get('/runs', async (c) => {
  const limit = Number(c.req.query('limit') || 25)
  const runs = await listRunReports(c.env.DB, limit)

  return c.json({
    ok: true,
    count: runs.length,
    auth_mode: c.get('adminAuthState')?.mode || null,
    runs,
  })
})

adminRoutes.get('/runs/realtime', async (c) => {
  const limit = Number(c.req.query('limit') || 15)
  const snapshot = await getAdminRealtimeSnapshot(c.env.DB, { recentLimit: limit, pollIntervalMs: 10000 })
  return c.json({
    ...snapshot,
    auth_mode: c.get('adminAuthState')?.mode || null,
  })
})

adminRoutes.get('/runs/:runId', async (c) => {
  const runId = c.req.param('runId')
  const run = await getRunReport(c.env.DB, runId)

  if (!run) {
    return jsonError(c, 404, 'NOT_FOUND', `Run report not found: ${runId}`)
  }

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    run,
  })
})

adminRoutes.get('/diagnostics/fetch-events', async (c) => {
  const dataset = c.req.query('dataset') as DatasetKind | undefined
  const lenderCode = c.req.query('lender_code') || undefined
  const limit = Number(c.req.query('limit') || 100)
  const events = await getRecentFetchEvents(c.env.DB, { dataset, lenderCode, limit })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    count: events.length,
    events,
  })
})

adminRoutes.get('/diagnostics/anomalies', async (c) => {
  const dataset = c.req.query('dataset') || undefined
  const lenderCode = c.req.query('lender_code') || undefined
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(c.req.query('limit') || 100))))
  const where: string[] = []
  const binds: Array<string | number> = []
  if (dataset) {
    where.push('dataset_kind = ?')
    binds.push(dataset)
  }
  if (lenderCode) {
    where.push('lender_code = ?')
    binds.push(lenderCode)
  }
  binds.push(limit)
  const result = await c.env.DB
    .prepare(
      `SELECT
         id, fetch_event_id, run_id, lender_code, dataset_kind, product_id, series_key,
         collection_date, reason, severity, candidate_json, normalized_candidate_json, created_at
       FROM ingest_anomalies
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(...binds)
    .all<Record<string, unknown>>()
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    count: (result.results ?? []).length,
    rows: result.results ?? [],
  })
})

adminRoutes.get('/diagnostics/series', async (c) => {
  const dataset = c.req.query('dataset') || undefined
  const lenderCode = c.req.query('lender_code') || undefined
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(c.req.query('limit') || 100))))
  const where: string[] = []
  const binds: Array<string | number> = []
  if (dataset) {
    where.push('sc.dataset_kind = ?')
    binds.push(dataset)
  }
  if (lenderCode) {
    where.push('lrs.lender_code = ?')
    binds.push(lenderCode)
  }
  binds.push(limit)
  const result = await c.env.DB
    .prepare(
      `SELECT
         sc.dataset_kind,
         sc.series_key,
         sc.bank_name,
         sc.product_id,
         sc.product_code,
         sc.product_name,
         sc.first_seen_collection_date,
         sc.last_seen_collection_date,
         sc.is_removed,
         sc.removed_at,
         sps.last_seen_run_id,
         sps.last_seen_collection_date
       FROM series_catalog sc
       LEFT JOIN series_presence_status sps
         ON sps.series_key = sc.series_key
       LEFT JOIN lender_dataset_runs lrs
         ON lrs.run_id = sps.last_seen_run_id
         AND lrs.dataset_kind = sc.dataset_kind
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY sc.last_seen_collection_date DESC, sc.bank_name ASC
       LIMIT ?`,
    )
    .bind(...binds)
    .all<Record<string, unknown>>()
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    count: (result.results ?? []).length,
    rows: result.results ?? [],
  })
})

adminRoutes.post('/runs/daily', async (c) => {
  log.info('admin', 'Manual daily run triggered')
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const force = Boolean(body.force)

  const result = await triggerDailyRun(c.env, {
    source: 'manual',
    force,
  })

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    result,
  })
})

adminRoutes.post('/runs/backfill', async (c) => {
  log.info('admin', 'Manual backfill run triggered')
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>

  const rawLenderCodes = body.lenderCodes
  const lenderCodes = Array.isArray(rawLenderCodes)
    ? rawLenderCodes.map((x: unknown) => String(x || '').trim()).filter(Boolean)
    : undefined

  const monthCursor = typeof body.monthCursor === 'string' ? body.monthCursor : undefined
  const maxSnapshotsPerMonth = Number(body.maxSnapshotsPerMonth || 3)

  const result = await triggerBackfillRun(c.env, {
    lenderCodes,
    monthCursor,
    maxSnapshotsPerMonth,
  })

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    result,
  })
})

adminRoutes.post('/historical/pull', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const startDate = String(body.start_date ?? body.startDate ?? '').trim()
  const endDate = String(body.end_date ?? body.endDate ?? '').trim()
  const subject = c.get('adminAuthState')?.subject ?? 'admin'
  const created = await startHistoricalPullRun(c.env, {
    triggerSource: 'admin',
    requestedBy: subject,
    startDate,
    endDate,
  })
  if (!created.ok) {
    return jsonError(c, created.status as 400 | 401 | 403 | 404 | 409 | 429 | 500, created.code, created.message, created.details)
  }
  return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode || null, ...created.value })
})

adminRoutes.get('/historical/pull/:runId', async (c) => {
  const detail = await getHistoricalPullDetail(c.env, c.req.param('runId'))
  if (!detail.ok) {
    return jsonError(c, detail.status as 400 | 401 | 403 | 404 | 409 | 429 | 500, detail.code, detail.message, detail.details)
  }
  return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode || null, ...detail.value })
})

adminRoutes.post('/historical/pull/tasks/claim', async (c) => {
  return jsonError(
    c,
    410,
    'HISTORICAL_LOCAL_WORKER_DEPRECATED',
    'Local historical worker task claim is deprecated. Historical tasks are now executed by the server queue.',
  )
})

adminRoutes.post('/historical/pull/tasks/:taskId/batch', async (c) => {
  return jsonError(
    c,
    410,
    'HISTORICAL_LOCAL_WORKER_DEPRECATED',
    'Local historical worker batch ingestion is deprecated. Historical tasks are now executed by the server queue.',
  )
})

adminRoutes.post('/historical/pull/tasks/:taskId/finalize', async (c) => {
  return jsonError(
    c,
    410,
    'HISTORICAL_LOCAL_WORKER_DEPRECATED',
    'Local historical worker finalize is deprecated. Historical tasks are now executed by the server queue.',
  )
})
