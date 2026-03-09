import type { EnvBindings } from '../types'
import { log } from '../utils/logger'

export type AuditStage = 'retrieved' | 'processed' | 'stored' | 'archived' | 'tracked'
export type AuditSeverity = 'info' | 'warn' | 'error'

export type AuditCheckResult = {
  id: string
  stage: AuditStage
  title: string
  passed: boolean
  severity: AuditSeverity
  summary: string
  metrics: Record<string, number | string | boolean | null>
  sample_rows: Array<Record<string, unknown>>
  debug: Record<string, unknown>
  traceback: string | null
}

export type CdrAuditReport = {
  run_id: string
  generated_at: string
  ok: boolean
  totals: {
    checks: number
    failed: number
    errors: number
    warns: number
  }
  stages: Record<AuditStage, AuditCheckResult[]>
  failures: Array<{
    id: string
    stage: AuditStage
    severity: AuditSeverity
    summary: string
  }>
}

let cachedReport: CdrAuditReport | null = null

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toTraceback(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`
  return String(error)
}

function buildFailureResult(
  id: string,
  stage: AuditStage,
  title: string,
  summary: string,
  error: unknown,
  debug: Record<string, unknown>,
): AuditCheckResult {
  return {
    id,
    stage,
    title,
    passed: false,
    severity: 'error',
    summary,
    metrics: {},
    sample_rows: [],
    debug,
    traceback: toTraceback(error),
  }
}

type MetricSampleCheckParams = {
  id: string
  stage: AuditStage
  title: string
  metricSql: string
  sampleSql: string
  failureMessage: string
}

/** Runs one metric query and one sample query; on success calls buildResult; on failure returns buildFailureResult. */
async function runMetricSampleCheck<T extends Record<string, unknown>>(
  env: EnvBindings,
  params: MetricSampleCheckParams,
  buildResult: (
    metricsRow: T | null,
    durationMs: number,
  ) => {
    passed: boolean
    severity: AuditSeverity
    summary: string
    metrics: Record<string, number | string | boolean | null>
  },
): Promise<AuditCheckResult> {
  const startedAt = Date.now()
  try {
    const [metricsRow, sampleRowsResult] = await Promise.all([
      env.DB.prepare(params.metricSql).first<T>(),
      env.DB.prepare(params.sampleSql).all<Record<string, unknown>>(),
    ])
    const sampleRows = sampleRowsResult.results ?? []
    const durationMs = Date.now() - startedAt
    const { passed, severity, summary, metrics } = buildResult(metricsRow ?? null, durationMs)
    return {
      id: params.id,
      stage: params.stage,
      title: params.title,
      passed,
      severity,
      summary,
      metrics,
      sample_rows: sampleRows,
      debug: {
        metric_sql: params.metricSql,
        sample_sql: params.sampleSql,
        duration_ms: durationMs,
      },
      traceback: null,
    }
  } catch (error) {
    return buildFailureResult(
      params.id,
      params.stage,
      params.title,
      params.failureMessage,
      error,
      {
        metric_sql: params.metricSql,
        sample_sql: params.sampleSql,
        duration_ms: Date.now() - startedAt,
      },
    )
  }
}

async function runRetrievedActivityCheck(env: EnvBindings): Promise<AuditCheckResult> {
  return runMetricSampleCheck(
    env,
    {
      id: 'retrieved_activity_24h',
      stage: 'retrieved',
      title: 'Fetch event retrieval activity (24h)',
      metricSql: `SELECT
    COUNT(*) AS total_events,
    SUM(CASE WHEN fetched_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS events_24h,
    SUM(CASE WHEN fetched_at >= datetime('now', '-1 day') AND COALESCE(http_status, 0) >= 400 THEN 1 ELSE 0 END) AS http_errors_24h,
    COUNT(DISTINCT CASE WHEN fetched_at >= datetime('now', '-1 day') THEN lender_code END) AS lenders_24h
    FROM fetch_events`,
      sampleSql: `SELECT
    id, fetched_at, run_id, lender_code, dataset_kind, source_type, http_status, source_url
    FROM fetch_events
    WHERE fetched_at >= datetime('now', '-1 day') AND COALESCE(http_status, 0) >= 400
    ORDER BY fetched_at DESC
    LIMIT 12`,
      failureMessage: 'Failed to query retrieval activity diagnostics.',
    },
    (row) => {
      const totalEvents = toNumber(row?.total_events)
      const events24h = toNumber(row?.events_24h)
      const httpErrors24h = toNumber(row?.http_errors_24h)
      const lenders24h = toNumber(row?.lenders_24h)
      const errorRatePct = events24h > 0 ? Number(((httpErrors24h / events24h) * 100).toFixed(2)) : 100
      const passed = events24h > 0 && errorRatePct <= 25
      return {
        passed,
        severity: passed ? 'info' : 'warn',
        summary: passed
          ? 'Fetch retrieval activity is healthy for the last 24 hours.'
          : 'Retrieval activity is degraded (low throughput or high upstream error rate).',
        metrics: {
          total_events: totalEvents,
          events_24h: events24h,
          http_errors_24h: httpErrors24h,
          http_error_rate_pct: errorRatePct,
          lenders_24h: lenders24h,
        },
      }
    },
  )
}

async function runRetrievedLinkageCheck(env: EnvBindings): Promise<AuditCheckResult> {
  return runMetricSampleCheck(
    env,
    {
      id: 'retrieved_fetch_raw_linkage',
      stage: 'retrieved',
      title: 'Fetch event to raw object linkage',
      metricSql: `SELECT
    COUNT(*) AS missing_raw_object_rows
    FROM fetch_events fe
    LEFT JOIN raw_objects ro ON ro.content_hash = fe.content_hash
    WHERE ro.content_hash IS NULL`,
      sampleSql: `SELECT
    fe.id, fe.fetched_at, fe.run_id, fe.lender_code, fe.dataset_kind, fe.content_hash, fe.source_url
    FROM fetch_events fe
    LEFT JOIN raw_objects ro ON ro.content_hash = fe.content_hash
    WHERE ro.content_hash IS NULL
    ORDER BY fe.fetched_at DESC
    LIMIT 12`,
      failureMessage: 'Failed to validate fetch/raw linkage.',
    },
    (row) => {
      const missingRows = toNumber(row?.missing_raw_object_rows)
      const passed = missingRows === 0
      return {
        passed,
        severity: passed ? 'info' : 'error',
        summary: passed
          ? 'Every fetch_event row links to an archived raw object.'
          : 'Some fetch_event rows are missing linked raw_objects and cannot be fully traced.',
        metrics: { missing_raw_object_rows: missingRows },
      }
    },
  )
}

async function runProcessedAnomalyCheck(env: EnvBindings): Promise<AuditCheckResult> {
  return runMetricSampleCheck(
    env,
    {
      id: 'processed_anomalies_7d',
      stage: 'processed',
      title: 'Ingest anomaly diagnostics (7d)',
      metricSql: `SELECT
    COUNT(*) AS anomalies_7d,
    SUM(CASE WHEN LOWER(COALESCE(severity, 'warn')) = 'error' THEN 1 ELSE 0 END) AS error_anomalies_7d
    FROM ingest_anomalies
    WHERE created_at >= datetime('now', '-7 day')`,
      sampleSql: `SELECT
    id, created_at, run_id, lender_code, dataset_kind, reason, severity, collection_date
    FROM ingest_anomalies
    WHERE created_at >= datetime('now', '-7 day')
    ORDER BY created_at DESC
    LIMIT 12`,
      failureMessage: 'Failed to query ingest anomaly diagnostics.',
    },
    (row) => {
      const anomalies7d = toNumber(row?.anomalies_7d)
      const errorAnomalies7d = toNumber(row?.error_anomalies_7d)
      const passed = errorAnomalies7d === 0
      return {
        passed,
        severity: passed ? 'info' : 'warn',
        summary: passed
          ? 'No error-severity ingest anomalies were recorded in the last 7 days.'
          : 'Error-severity ingest anomalies were recorded and should be reviewed.',
        metrics: { anomalies_7d: anomalies7d, error_anomalies_7d: errorAnomalies7d },
      }
    },
  )
}

async function runProcessedFinalizeGapCheck(env: EnvBindings): Promise<AuditCheckResult> {
  return runMetricSampleCheck(
    env,
    {
      id: 'processed_unfinalized_lender_runs',
      stage: 'processed',
      title: 'Stale lender dataset runs awaiting finalize',
      metricSql: `SELECT
    COUNT(*) AS stale_unfinalized_runs
    FROM lender_dataset_runs
    WHERE finalized_at IS NULL
      AND updated_at < datetime('now', '-2 hour')`,
      sampleSql: `SELECT
    run_id, lender_code, dataset_kind, collection_date, expected_detail_count, completed_detail_count, failed_detail_count, updated_at
    FROM lender_dataset_runs
    WHERE finalized_at IS NULL
      AND updated_at < datetime('now', '-2 hour')
    ORDER BY updated_at ASC
    LIMIT 12`,
      failureMessage: 'Failed to query stale lender run diagnostics.',
    },
    (row) => {
      const staleRuns = toNumber(row?.stale_unfinalized_runs)
      const passed = staleRuns === 0
      return {
        passed,
        severity: passed ? 'info' : 'error',
        summary: passed
          ? 'No stale unfinalized lender_dataset_runs were detected.'
          : 'At least one lender_dataset_run has remained unfinalized beyond the expected processing window.',
        metrics: { stale_unfinalized_runs: staleRuns },
      }
    },
  )
}

async function runStoredFetchEventGapCheck(env: EnvBindings): Promise<AuditCheckResult> {
  const metricSql = `WITH recent_rows AS (
      SELECT 'home_loans' AS dataset_kind, collection_date, bank_name, product_id, fetch_event_id, parsed_at
      FROM historical_loan_rates
      WHERE collection_date >= date('now', '-30 day')
      UNION ALL
      SELECT 'savings' AS dataset_kind, collection_date, bank_name, product_id, fetch_event_id, parsed_at
      FROM historical_savings_rates
      WHERE collection_date >= date('now', '-30 day')
      UNION ALL
      SELECT 'term_deposits' AS dataset_kind, collection_date, bank_name, product_id, fetch_event_id, parsed_at
      FROM historical_term_deposit_rates
      WHERE collection_date >= date('now', '-30 day')
    )
    SELECT
      COUNT(*) AS total_recent_rows,
      SUM(CASE WHEN fetch_event_id IS NULL THEN 1 ELSE 0 END) AS missing_fetch_event_rows
    FROM recent_rows`
  const sampleSql = `WITH recent_rows AS (
      SELECT 'home_loans' AS dataset_kind, collection_date, bank_name, product_id, fetch_event_id, parsed_at
      FROM historical_loan_rates
      WHERE collection_date >= date('now', '-30 day')
      UNION ALL
      SELECT 'savings' AS dataset_kind, collection_date, bank_name, product_id, fetch_event_id, parsed_at
      FROM historical_savings_rates
      WHERE collection_date >= date('now', '-30 day')
      UNION ALL
      SELECT 'term_deposits' AS dataset_kind, collection_date, bank_name, product_id, fetch_event_id, parsed_at
      FROM historical_term_deposit_rates
      WHERE collection_date >= date('now', '-30 day')
    )
    SELECT
      dataset_kind, collection_date, bank_name, product_id, parsed_at
    FROM recent_rows
    WHERE fetch_event_id IS NULL
    ORDER BY parsed_at DESC
    LIMIT 12`
  return runMetricSampleCheck(
    env,
    {
      id: 'stored_missing_fetch_event_links',
      stage: 'stored',
      title: 'Recent stored rows missing fetch_event_id (30d)',
      metricSql,
      sampleSql,
      failureMessage: 'Failed to query stored-row lineage gaps.',
    },
    (row) => {
      const totalRecentRows = toNumber(row?.total_recent_rows)
      const missingRows = toNumber(row?.missing_fetch_event_rows)
      const passed = missingRows === 0
      return {
        passed,
        severity: passed ? 'info' : 'error',
        summary: passed
          ? 'All recent stored rows have fetch_event lineage identifiers.'
          : 'Some recent stored rows are missing fetch_event lineage identifiers.',
        metrics: { total_recent_rows: totalRecentRows, missing_fetch_event_rows: missingRows },
      }
    },
  )
}

async function runStoredSeriesKeyGapCheck(env: EnvBindings): Promise<AuditCheckResult> {
  const metricSql = `WITH recent_rows AS (
      SELECT 'home_loans' AS dataset_kind, collection_date, bank_name, product_id, series_key, parsed_at
      FROM historical_loan_rates
      WHERE collection_date >= date('now', '-30 day')
      UNION ALL
      SELECT 'savings' AS dataset_kind, collection_date, bank_name, product_id, series_key, parsed_at
      FROM historical_savings_rates
      WHERE collection_date >= date('now', '-30 day')
      UNION ALL
      SELECT 'term_deposits' AS dataset_kind, collection_date, bank_name, product_id, series_key, parsed_at
      FROM historical_term_deposit_rates
      WHERE collection_date >= date('now', '-30 day')
    )
    SELECT
      COUNT(*) AS total_recent_rows,
      SUM(CASE WHEN COALESCE(TRIM(series_key), '') = '' THEN 1 ELSE 0 END) AS missing_series_key_rows
    FROM recent_rows`
  const sampleSql = `WITH recent_rows AS (
      SELECT 'home_loans' AS dataset_kind, collection_date, bank_name, product_id, series_key, parsed_at
      FROM historical_loan_rates
      WHERE collection_date >= date('now', '-30 day')
      UNION ALL
      SELECT 'savings' AS dataset_kind, collection_date, bank_name, product_id, series_key, parsed_at
      FROM historical_savings_rates
      WHERE collection_date >= date('now', '-30 day')
      UNION ALL
      SELECT 'term_deposits' AS dataset_kind, collection_date, bank_name, product_id, series_key, parsed_at
      FROM historical_term_deposit_rates
      WHERE collection_date >= date('now', '-30 day')
    )
    SELECT
      dataset_kind, collection_date, bank_name, product_id, parsed_at
    FROM recent_rows
    WHERE COALESCE(TRIM(series_key), '') = ''
    ORDER BY parsed_at DESC
    LIMIT 12`
  return runMetricSampleCheck(
    env,
    {
      id: 'stored_missing_series_keys',
      stage: 'stored',
      title: 'Recent stored rows missing series_key (30d)',
      metricSql,
      sampleSql,
      failureMessage: 'Failed to query series_key storage gaps.',
    },
    (row) => {
      const totalRecentRows = toNumber(row?.total_recent_rows)
      const missingRows = toNumber(row?.missing_series_key_rows)
      const passed = missingRows === 0
      return {
        passed,
        severity: passed ? 'info' : 'error',
        summary: passed
          ? 'All recent rows have a populated series_key.'
          : 'Some recent stored rows are missing series_key and cannot be reliably tracked longitudinally.',
        metrics: { total_recent_rows: totalRecentRows, missing_series_key_rows: missingRows },
      }
    },
  )
}

async function runArchiveHeadSamplingCheck(env: EnvBindings): Promise<AuditCheckResult> {
  const id = 'archived_r2_head_sampling'
  const stage: AuditStage = 'archived'
  const title = 'Archive object availability via bounded R2 HEAD sampling'
  const countSql = `SELECT COUNT(*) AS total_raw_objects FROM raw_objects`
  const sampleSql = `SELECT content_hash, source_type, r2_key, created_at
    FROM raw_objects
    ORDER BY created_at DESC
    LIMIT 16`
  const startedAt = Date.now()

  try {
    const [countRow, sampleRowsResult] = await Promise.all([
      env.DB.prepare(countSql).first<{ total_raw_objects: number }>(),
      env.DB.prepare(sampleSql).all<{ content_hash: string; source_type: string; r2_key: string; created_at: string }>(),
    ])

    const sampleRows = sampleRowsResult.results ?? []
    let missingObjects = 0
    let headErrors = 0
    const sampledDetails: Array<Record<string, unknown>> = []
    for (const sample of sampleRows) {
      try {
        const headResult = await env.RAW_BUCKET.head(sample.r2_key)
        if (!headResult) {
          missingObjects += 1
          sampledDetails.push({ ...sample, archive_head_status: 'missing' })
        } else {
          sampledDetails.push({
            ...sample,
            archive_head_status: 'ok',
            size: headResult.size,
          })
        }
      } catch (error) {
        headErrors += 1
        sampledDetails.push({
          ...sample,
          archive_head_status: 'head_error',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const totalRawObjects = toNumber(countRow?.total_raw_objects)
    const passed = sampleRows.length > 0 && missingObjects === 0 && headErrors === 0
    return {
      id,
      stage,
      title,
      passed,
      severity: passed ? 'info' : 'error',
      summary: passed
        ? 'Sampled archived payloads are accessible via R2 HEAD checks.'
        : 'One or more sampled archive objects were missing or unreadable.',
      metrics: {
        total_raw_objects: totalRawObjects,
        sampled_objects: sampleRows.length,
        missing_objects: missingObjects,
        head_errors: headErrors,
      },
      sample_rows: sampledDetails.slice(0, 12),
      debug: {
        count_sql: countSql,
        sample_sql: sampleSql,
        sample_limit: 16,
        duration_ms: Date.now() - startedAt,
      },
      traceback: null,
    }
  } catch (error) {
    return buildFailureResult(id, stage, title, 'Failed to execute archive HEAD sampling.', error, {
      count_sql: countSql,
      sample_sql: sampleSql,
      duration_ms: Date.now() - startedAt,
    })
  }
}

async function runArchiveCoverageCheck(env: EnvBindings): Promise<AuditCheckResult> {
  return runMetricSampleCheck(
    env,
    {
      id: 'archived_fetch_created_without_raw_object',
      stage: 'archived',
      title: 'Archive consistency for raw_object_created fetch events',
      metricSql: `SELECT
    COUNT(*) AS missing_raw_object_rows
    FROM fetch_events fe
    LEFT JOIN raw_objects ro ON ro.content_hash = fe.content_hash
    WHERE fe.raw_object_created = 1
      AND ro.content_hash IS NULL`,
      sampleSql: `SELECT
    fe.id, fe.fetched_at, fe.run_id, fe.dataset_kind, fe.lender_code, fe.content_hash, fe.source_url
    FROM fetch_events fe
    LEFT JOIN raw_objects ro ON ro.content_hash = fe.content_hash
    WHERE fe.raw_object_created = 1
      AND ro.content_hash IS NULL
    ORDER BY fe.fetched_at DESC
    LIMIT 12`,
      failureMessage: 'Failed to validate archive consistency from fetch_events.',
    },
    (row) => {
      const missingRows = toNumber(row?.missing_raw_object_rows)
      const passed = missingRows === 0
      return {
        passed,
        severity: passed ? 'info' : 'error',
        summary: passed
          ? 'All fetch_events marked as raw_object_created have matching raw_objects.'
          : 'Some fetch_events claim raw object creation but the backing raw_objects rows are missing.',
        metrics: { missing_raw_object_rows: missingRows },
      }
    },
  )
}

async function runTrackedPresenceCoverageCheck(env: EnvBindings): Promise<AuditCheckResult> {
  return runMetricSampleCheck(
    env,
    {
      id: 'tracked_presence_coverage',
      stage: 'tracked',
      title: 'Presence tracking coverage (series + product)',
      metricSql: `SELECT
    (SELECT COUNT(*)
     FROM series_catalog sc
     LEFT JOIN series_presence_status sps ON sps.series_key = sc.series_key
     WHERE sps.series_key IS NULL) AS missing_series_presence_rows,
    (SELECT COUNT(*)
     FROM product_catalog pc
     LEFT JOIN product_presence_status pps
       ON pps.section = CASE pc.dataset_kind
         WHEN 'home_loans' THEN 'home_loans'
         WHEN 'savings' THEN 'savings'
         ELSE 'term_deposits'
       END
      AND pps.bank_name = pc.bank_name
      AND pps.product_id = pc.product_id
     WHERE pps.product_id IS NULL) AS missing_product_presence_rows`,
      sampleSql: `SELECT
    pc.dataset_kind,
    pc.bank_name,
    pc.product_id,
    pc.last_seen_collection_date,
    pc.last_seen_at
    FROM product_catalog pc
    LEFT JOIN product_presence_status pps
      ON pps.section = CASE pc.dataset_kind
        WHEN 'home_loans' THEN 'home_loans'
        WHEN 'savings' THEN 'savings'
        ELSE 'term_deposits'
      END
     AND pps.bank_name = pc.bank_name
     AND pps.product_id = pc.product_id
    WHERE pps.product_id IS NULL
    ORDER BY pc.last_seen_at DESC
    LIMIT 12`,
      failureMessage: 'Failed to query presence tracking coverage.',
    },
    (row) => {
      const missingSeriesPresenceRows = toNumber(row?.missing_series_presence_rows)
      const missingProductPresenceRows = toNumber(row?.missing_product_presence_rows)
      const passed = missingSeriesPresenceRows === 0 && missingProductPresenceRows === 0
      return {
        passed,
        severity: passed ? 'info' : 'error',
        summary: passed
          ? 'Series and product presence tracking tables cover the current catalog.'
          : 'Presence tracking has coverage gaps between catalog and status tables.',
        metrics: {
          missing_series_presence_rows: missingSeriesPresenceRows,
          missing_product_presence_rows: missingProductPresenceRows,
        },
      }
    },
  )
}

async function runTrackedStaleRunsCheck(env: EnvBindings): Promise<AuditCheckResult> {
  return runMetricSampleCheck(
    env,
    {
      id: 'tracked_stale_running_runs',
      stage: 'tracked',
      title: 'Stale running run_reports rows (>6h)',
      metricSql: `SELECT
    COUNT(*) AS stale_running_runs
    FROM run_reports
    WHERE status = 'running'
      AND started_at < datetime('now', '-6 hour')`,
      sampleSql: `SELECT
    run_id, run_type, run_source, started_at, finished_at, status
    FROM run_reports
    WHERE status = 'running'
      AND started_at < datetime('now', '-6 hour')
    ORDER BY started_at ASC
    LIMIT 12`,
      failureMessage: 'Failed to query stale running run_reports diagnostics.',
    },
    (row) => {
      const staleRunningRuns = toNumber(row?.stale_running_runs)
      const passed = staleRunningRuns === 0
      return {
        passed,
        severity: passed ? 'info' : 'error',
        summary: passed
          ? 'No stale run_reports entries remain in running status.'
          : 'At least one run_report has remained in running state beyond the expected threshold.',
        metrics: { stale_running_runs: staleRunningRuns },
      }
    },
  )
}

function buildStageBuckets(checks: AuditCheckResult[]): Record<AuditStage, AuditCheckResult[]> {
  return {
    retrieved: checks.filter((check) => check.stage === 'retrieved'),
    processed: checks.filter((check) => check.stage === 'processed'),
    stored: checks.filter((check) => check.stage === 'stored'),
    archived: checks.filter((check) => check.stage === 'archived'),
    tracked: checks.filter((check) => check.stage === 'tracked'),
  }
}

export function getCachedCdrAuditReport(): CdrAuditReport | null {
  return cachedReport
}

export async function runCdrPipelineAudit(env: EnvBindings): Promise<CdrAuditReport> {
  const generatedAt = new Date().toISOString()
  const runId = `cdr-audit:${generatedAt}:${crypto.randomUUID()}`
  const checks = await Promise.all([
    runRetrievedActivityCheck(env),
    runRetrievedLinkageCheck(env),
    runProcessedAnomalyCheck(env),
    runProcessedFinalizeGapCheck(env),
    runStoredFetchEventGapCheck(env),
    runStoredSeriesKeyGapCheck(env),
    runArchiveHeadSamplingCheck(env),
    runArchiveCoverageCheck(env),
    runTrackedPresenceCoverageCheck(env),
    runTrackedStaleRunsCheck(env),
  ])

  const failedChecks = checks.filter((check) => !check.passed)
  const errorCount = failedChecks.filter((check) => check.severity === 'error').length
  const warnCount = failedChecks.filter((check) => check.severity === 'warn').length

  const report: CdrAuditReport = {
    run_id: runId,
    generated_at: generatedAt,
    ok: failedChecks.length === 0,
    totals: {
      checks: checks.length,
      failed: failedChecks.length,
      errors: errorCount,
      warns: warnCount,
    },
    stages: buildStageBuckets(checks),
    failures: failedChecks.map((check) => ({
      id: check.id,
      stage: check.stage,
      severity: check.severity,
      summary: check.summary,
    })),
  }

  cachedReport = report

  if (report.ok) {
    log.info('admin', 'cdr_audit_completed', {
      context: JSON.stringify({
        run_id: report.run_id,
        checks: report.totals.checks,
      }),
    })
  } else {
    log.warn('admin', 'cdr_audit_detected_gaps', {
      context: JSON.stringify({
        run_id: report.run_id,
        failed: report.totals.failed,
        errors: report.totals.errors,
        warns: report.totals.warns,
      }),
    })
  }

  return report
}
