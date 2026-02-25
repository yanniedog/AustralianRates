import { Hono } from 'hono'
import { requireAdmin } from '../auth/admin'
import { getAdminRealtimeSnapshot } from '../db/admin-realtime'
import { getRunReport, listRunReports } from '../db/run-reports'
import { claimHistoricalPullTask, finalizeHistoricalPullTaskRun, getHistoricalPullDetail, ingestHistoricalPullTaskBatch, startHistoricalPullRun } from '../pipeline/client-historical'
import { triggerBackfillRun, triggerDailyRun } from '../pipeline/bootstrap-jobs'
import { adminClearRoutes } from './admin-clear'
import { adminConfigRoutes } from './admin-config'
import { adminDbRoutes } from './admin-db'
import type { AppContext } from '../types'
import { jsonError, withNoStore } from '../utils/http'
import { log } from '../utils/logger'

export const adminRoutes = new Hono<AppContext>()

adminRoutes.use('*', async (c, next) => {
  withNoStore(c)
  await next()
})

adminRoutes.use('*', requireAdmin())

adminRoutes.route('/', adminConfigRoutes)
adminRoutes.route('/', adminDbRoutes)
adminRoutes.route('/', adminClearRoutes)

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
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const runId = String(body.run_id ?? body.runId ?? '').trim()
  const workerId = String(body.worker_id ?? body.workerId ?? '').trim()
  const claimed = await claimHistoricalPullTask(c.env, { runId, workerId })
  if (!claimed.ok) {
    return jsonError(c, claimed.status as 400 | 401 | 403 | 404 | 409 | 429 | 500, claimed.code, claimed.message, claimed.details)
  }
  return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode || null, ...claimed.value })
})

adminRoutes.post('/historical/pull/tasks/:taskId/batch', async (c) => {
  const taskId = Number(c.req.param('taskId'))
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const runId = String(body.run_id ?? body.runId ?? '').trim()
  const batchId = String(body.batch_id ?? body.batchId ?? '').trim()
  const workerId = String(body.worker_id ?? body.workerId ?? '').trim()
  const mortgageRows = Array.isArray(body.mortgage_rows) ? body.mortgage_rows : Array.isArray(body.mortgageRows) ? body.mortgageRows : []
  const savingsRows = Array.isArray(body.savings_rows) ? body.savings_rows : Array.isArray(body.savingsRows) ? body.savingsRows : []
  const tdRows = Array.isArray(body.td_rows) ? body.td_rows : Array.isArray(body.tdRows) ? body.tdRows : []
  const hadSignals = Boolean(body.had_signals ?? body.hadSignals)

  const ingested = await ingestHistoricalPullTaskBatch(c.env, {
    runId,
    taskId,
    batchId,
    workerId: workerId || null,
    hadSignals,
    mortgageRows: mortgageRows as never[],
    savingsRows: savingsRows as never[],
    tdRows: tdRows as never[],
  })
  if (!ingested.ok) {
    return jsonError(c, ingested.status as 400 | 401 | 403 | 404 | 409 | 429 | 500, ingested.code, ingested.message, ingested.details)
  }
  return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode || null, ...ingested.value })
})

adminRoutes.post('/historical/pull/tasks/:taskId/finalize', async (c) => {
  const taskId = Number(c.req.param('taskId'))
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const runId = String(body.run_id ?? body.runId ?? '').trim()
  const workerId = String(body.worker_id ?? body.workerId ?? '').trim()
  const statusRaw = String(body.status ?? '').trim().toLowerCase()
  const status = statusRaw === 'failed' ? 'failed' : 'completed'
  const error = status === 'failed' ? String(body.error ?? body.last_error ?? '').trim() : null
  const hadSignals = Boolean(body.had_signals ?? body.hadSignals)

  const finalized = await finalizeHistoricalPullTaskRun(c.env, {
    runId,
    taskId,
    workerId: workerId || null,
    status,
    hadSignals,
    error,
  })
  if (!finalized.ok) {
    return jsonError(c, finalized.status as 400 | 401 | 403 | 404 | 409 | 429 | 500, finalized.code, finalized.message, finalized.details)
  }
  return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode || null, ...finalized.value })
})
