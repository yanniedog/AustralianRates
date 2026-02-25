import { Hono } from 'hono'
import { requireAdmin } from '../auth/admin'
import { getAdminRealtimeSnapshot } from '../db/admin-realtime'
import { getRunReport, listRunReports } from '../db/run-reports'
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
