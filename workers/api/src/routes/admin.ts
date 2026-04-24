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
import { loadPostIngestAssuranceReport, runPostIngestAssurance } from '../pipeline/post-ingest-assurance'
import { backfillRbaCashRatesForDateRange } from '../ingest/rba'
import { triggerBackfillRun, triggerDailyRun } from '../pipeline/bootstrap-jobs'
import { refreshChartPivotCache, refreshPublicSnapshotPackages } from '../pipeline/chart-cache-refresh'
import { repairMissingFetchEventLineage } from '../pipeline/lineage-repair'
import { FETCH_EVENTS_RETENTION_DAYS, runRetentionPrunes } from '../db/retention-prune'
import { runLifecycleReconciliation, cancelAllRunningRuns } from '../pipeline/run-reconciliation'
import { collectEconomicSeries } from '../economic/collect'
import { getLenderDatasetRun, tryMarkLenderDatasetFinalized } from '../db/lender-dataset-runs'
import { finalizePresenceForRun } from '../db/presence-finalize'
import { adminClearRoutes } from './admin-clear'
import { adminConfigRoutes } from './admin-config'
import { adminDbRoutes } from './admin-db'
import { adminBackupRoutes } from './admin-backups'
import { adminDownloadRoutes } from './admin-downloads'
import { adminHardeningRoutes } from './admin-hardening'
import { adminHealthRoutes } from './admin-health'
import { adminKnownCdrRepairRoutes } from './admin-known-cdr-repair'
import { adminLenderDatasetRepairRoutes } from './admin-lender-dataset-repair'
import { adminLiveCdrRepairRoutes } from './admin-live-cdr-repair'
import { adminLogRoutes } from './admin-logs'
import { adminHistoricalQualityRoutes } from './admin-historical-quality'
import { getMelbourneNowParts } from '../utils/time'
import type { AppContext } from '../types'
import { jsonError, withNoStore } from '../utils/http'
import { log } from '../utils/logger'
import type { DatasetKind } from '../../../../packages/shared/src'
import { backfillHomeLoanOffsetAccounts } from '../db/home-loans/offset-backfill'
import { getDiagnosticsBacklog } from '../db/diagnostics-backlog'
import { registerHomeLoanExportRoutes } from './home-loan-exports'
import { registerSavingsExportRoutes } from './savings-exports'
import { registerTdExportRoutes } from './td-exports'

export const adminRoutes = new Hono<AppContext>()

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
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
adminRoutes.route('/', adminBackupRoutes)
adminRoutes.route('/', adminClearRoutes)
adminRoutes.route('/', adminLogRoutes)
adminRoutes.route('/', adminHealthRoutes)
adminRoutes.route('/', adminHardeningRoutes)
adminRoutes.route('/', adminKnownCdrRepairRoutes)
adminRoutes.route('/', adminLenderDatasetRepairRoutes)
adminRoutes.route('/', adminLiveCdrRepairRoutes)
adminRoutes.route('/', adminRemediationRoutes)
adminRoutes.route('/', adminHistoricalQualityRoutes)

// Admin-only dataset exports (UI is in /admin/exports.html).
registerHomeLoanExportRoutes(adminRoutes, {
  routeBase: '/rate-exports/home-loans',
  pathPrefix: '/admin/rate-exports/home-loans',
  guardCreateJob: () => null,
})
registerSavingsExportRoutes(adminRoutes, {
  routeBase: '/rate-exports/savings',
  pathPrefix: '/admin/rate-exports/savings',
  guardCreateJob: () => null,
})
registerTdExportRoutes(adminRoutes, {
  routeBase: '/rate-exports/term-deposits',
  pathPrefix: '/admin/rate-exports/term-deposits',
  guardCreateJob: () => null,
})

/** Run retention prunes now (30-day raw run-state, long-retention provenance). Use after deploy to compact DB without waiting for next health check. */
adminRoutes.post('/retention/run', async (c) => {
  try {
    await runRetentionPrunes(c.env.DB)
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode ?? null,
      message:
        'Retention prunes completed. global_log: 48h + row cap; raw run-state retained for 30 days, provenance recovery log capped at 30 days, and fetch_events/raw_objects remain long-retention provenance.',
    })
  } catch (error) {
    log.error('admin', 'retention_run_failed', { error, context: '/admin/retention/run' })
    return jsonError(c, 500, 'RETENTION_FAILED', 'Retention run failed.')
  }
})

/**
 * Recompute chart_request_cache, report_plot_request_cache, snapshot_cache (D1),
 * and snapshot KV bundles — same pipeline as the hourly maintenance cron chart leg.
 */
adminRoutes.post('/chart-cache/refresh', async (c) => {
  try {
    const result = await refreshChartPivotCache(c.env)
    log.info('admin', 'chart_cache_refresh_manual', {
      code: 'admin_chart_cache_refresh',
      context: JSON.stringify({ refreshed: result.refreshed, error_count: result.errors.length }),
    })
    return c.json({
      ok: result.ok,
      auth_mode: c.get('adminAuthState')?.mode ?? null,
      refreshed: result.refreshed,
      errors: result.errors,
    })
  } catch (error) {
    log.error('admin', 'chart_cache_refresh_failed', { error, context: '/admin/chart-cache/refresh' })
    return jsonError(
      c,
      500,
      'CHART_CACHE_REFRESH_FAILED',
      error instanceof Error ? error.message : 'Chart cache refresh failed.',
    )
  }
})

/** Recompute only the cache-only public snapshot packages in KV. */
adminRoutes.post('/public-packages/refresh', async (c) => {
  try {
    const full = ['1', 'true', 'yes', 'on'].includes(String(c.req.query('full') || '').trim().toLowerCase())
    const result = await refreshPublicSnapshotPackages(c.env, { allScopes: full })
    log.info('admin', 'public_packages_refresh_manual', {
      code: 'admin_public_packages_refresh',
      context: JSON.stringify({ refreshed: result.refreshed, error_count: result.errors.length, full }),
    })
    return c.json({
      ok: result.ok,
      auth_mode: c.get('adminAuthState')?.mode ?? null,
      full,
      refreshed: result.refreshed,
      errors: result.errors,
    })
  } catch (error) {
    log.error('admin', 'public_packages_refresh_failed', { error, context: '/admin/public-packages/refresh' })
    return jsonError(
      c,
      500,
      'PUBLIC_PACKAGES_REFRESH_FAILED',
      error instanceof Error ? error.message : 'Public package refresh failed.',
    )
  }
})

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

adminRoutes.get('/post-ingest-assurance', async (c) => {
  const report = await loadPostIngestAssuranceReport(c.env.DB)
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    report,
  })
})

adminRoutes.post('/post-ingest-assurance/run', async (c) => {
  try {
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
    const collectionDate = typeof body.collection_date === 'string'
      ? body.collection_date
      : typeof body.collectionDate === 'string'
        ? body.collectionDate
        : undefined
    const report = await runPostIngestAssurance(c.env, {
      collectionDate,
      persist: true,
      emitHardFailureLog: true,
    })
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode || null,
      report,
    })
  } catch (error) {
    log.error('admin', 'post_ingest_assurance_run_failed', {
      error,
      context: JSON.stringify({
        route: '/admin/post-ingest-assurance/run',
      }),
    })
    return jsonError(c, 500, 'POST_INGEST_ASSURANCE_FAILED', 'Post-ingest assurance failed to execute.')
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

  log.info('admin', 'integrity_audit_run_completed', {
    code: 'admin_integrity_audit_run',
    context: { run_id: runId, status: result.status, stored, duration_ms: result.duration_ms },
  })
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

adminRoutes.post('/offset-backfill', async (c) => {
  const limitHashes = clampInt(c.req.query('limit'), 250, 1, 5000)
  const rebuild = String(c.req.query('rebuild') || 'true').trim().toLowerCase() !== 'false'
  try {
    const result = await backfillHomeLoanOffsetAccounts(c.env.DB, {
      limitHashes,
      rebuildProjections: rebuild,
    })
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode || null,
      ...result,
    })
  } catch (error) {
    log.error('admin', 'offset_backfill_failed', {
      error,
      context: JSON.stringify({ route: '/admin/offset-backfill', limitHashes, rebuild }),
    })
    return jsonError(c, 500, 'OFFSET_BACKFILL_FAILED', 'Offset backfill failed to execute.')
  }
})

adminRoutes.get('/diagnostics/backlog', async (c) => {
  const limit = clampInt(c.req.query('limit'), 200, 1, 1000)
  const idleMinutes = clampInt(c.req.query('idle_minutes'), 5, 1, 1440)
  const staleRunMinutes = clampInt(c.req.query('stale_run_minutes'), 120, 1, 10080)
  const lookbackDays = clampInt(c.req.query('lookback_days'), 365, 1, 3650)
  const backlog = await getDiagnosticsBacklog(c.env.DB, {
    limit,
    idleMinutes,
    staleRunMinutes,
    lookbackDays,
  })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    backlog,
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

adminRoutes.post('/economic/collect', async (c) => {
  try {
    const result = await collectEconomicSeries(c.env)
    return c.json({
      ok: result.ok,
      auth_mode: c.get('adminAuthState')?.mode || null,
      result,
    })
  } catch (error) {
    log.error('admin', 'economic_collect_failed', {
      error,
      context: JSON.stringify({
        route: '/admin/economic/collect',
      }),
    })
    return jsonError(c, 500, 'ECONOMIC_COLLECT_FAILED', 'Economic collection failed to execute.')
  }
})

adminRoutes.post('/runs/reconcile', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const dryRun = Boolean(body.dry_run ?? body.dryRun)
  const result = await runLifecycleReconciliation(c.env.DB, {
    dryRun,
    idleMinutes: 5,
    staleRunMinutes: 90,
    timeZone: c.env.MELBOURNE_TIMEZONE,
  })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    result,
  })
})

/** Cancel all runs that are still pending or in progress (status = 'running'). Force-finalizes their lender_dataset_runs first to retain info. Body: { dry_run?: boolean }. */
adminRoutes.post('/runs/cancel-all-running', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const dryRun = Boolean(body.dry_run ?? body.dryRun)
  const result = await cancelAllRunningRuns(c.env.DB, { dryRun })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    cancelled: result.cancelled,
    run_ids: result.run_ids,
    errors: result.errors,
    dry_run: result.dry_run,
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
  const runId = String(body.run_id ?? body.runId ?? '').trim() || undefined
  const datasetValue = body.dataset == null ? undefined : String(body.dataset)
  const dataset = datasetValue ? parseDatasetFilter(datasetValue) : undefined
  if (dataset === null || dataset === 'all') {
    return jsonError(c, 400, 'INVALID_REQUEST', 'dataset must be one of home_loans, savings, term_deposits.')
  }
  if (!runId && Number.isFinite(lookbackDays) && lookbackDays > FETCH_EVENTS_RETENTION_DAYS) {
    return jsonError(
      c,
      400,
      'LOOKBACK_TOO_BROAD',
      `Broad lineage repair without run_id is limited to ${FETCH_EVENTS_RETENTION_DAYS} day(s) to stay within retained provenance and D1 CPU limits.`,
      {
        retained_window_days: FETCH_EVENTS_RETENTION_DAYS,
        requested_lookback_days: lookbackDays,
        advice: 'Pass run_id for targeted historical repair, or retry with a smaller lookback_days window.',
      },
    )
  }
  const result = await repairMissingFetchEventLineage(c.env, {
    dryRun,
    lookbackDays,
    runId,
    dataset,
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
