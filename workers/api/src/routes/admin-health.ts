import { Hono } from 'hono'
import { SITE_HEALTH_CRON_EXPRESSION } from '../constants'
import { getLatestHealthCheckRun, insertHealthCheckRun, listHealthCheckRuns } from '../db/health-check-runs'
import { runSiteHealthChecks } from '../pipeline/site-health'
import type { AppContext } from '../types'
import { withNoStore } from '../utils/http'

export const adminHealthRoutes = new Hono<AppContext>()

type ParsedHealthRun = {
  run_id: string
  checked_at: string
  trigger_source: 'scheduled' | 'manual'
  overall_ok: boolean
  duration_ms: number
  components: unknown
  integrity: unknown
  e2e: {
    aligned: boolean
    reasonCode: string | null
    reasonDetail: string | null
  }
  actionable: unknown
  failures: unknown
}

function parseJsonSafe(raw: string | null | undefined, fallback: unknown): unknown {
  try {
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function mapHealthRow(row: Awaited<ReturnType<typeof getLatestHealthCheckRun>>): ParsedHealthRun | null {
  if (!row) return null
  return {
    run_id: row.run_id,
    checked_at: row.checked_at,
    trigger_source: row.trigger_source,
    overall_ok: Number(row.overall_ok || 0) === 1,
    duration_ms: Number(row.duration_ms || 0),
    components: parseJsonSafe(row.components_json, []),
    integrity: parseJsonSafe(row.integrity_json, { ok: false, checks: [] }),
    e2e: {
      aligned: Number(row.e2e_aligned || 0) === 1,
      reasonCode: row.e2e_reason_code,
      reasonDetail: row.e2e_reason_detail,
    },
    actionable: parseJsonSafe(row.actionable_json, []),
    failures: parseJsonSafe(row.failures_json, []),
  }
}

adminHealthRoutes.get('/health', async (c) => {
  withNoStore(c)
  const limit = Math.max(1, Math.min(200, Number(c.req.query('limit') || 48)))
  const [latest, history] = await Promise.all([
    getLatestHealthCheckRun(c.env.DB),
    listHealthCheckRuns(c.env.DB, limit),
  ])
  return c.json({
    ok: true,
    latest: mapHealthRow(latest),
    history: history.map((row) => mapHealthRow(row)).filter(Boolean),
    nextCronExpression: SITE_HEALTH_CRON_EXPRESSION,
    auth_mode: c.get('adminAuthState')?.mode || null,
  })
})

adminHealthRoutes.post('/health/run', async (c) => {
  withNoStore(c)
  const origin = `${new URL(c.req.url).origin}`
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
    e2eAligned: result.e2e.aligned,
    e2eReasonCode: result.e2e.reasonCode,
    e2eReasonDetail: result.e2e.reasonDetail ?? null,
    actionableJson: JSON.stringify(result.actionableIssues),
    failuresJson: JSON.stringify(result.failures),
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
      e2e: result.e2e,
      actionable: result.actionableIssues,
      failures: result.failures,
    },
    auth_mode: c.get('adminAuthState')?.mode || null,
  })
})

