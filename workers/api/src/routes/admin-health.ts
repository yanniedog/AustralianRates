import { Hono } from 'hono'
import { SITE_HEALTH_CRON_EXPRESSION } from '../constants'
import { getLatestHealthCheckRun, insertHealthCheckRun, listHealthCheckRuns } from '../db/health-check-runs'
import type { EconomicCoverageReport } from '../db/economic-coverage-audit'
import type { E2EResult } from '../pipeline/e2e-alignment'
import { runSiteHealthChecks } from '../pipeline/site-health'
import type { AppContext } from '../types'
import { withNoStore } from '../utils/http'
import { log } from '../utils/logger'

export const adminHealthRoutes = new Hono<AppContext>()

type ParsedHealthRun = {
  run_id: string
  checked_at: string
  trigger_source: 'scheduled' | 'manual'
  overall_ok: boolean
  duration_ms: number
  components: unknown
  integrity: unknown
  economic: EconomicCoverageReport | Record<string, unknown>
  e2e: E2EResult
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
  const legacyE2EEnvelope = parseJsonSafe(row.e2e_reason_detail, null) as
    | { reason_detail?: string | null; e2e?: E2EResult }
    | null
  const legacyE2E = legacyE2EEnvelope && legacyE2EEnvelope.e2e ? legacyE2EEnvelope.e2e : null
  const fallbackE2E: E2EResult = {
    aligned: Number(row.e2e_aligned || 0) === 1,
    reasonCode: (row.e2e_reason_code as E2EResult['reasonCode']) || 'e2e_check_error',
    reasonDetail:
      (legacyE2EEnvelope && typeof legacyE2EEnvelope.reason_detail === 'string'
        ? legacyE2EEnvelope.reason_detail
        : row.e2e_reason_detail) || undefined,
    checkedAt: row.checked_at,
    targetCollectionDate: null,
    sourceMode: 'all',
    datasets: [],
    criteria: {
      scheduler: Number(row.e2e_aligned || 0) === 1,
      runsProgress: Number(row.e2e_aligned || 0) === 1,
      apiServesLatest: Number(row.e2e_aligned || 0) === 1,
    },
  }
  return {
    run_id: row.run_id,
    checked_at: row.checked_at,
    trigger_source: row.trigger_source,
    overall_ok: Number(row.overall_ok || 0) === 1,
    duration_ms: Number(row.duration_ms || 0),
    components: parseJsonSafe(row.components_json, []),
    integrity: parseJsonSafe(row.integrity_json, { ok: false, checks: [] }),
    economic: parseJsonSafe(row.economic_json, {
      checked_at: row.checked_at,
      summary: { severity: 'red', defined_series: 0, status_rows: 0, observed_series: 0, ok_series: 0, stale_series: 0, error_series: 0, missing_series: 0, invalid_rows: 0, orphan_rows: 0, public_probe_failures: 0 },
      probes: [],
      findings: [],
      per_series: [],
    }) as EconomicCoverageReport,
    e2e: legacyE2E || (parseJsonSafe(row.e2e_json, fallbackE2E) as E2EResult),
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

