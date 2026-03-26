import { Hono } from 'hono'
import { SITE_HEALTH_CRON_EXPRESSION } from '../constants'
import { getLatestHealthCheckRun, insertHealthCheckRun, listHealthCheckRuns } from '../db/health-check-runs'
import { runSiteHealthChecks } from '../pipeline/site-health'
import type { AppContext } from '../types'
import { withNoStore } from '../utils/http'
import { log } from '../utils/logger'
import { mapHealthCheckRunRow } from '../utils/map-health-run'

export const adminHealthRoutes = new Hono<AppContext>()

adminHealthRoutes.get('/health', async (c) => {
  withNoStore(c)
  const limit = Math.max(1, Math.min(200, Number(c.req.query('limit') || 48)))
  const [latest, history] = await Promise.all([
    getLatestHealthCheckRun(c.env.DB),
    listHealthCheckRuns(c.env.DB, limit),
  ])
  return c.json({
    ok: true,
    latest: mapHealthCheckRunRow(latest),
    history: history.map((row) => mapHealthCheckRunRow(row)).filter(Boolean),
    nextCronExpression: SITE_HEALTH_CRON_EXPRESSION,
    auth_mode: c.get('adminAuthState')?.mode || null,
  })
})

adminHealthRoutes.post('/health/run', async (c) => {
  withNoStore(c)
  const origin = `${new URL(c.req.url).origin}`
  log.info('admin', 'health_run_started', {
    code: 'admin_health_run',
    context: { trigger: 'manual', origin },
  })
  const result = await runSiteHealthChecks(c.env, {
    triggerSource: 'manual',
    origin,
  })

  await insertHealthCheckRun(c.env.DB, {
    runId: result.runId,
    checkedAt: result.checkedAt,
    triggerSource: 'manual',
    overallOk: result.overallOk,
    durationMs: result.durationMs,
    componentsJson: JSON.stringify(result.components),
    integrityJson: JSON.stringify(result.integrity),
    economicJson: JSON.stringify(result.economic),
    e2eJson: JSON.stringify(result.e2e),
    e2eAligned: result.e2e.aligned,
    e2eReasonCode: result.e2e.reasonCode,
    e2eReasonDetail: result.e2e.reasonDetail ?? null,
    actionableJson: JSON.stringify(result.actionableIssues),
    failuresJson: JSON.stringify(result.failures),
  })

  log.info('admin', 'health_run_completed', {
    code: 'admin_health_run',
    context: {
      run_id: result.runId,
      overall_ok: result.overallOk,
      duration_ms: result.durationMs,
      failures: result.failures?.length ?? 0,
    },
  })
  return c.json({
    ok: true,
    run: {
      run_id: result.runId,
      checked_at: result.checkedAt,
      overall_ok: result.overallOk,
      duration_ms: result.durationMs,
      components: result.components,
      integrity: result.integrity,
      economic: result.economic,
      e2e: result.e2e,
      actionable: result.actionableIssues,
      failures: result.failures,
    },
    auth_mode: c.get('adminAuthState')?.mode || null,
  })
})

