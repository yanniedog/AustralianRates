import { Hono } from 'hono'
import { requireAdmin } from '../auth/admin'
import { getAnalyticsProjectionDiagnostics, rebuildAnalyticsProjections } from '../db/analytics/rebuild'
import { getAdminRealtimeSnapshot } from '../db/admin-realtime'
import { getFetchEventById, getRecentFetchEvents } from '../db/fetch-events'
import { getRunReport, listRunReports } from '../db/run-reports'
import { MELBOURNE_TIMEZONE } from '../constants'
import { adminRemediationRoutes } from './admin-remediation'
import { getHistoricalPullDetail, startHistoricalPullRun } from '../pipeline/client-historical'
import { runDataIntegrityAudit } from '../db/data-integrity-audit'
import {
  getLatestIntegrityAuditRun,
  insertIntegrityAuditRun,
  listIntegrityAuditRuns,
} from '../db/integrity-audit-runs'
import { getCachedCdrAuditReport, runCdrPipelineAudit } from '../pipeline/cdr-audit'
import { backfillRbaCashRatesForDateRange } from '../ingest/rba'
import { triggerBackfillRun, triggerDailyRun } from '../pipeline/bootstrap-jobs'
import { repairMissingFetchEventLineage } from '../pipeline/lineage-repair'
import { runLifecycleReconciliation } from '../pipeline/run-reconciliation'
import { getLenderDatasetRun, tryMarkLenderDatasetFinalized } from '../db/lender-dataset-runs'
import { finalizePresenceForRun } from '../db/presence-finalize'
import { adminClearRoutes } from './admin-clear'
import { adminConfigRoutes } from './admin-config'
import { adminDbRoutes } from './admin-db'
import { adminDownloadRoutes } from './admin-downloads'
import { adminHardeningRoutes } from './admin-hardening'
import { adminHealthRoutes } from './admin-health'
import { adminLiveCdrRepairRoutes } from './admin-live-cdr-repair'
import { adminLogRoutes } from './admin-logs'
import { getMelbourneNowParts } from '../utils/time'
import type { AppContext } from '../types'
import { jsonError, withNoStore } from '../utils/http'
import { log } from '../utils/logger'
import type { DatasetKind } from '../../../../packages/shared/src'

export const adminRoutes = new Hono<AppContext>()

type BacklogRow = {
  dataset_kind: string
  lender_code: string | null
  bank_name: string | null
  count: number
  oldest_updated_at?: string | null
  newest_updated_at?: string | null
  oldest_collection_date?: string | null
  newest_collection_date?: string | null
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - Math.max(1, minutes) * 60 * 1000).toISOString()
}

function daysAgoDate(days: number): string {
  return new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function backlogTotal(rows: BacklogRow[]): number {
  return rows.reduce((sum, row) => sum + Number(row.count || 0), 0)
}

function parseDatasetFilter(value: string | undefined): DatasetKind | 'all' | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || normalized === 'all') return 'all'
  if (normalized === 'home_loans' || normalized === 'savings' || normalized === 'term_deposits') return normalized
  return null
}

adminRoutes.use('*', async (c, next) => {
  withNoStore(c)
  await next()
})

adminRoutes.use('*', requireAdmin())

/** Lightweight auth check for admin login (no DB). Returns 200 when token is valid. */
adminRoutes.get('/auth-check', async (c) => {
  log.info('admin', 'auth_check_ok', {
    code: 'admin_auth_check',
    context: { path: '/admin/auth-check', mode: c.get('adminAuthState')?.mode ?? null },
  })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
  })
})

adminRoutes.route('/', adminConfigRoutes)
adminRoutes.route('/', adminDbRoutes)
adminRoutes.route('/', adminDownloadRoutes)
adminRoutes.route('/', adminClearRoutes)
adminRoutes.route('/', adminLogRoutes)
adminRoutes.route('/', adminHealthRoutes)
adminRoutes.route('/', adminHardeningRoutes)
adminRoutes.route('/', adminLiveCdrRepairRoutes)
adminRoutes.route('/', adminRemediationRoutes)

adminRoutes.get('/cdr-audit', async (c) => {
  let report = getCachedCdrAuditReport()
  if (!report) {
    report = await runCdrPipelineAudit(c.env)
  }
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    report,
  })
})

adminRoutes.post('/cdr-audit/run', async (c) => {
  try {
    const report = await runCdrPipelineAudit(c.env)
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode || null,
      report,
    })
  } catch (error) {
    log.error('admin', 'cdr_audit_run_failed', {
      error,
      context: JSON.stringify({
        route: '/admin/cdr-audit/run',
      }),
    })
    return jsonError(c, 500, 'CDR_AUDIT_FAILED', 'CDR pipeline audit failed to execute.')
  }
})

adminRoutes.get('/integrity-audit', async (c) => {
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') || 20)))
  const [latest, history] = await Promise.all([
    getLatestIntegrityAuditRun(c.env.DB),
    listIntegrityAuditRuns(c.env.DB, limit),
  ])
  const parse = (row: { summary_json: string; findings_json: string } | null) => {
    if (!row) return null
    try {
      return {
        ...row,
        summary: JSON.parse(row.summary_json || '{}'),
        findings: JSON.parse(row.findings_json || '[]'),
      }
    } catch {
      return { ...row, summary: {}, findings: [] }
    }
  }
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    latest: latest ? parse(latest) : null,
    history: history.map((row) => parse(row)).filter(Boolean),
  })
})

function serializeError(e: unknown): { message: string; name: string; stack: string | null } {
  if (e instanceof Error) {
    return { message: e.message, name: e.name, stack: e.stack ?? null }
  }
  return {
    message: String(e),
    name: 'NonError',
    stack: null,
  }
}

adminRoutes.post('/integrity-audit/run', async (c) => {
  let result: Awaited<ReturnType<typeof runDataIntegrityAudit>>
  try {
    const timezone = c.env.MELBOURNE_TIMEZONE || 'Australia/Melbourne'
    result = await runDataIntegrityAudit(c.env.DB, timezone)
  } catch (error) {
    const errSer = serializeError(error)
    log.error('admin', 'integrity_audit_run_failed', {
      error,
      context: JSON.stringify({
        route: '/admin/integrity-audit/run',
        errorMessage: errSer.message,
        errorName: errSer.name,
        errorStack: errSer.stack,
      }),
    })
    return jsonError(c, 500, 'INTEGRITY_AUDIT_FAILED', 'Data integrity audit failed to execute.')
  }

  const runId = `integrity:manual:${result.checked_at}:${crypto.randomUUID()}`
  let stored = false
  try {
    await insertIntegrityAuditRun(c.env.DB, {
      runId,
      checkedAt: result.checked_at,
      triggerSource: 'manual',
      overallOk: result.ok,
      durationMs: result.duration_ms,
      status: result.status,
      summaryJson: JSON.stringify(result.summary),
      findingsJson: JSON.stringify(result.findings),
    })
    stored = true
  } catch (error) {
    const errSer = serializeError(error)
    log.error('admin', 'integrity_audit_insert_failed', {
      error,
      context: JSON.stringify({
        route: '/admin/integrity-audit/run',
        run_id: runId,
        hint: 'Ensure migration 0029_integrity_audit_runs.sql is applied to D1.',
        errorMessage: errSer.message,
        errorName: errSer.name,
      }),
    })
  }

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    stored,
    run_id: runId,
    status: result.status,
    checked_at: result.checked_at,
    duration_ms: result.duration_ms,
    summary: result.summary,
    findings: result.findings,
  })
})

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

adminRoutes.get('/diagnostics/backlog', async (c) => {
  const limit = clampInt(c.req.query('limit'), 200, 1, 1000)
  const idleMinutes = clampInt(c.req.query('idle_minutes'), 5, 1, 1440)
  const staleRunMinutes = clampInt(c.req.query('stale_run_minutes'), 120, 1, 10080)
  const lookbackDays = clampInt(c.req.query('lookback_days'), 365, 1, 3650)
  const readyCutoffIso = minutesAgoIso(idleMinutes)
  const staleCutoffIso = minutesAgoIso(staleRunMinutes)
  const lineageCutoffDate = daysAgoDate(lookbackDays)

  const [readyFinalizations, staleRunningRuns, missingFetchEventLineage] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT
           dataset_kind,
           lender_code,
           bank_name,
           COUNT(*) AS count,
           MIN(updated_at) AS oldest_updated_at,
           MAX(updated_at) AS newest_updated_at
         FROM lender_dataset_runs
         WHERE finalized_at IS NULL
           AND (
             expected_detail_count <= 0
             OR (completed_detail_count + failed_detail_count) >= expected_detail_count
           )
           AND updated_at <= ?1
         GROUP BY dataset_kind, lender_code, bank_name
         ORDER BY count DESC, dataset_kind ASC, lender_code ASC
         LIMIT ?2`,
      )
      .bind(readyCutoffIso, limit)
      .all<BacklogRow>(),
    c.env.DB
      .prepare(
        `SELECT
           ldr.dataset_kind,
           ldr.lender_code,
           ldr.bank_name,
           COUNT(*) AS count,
           MIN(rr.started_at) AS oldest_updated_at,
           MAX(rr.started_at) AS newest_updated_at
         FROM lender_dataset_runs ldr
         JOIN run_reports rr
           ON rr.run_id = ldr.run_id
         WHERE rr.status = 'running'
           AND rr.started_at < ?1
           AND ldr.finalized_at IS NULL
         GROUP BY ldr.dataset_kind, ldr.lender_code, ldr.bank_name
         ORDER BY count DESC, ldr.dataset_kind ASC, ldr.lender_code ASC
         LIMIT ?2`,
      )
      .bind(staleCutoffIso, limit)
      .all<BacklogRow>(),
    c.env.DB
      .prepare(
        `SELECT
           dataset_kind,
           lender_code,
           bank_name,
           count,
           oldest_collection_date,
           newest_collection_date
         FROM (
           SELECT
             'home_loans' AS dataset_kind,
             NULL AS lender_code,
             bank_name,
             COUNT(*) AS count,
             MIN(collection_date) AS oldest_collection_date,
             MAX(collection_date) AS newest_collection_date
           FROM historical_loan_rates
           WHERE fetch_event_id IS NULL
             AND collection_date >= ?1
           GROUP BY bank_name
           UNION ALL
           SELECT
             'savings',
             NULL,
             bank_name,
             COUNT(*),
             MIN(collection_date),
             MAX(collection_date)
           FROM historical_savings_rates
           WHERE fetch_event_id IS NULL
             AND collection_date >= ?1
           GROUP BY bank_name
           UNION ALL
           SELECT
             'term_deposits',
             NULL,
             bank_name,
             COUNT(*),
             MIN(collection_date),
             MAX(collection_date)
           FROM historical_term_deposit_rates
           WHERE fetch_event_id IS NULL
             AND collection_date >= ?1
           GROUP BY bank_name
         )
         ORDER BY count DESC, dataset_kind ASC, bank_name ASC
         LIMIT ?2`,
      )
      .bind(lineageCutoffDate, limit)
      .all<BacklogRow>(),
  ])

  const readyRows = readyFinalizations.results ?? []
  const staleRows = staleRunningRuns.results ?? []
  const missingRows = missingFetchEventLineage.results ?? []

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    backlog: {
      ready_finalizations: {
        total: backlogTotal(readyRows),
        cutoff_iso: readyCutoffIso,
        idle_minutes: idleMinutes,
        rows: readyRows,
      },
      stale_running_runs: {
        total: backlogTotal(staleRows),
        cutoff_iso: staleCutoffIso,
        stale_run_minutes: staleRunMinutes,
        rows: staleRows,
      },
      missing_fetch_event_lineage: {
        total: backlogTotal(missingRows),
        cutoff_date: lineageCutoffDate,
        lookback_days: lookbackDays,
        rows: missingRows,
      },
    },
  })
})

adminRoutes.get('/diagnostics/fetch-events', async (c) => {
  const dataset = c.req.query('dataset') as DatasetKind | undefined
  const lenderCode = c.req.query('lender_code') || undefined
  const sourceType = c.req.query('source_type') || undefined
  const sourceTypePrefix = c.req.query('source_type_prefix') || undefined
  const probeOnly = String(c.req.query('probe_only') || '').toLowerCase()
  const limit = Number(c.req.query('limit') || 100)
  const events = await getRecentFetchEvents(c.env.DB, {
    dataset,
    lenderCode,
    sourceType,
    sourceTypePrefix: sourceTypePrefix || (probeOnly === '1' || probeOnly === 'true' ? 'probe_' : undefined),
    limit,
  })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    count: events.length,
    events,
  })
})

adminRoutes.get('/diagnostics/fetch-events/:fetchEventId/payload', async (c) => {
  const fetchEventId = Number(c.req.param('fetchEventId'))
  if (!Number.isFinite(fetchEventId) || fetchEventId <= 0) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'fetchEventId must be a positive integer.')
  }
  const event = await getFetchEventById(c.env.DB, fetchEventId)
  if (!event) {
    return jsonError(c, 404, 'NOT_FOUND', `Fetch event not found: ${fetchEventId}`)
  }
  if (!event.r2Key) {
    return jsonError(c, 404, 'PAYLOAD_NOT_FOUND', `No raw payload object found for fetch event: ${fetchEventId}`)
  }

  const object = await c.env.RAW_BUCKET.get(event.r2Key)
  if (!object) {
    return jsonError(c, 404, 'PAYLOAD_NOT_FOUND', `Raw payload object missing from storage for fetch event: ${fetchEventId}`)
  }

  const rawMode = (() => {
    const value = String(c.req.query('raw') || '').trim().toLowerCase()
    return value === '1' || value === 'true' || value === 'yes'
  })()
  const bodyText = await object.text()

  if (rawMode) {
    return new Response(bodyText, {
      status: 200,
      headers: {
        'content-type': event.contentType || 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    event,
    payload: {
      body: bodyText,
      content_type: event.contentType || 'text/plain; charset=utf-8',
      body_bytes: bodyText.length,
    },
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

adminRoutes.get('/analytics/projections/diagnostics', async (c) => {
  const dataset = parseDatasetFilter(c.req.query('dataset'))
  if (dataset == null) {
    return jsonError(c, 400, 'BAD_REQUEST', 'dataset must be all, home_loans, savings, or term_deposits')
  }
  const diagnostics = await getAnalyticsProjectionDiagnostics(c.env.DB, dataset)
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    diagnostics,
  })
})

adminRoutes.post('/analytics/projections/rebuild', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const dataset = parseDatasetFilter(String(body.dataset ?? body.scope ?? 'all'))
  if (dataset == null) {
    return jsonError(c, 400, 'BAD_REQUEST', 'dataset must be all, home_loans, savings, or term_deposits')
  }
  const batchSize = clampInt(String(body.batch_size ?? body.batchSize ?? 250), 250, 1, 1000)
  const limitRows = body.limit_rows == null && body.limitRows == null
    ? undefined
    : clampInt(String(body.limit_rows ?? body.limitRows ?? 0), 0, 0, 1_000_000)
  const resume = body.resume == null
    ? true
    : !(String(body.resume).trim().toLowerCase() === 'false' || String(body.resume).trim() === '0')
  const result = await rebuildAnalyticsProjections(c.env.DB, {
    dataset,
    fromDate: typeof body.from_date === 'string' ? body.from_date : typeof body.fromDate === 'string' ? body.fromDate : undefined,
    toDate: typeof body.to_date === 'string' ? body.to_date : typeof body.toDate === 'string' ? body.toDate : undefined,
    batchSize,
    limitRows: limitRows && limitRows > 0 ? limitRows : undefined,
    resume,
  })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    result,
  })
})

adminRoutes.post('/runs/daily', async (c) => {
  log.info('admin', 'Manual daily run triggered')
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const force = Boolean(body.force)
  const runIdOverride = typeof (body.run_id_override ?? body.runIdOverride) === 'string'
    ? String(body.run_id_override ?? body.runIdOverride).trim() || undefined
    : undefined
  const rawLenderCodes = Array.isArray(body.lender_codes) ? body.lender_codes : Array.isArray(body.lenderCodes) ? body.lenderCodes : undefined
  const lenderCodes = rawLenderCodes
    ? rawLenderCodes.map((value) => String(value || '').trim()).filter(Boolean)
    : undefined
  const rawDatasets = Array.isArray(body.datasets) ? body.datasets : Array.isArray(body.datasetKinds) ? body.datasetKinds : undefined
  const datasets = rawDatasets
    ? rawDatasets
        .map((value) => String(value || '').trim())
        .filter((value) => value === 'home_loans' || value === 'savings' || value === 'term_deposits')
    : undefined
  const sourceOverride = body.source_override ?? body.sourceOverride
  const source = sourceOverride === 'scheduled' || sourceOverride === 'manual'
    ? sourceOverride
    : 'manual'

  const result = await triggerDailyRun(c.env, {
    source,
    force,
    runIdOverride,
    lenderCodes,
    datasets,
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

adminRoutes.post('/rba/backfill', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const melbourneDate = getMelbourneNowParts(new Date(), c.env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE).date
  const startDate = String(body.start_date ?? body.startDate ?? '2026-02-15').trim() || '2026-02-15'
  const endDate = String(body.end_date ?? body.endDate ?? melbourneDate).trim() || melbourneDate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return c.json({ ok: false, error: 'start_date and end_date must be YYYY-MM-DD' }, 400)
  }
  if (startDate > endDate) {
    return c.json({ ok: false, error: 'start_date must be <= end_date' }, 400)
  }
  const result = await backfillRbaCashRatesForDateRange(c.env.DB, startDate, endDate, c.env)
  return c.json({
    ok: result.ok,
    auth_mode: c.get('adminAuthState')?.mode || null,
    result,
  })
})

adminRoutes.post('/runs/reconcile', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const dryRun = Boolean(body.dry_run ?? body.dryRun)
  const result = await runLifecycleReconciliation(c.env.DB, {
    dryRun,
    idleMinutes: 5,
    staleRunMinutes: 120,
  })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    result,
  })
})

/** Force-finalize a stuck lender_dataset_run (e.g. when detail processing is incomplete but run should be closed). Body: { run_id, lender_code, dataset }. */
adminRoutes.post('/runs/lender-dataset/force-finalize', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const runId = String(body.run_id ?? body.runId ?? '').trim()
  const lenderCode = String(body.lender_code ?? body.lenderCode ?? '').trim().toLowerCase()
  const datasetRaw = String(body.dataset ?? '').trim().toLowerCase()
  const dataset: DatasetKind | null =
    datasetRaw === 'home_loans' || datasetRaw === 'savings' || datasetRaw === 'term_deposits' ? datasetRaw : null
  if (!runId || !lenderCode || !dataset) {
    return jsonError(c, 400, 'BAD_REQUEST', 'run_id, lender_code, and dataset (home_loans|savings|term_deposits) required', {
      run_id: runId || null,
      lender_code: lenderCode || null,
      dataset: dataset ?? (datasetRaw || null),
    })
  }
  const run = await getLenderDatasetRun(c.env.DB, { runId, lenderCode, dataset })
  if (!run) {
    return jsonError(c, 404, 'RUN_NOT_FOUND', 'Lender dataset run not found', { run_id: runId, lender_code: lenderCode, dataset })
  }
  if (run.finalized_at) {
    return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode || null, already_finalized: true })
  }
  try {
    if (Number(run.expected_detail_count ?? 0) > 0) {
      await finalizePresenceForRun(c.env.DB, {
        runId,
        lenderCode,
        dataset,
        bankName: run.bank_name,
        collectionDate: run.collection_date,
      })
    }
    const marked = await tryMarkLenderDatasetFinalized(c.env.DB, { runId, lenderCode, dataset })
    if (!marked) {
      return jsonError(c, 409, 'CONCURRENT_UPDATE', 'Run was finalized by another request')
    }
    log.info('admin', 'lender_dataset_force_finalized', {
      runId,
      lenderCode,
      context: `dataset=${dataset} expected=${run.expected_detail_count} completed=${run.completed_detail_count} failed=${run.failed_detail_count}`,
    })
    return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode || null, finalized: true })
  } catch (error) {
    log.warn('admin', 'lender_dataset_force_finalize_failed', {
      runId,
      lenderCode,
      context: `dataset=${dataset} error=${(error as Error)?.message ?? 'unknown'}`,
    })
    return jsonError(c, 500, 'FINALIZE_FAILED', (error as Error)?.message ?? 'Force finalize failed', {})
  }
})

adminRoutes.post('/runs/repair-lineage', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const dryRun = Boolean(body.dry_run ?? body.dryRun)
  const lookbackDays = Number(body.lookback_days ?? body.lookbackDays ?? 365)
  const result = await repairMissingFetchEventLineage(c.env, {
    dryRun,
    lookbackDays,
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
