import { Hono } from 'hono'
import { listReplayQueueRows } from '../db/ingest-replay-queue'
import { listCoverageGapRows } from '../db/lender-dataset-status'
import { dispatchReplayQueue } from '../pipeline/replay-queue'
import {
  getCachedCoverageGapAuditReport,
  loadCoverageGapAuditReport,
  runCoverageGapAudit,
} from '../pipeline/coverage-gap-audit'
import {
  getCachedCoverageGapRemediationReport,
  loadCoverageGapRemediationReport,
} from '../pipeline/coverage-gap-remediation'
import {
  getCachedLenderUniverseAuditReport,
  loadLenderUniverseAuditReport,
  runLenderUniverseAudit,
} from '../pipeline/lender-universe-audit'
import { triggerDailyRun } from '../pipeline/bootstrap-jobs'
import { buildStatusDebugBundle } from '../pipeline/status-debug-bundle'
import type { AppContext } from '../types'
import { jsonError, withNoStore } from '../utils/http'
import type { DatasetKind } from '../../../../packages/shared/src'

export const adminHardeningRoutes = new Hono<AppContext>()

function parseDataset(value: unknown): DatasetKind | undefined {
  return value === 'home_loans' || value === 'savings' || value === 'term_deposits'
    ? value
    : undefined
}

async function latestCoverageCollectionDate(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MAX(ldr.collection_date) AS latest
       FROM lender_dataset_runs ldr
       JOIN run_reports rr
         ON rr.run_id = ldr.run_id
       WHERE rr.run_type = 'daily'
         AND (rr.run_source IS NULL OR rr.run_source = 'scheduled')`,
    )
    .first<{ latest: string | null }>()
  return row?.latest ?? null
}

adminHardeningRoutes.get('/diagnostics/coverage-gaps', async (c) => {
  const refresh = ['1', 'true', 'yes'].includes(String(c.req.query('refresh') || '').trim().toLowerCase())
  const dataset = parseDataset(c.req.query('dataset'))
  const lenderCode = String(c.req.query('lender_code') || '').trim() || undefined
  const collectionDate = String(c.req.query('collection_date') || '').trim() || undefined
  const limit = Math.max(1, Math.min(500, Math.floor(Number(c.req.query('limit') || 100))))
  const lastRemediation =
    getCachedCoverageGapRemediationReport() ||
    await loadCoverageGapRemediationReport(c.env.DB)

  if (c.req.query('dataset') && !dataset) {
    return jsonError(c, 400, 'BAD_REQUEST', 'dataset must be home_loans, savings, or term_deposits')
  }

  if (dataset || lenderCode || collectionDate) {
    const rows = await listCoverageGapRows(c.env.DB, {
      dataset,
      lenderCode,
      collectionDate,
      limit,
    })
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode || null,
      last_remediation: lastRemediation,
      report: {
        collection_date: collectionDate || null,
        totals: {
          gaps: rows.length,
          errors: rows.filter((row) => row.severity === 'error').length,
          warns: rows.filter((row) => row.severity === 'warn').length,
        },
        rows,
      },
    })
  }

  let report =
    getCachedCoverageGapAuditReport() ||
    await loadCoverageGapAuditReport(c.env.DB)
  if (!report || refresh) {
    report = await runCoverageGapAudit(c.env, {
      runSource: 'scheduled',
      idleMinutes: 120,
      limit,
      persist: true,
    })
  }
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    last_remediation: lastRemediation,
    report,
  })
})

adminHardeningRoutes.get('/diagnostics/lender-universe', async (c) => {
  const refresh = ['1', 'true', 'yes'].includes(String(c.req.query('refresh') || '').trim().toLowerCase())
  let report =
    getCachedLenderUniverseAuditReport() ||
    await loadLenderUniverseAuditReport(c.env.DB)
  if (!report || refresh) {
    report = await runLenderUniverseAudit(c.env, { persist: true })
  }
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    report,
  })
})

adminHardeningRoutes.post('/diagnostics/lender-universe/run', async (c) => {
  const report = await runLenderUniverseAudit(c.env, { persist: true })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    report,
  })
})

adminHardeningRoutes.get('/diagnostics/replay-queue', async (c) => {
  const rawStatus = String(c.req.query('status') || '').trim().toLowerCase()
  const status = rawStatus === 'queued' || rawStatus === 'dispatching' || rawStatus === 'succeeded' || rawStatus === 'failed'
    ? rawStatus
    : undefined
  const rows = await listReplayQueueRows(c.env.DB, {
    status,
    limit: Math.max(1, Math.min(200, Math.floor(Number(c.req.query('limit') || 50)))),
  })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    count: rows.length,
    rows,
  })
})

adminHardeningRoutes.post('/runs/replay-dispatch', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const dataset = parseDataset(body.dataset)
  const lenderCode = typeof body.lender_code === 'string'
    ? body.lender_code.trim() || undefined
    : typeof body.lenderCode === 'string'
      ? body.lenderCode.trim() || undefined
      : undefined
  const collectionDate = typeof body.collection_date === 'string'
    ? body.collection_date.trim() || undefined
    : typeof body.collectionDate === 'string'
      ? body.collectionDate.trim() || undefined
      : undefined
  const result = await dispatchReplayQueue(c.env, {
    dataset,
    lenderCode,
    collectionDate,
    limit: Math.max(1, Math.min(200, Math.floor(Number(body.limit || 50)))),
    forceDue: body.force_due == null ? true : Boolean(body.force_due || body.forceDue),
  })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    result,
  })
})

adminHardeningRoutes.post('/runs/reconcile-lender-day', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const collectionDate =
    typeof body.collection_date === 'string'
      ? body.collection_date.trim()
      : typeof body.collectionDate === 'string'
        ? body.collectionDate.trim()
        : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'collection_date must be YYYY-MM-DD')
  }

  const rawLenderCodes = Array.isArray(body.lender_codes)
    ? body.lender_codes
    : Array.isArray(body.lenderCodes)
      ? body.lenderCodes
      : typeof body.lender_code === 'string'
        ? [body.lender_code]
        : typeof body.lenderCode === 'string'
          ? [body.lenderCode]
          : []
  const lenderCodes = rawLenderCodes.map((value) => String(value || '').trim()).filter(Boolean)
  if (lenderCodes.length === 0) {
    return jsonError(c, 400, 'BAD_REQUEST', 'At least one lender_code is required')
  }

  const rawDatasets = Array.isArray(body.datasets) ? body.datasets : []
  const datasets = rawDatasets
    .map((value) => parseDataset(value))
    .filter((value): value is DatasetKind => Boolean(value))
  const selectedDatasets: DatasetKind[] =
    datasets.length > 0 ? datasets : ['home_loans', 'savings', 'term_deposits']

  const replayDispatch = await dispatchReplayQueue(c.env, {
    lenderCode: lenderCodes[0],
    collectionDate,
    dataset: datasets.length === 1 ? datasets[0] : undefined,
    forceDue: true,
    limit: 200,
  })

  const result = await triggerDailyRun(c.env, {
    source: 'manual',
    force: true,
    runIdOverride: `daily:${collectionDate}:reconcile:${crypto.randomUUID()}`,
    collectionDateOverride: collectionDate,
    lenderCodes,
    datasets: selectedDatasets,
  })

  const gapRows = await listCoverageGapRows(c.env.DB, {
    collectionDate: collectionDate || (await latestCoverageCollectionDate(c.env.DB)) || undefined,
    lenderCode: lenderCodes[0],
    limit: 100,
  })

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    replay_dispatch: replayDispatch,
    result,
    post_reconcile_gap_rows: gapRows,
  })
})

adminHardeningRoutes.get('/diagnostics/status-debug-bundle', async (c) => {
  withNoStore(c)
  const q = c.req.query()
  const bundle = await buildStatusDebugBundle(
    c.env,
    {
      sections: q.sections,
      healthHistoryLimit: q.health_history_limit,
      refreshCoverage: q.refresh_coverage,
      refreshLenderUniverse: q.refresh_lender_universe,
      logLimit: q.log_limit,
      since: q.since,
      logHoursBeforeHealth: q.log_hours_before_health,
      includeProbePayloads: q.include_probe_payloads,
      maxProbePayloads: q.max_probe_payloads,
      maxProbePayloadBytes: q.max_probe_payload_bytes,
      backlogLimit: q.backlog_limit,
      coverageLimit: q.coverage_limit,
      replayLimit: q.replay_limit,
      probeEventLimit: q.probe_event_limit,
    },
    c.get('adminAuthState')?.mode ?? null,
  )
  return c.json(bundle)
})
