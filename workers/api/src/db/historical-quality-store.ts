import type { DatasetKind } from '../../../../packages/shared/src'
import type {
  HistoricalQualityDailyRow,
  HistoricalQualityFindingRow,
  HistoricalQualityMode,
  HistoricalQualityOriginClass,
  HistoricalQualityRunRow,
  HistoricalQualityRunStatus,
  HistoricalQualityScope,
  HistoricalQualitySeverity,
} from './historical-quality-types'

function json(value: unknown): string {
  return JSON.stringify(value ?? {})
}

export async function createHistoricalQualityRun(
  db: D1Database,
  input: {
    auditRunId: string
    triggerSource: 'manual' | 'resume' | 'script' | 'scheduled'
    targetDb?: string
    criteriaVersion?: string
    status?: HistoricalQualityRunStatus
    mode?: HistoricalQualityMode
    nextCollectionDate?: string | null
    nextScope?: Exclude<HistoricalQualityScope, 'overall'> | null
    totalDates?: number
    filters?: Record<string, unknown>
    summary?: Record<string, unknown>
    artifacts?: Record<string, unknown>
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO historical_quality_runs (
         audit_run_id, trigger_source, target_db, criteria_version, status, mode,
         next_collection_date, next_scope, total_dates, filters_json, summary_json, artifacts_json, started_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(
      input.auditRunId,
      input.triggerSource,
      input.targetDb ?? 'australianrates_api',
      input.criteriaVersion ?? 'v1',
      input.status ?? 'pending',
      input.mode ?? 'whole_date_scope',
      input.nextCollectionDate ?? null,
      input.nextScope ?? null,
      Math.max(0, Math.floor(input.totalDates ?? 0)),
      json(input.filters ?? {}),
      json(input.summary ?? {}),
      json(input.artifacts ?? {}),
    )
    .run()
}

export async function restartHistoricalQualityRun(
  db: D1Database,
  input: {
    auditRunId: string
    triggerSource: 'manual' | 'resume' | 'script' | 'scheduled'
    targetDb?: string
    criteriaVersion?: string
    status?: HistoricalQualityRunStatus
    mode?: HistoricalQualityMode
    nextCollectionDate?: string | null
    nextScope?: Exclude<HistoricalQualityScope, 'overall'> | null
    totalDates?: number
    filters?: Record<string, unknown>
    summary?: Record<string, unknown>
    artifacts?: Record<string, unknown>
  },
): Promise<void> {
  await db.prepare(`DELETE FROM historical_quality_daily WHERE audit_run_id = ?1`).bind(input.auditRunId).run()
  await db.prepare(`DELETE FROM historical_quality_findings WHERE audit_run_id = ?1`).bind(input.auditRunId).run()
  await db
    .prepare(
      `UPDATE historical_quality_runs
       SET trigger_source = ?2,
           target_db = ?3,
           criteria_version = ?4,
           status = ?5,
           mode = ?6,
           next_collection_date = ?7,
           next_scope = ?8,
           lender_cursor = NULL,
           total_dates = ?9,
           processed_batches = 0,
           completed_dates = 0,
           last_error = NULL,
           filters_json = ?10,
           summary_json = ?11,
           artifacts_json = ?12,
           started_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP,
           finished_at = NULL
       WHERE audit_run_id = ?1`,
    )
    .bind(
      input.auditRunId,
      input.triggerSource,
      input.targetDb ?? 'australianrates_api',
      input.criteriaVersion ?? 'v1',
      input.status ?? 'pending',
      input.mode ?? 'whole_date_scope',
      input.nextCollectionDate ?? null,
      input.nextScope ?? null,
      Math.max(0, Math.floor(input.totalDates ?? 0)),
      json(input.filters ?? {}),
      json(input.summary ?? {}),
      json(input.artifacts ?? {}),
    )
    .run()
}

export async function updateHistoricalQualityRun(
  db: D1Database,
  auditRunId: string,
  patch: {
    status?: HistoricalQualityRunStatus
    mode?: HistoricalQualityMode
    nextCollectionDate?: string | null
    nextScope?: Exclude<HistoricalQualityScope, 'overall'> | null
    lenderCursor?: string | null
    processedBatchesDelta?: number
    completedDatesDelta?: number
    lastError?: string | null
    summary?: Record<string, unknown>
    artifacts?: Record<string, unknown>
    finished?: boolean
  },
): Promise<void> {
  const existing = await getHistoricalQualityRun(db, auditRunId)
  if (!existing) return
  await db
    .prepare(
      `UPDATE historical_quality_runs
       SET status = ?2,
           mode = ?3,
           next_collection_date = ?4,
           next_scope = ?5,
           lender_cursor = ?6,
           processed_batches = ?7,
           completed_dates = ?8,
           last_error = ?9,
           summary_json = ?10,
           artifacts_json = ?11,
           updated_at = CURRENT_TIMESTAMP,
           finished_at = CASE WHEN ?12 = 1 THEN CURRENT_TIMESTAMP ELSE finished_at END
       WHERE audit_run_id = ?1`,
    )
    .bind(
      auditRunId,
      patch.status ?? existing.status,
      patch.mode ?? existing.mode,
      patch.nextCollectionDate === undefined ? existing.next_collection_date : patch.nextCollectionDate,
      patch.nextScope === undefined ? existing.next_scope : patch.nextScope,
      patch.lenderCursor === undefined ? existing.lender_cursor : patch.lenderCursor,
      existing.processed_batches + Math.max(0, Math.floor(patch.processedBatchesDelta ?? 0)),
      existing.completed_dates + Math.max(0, Math.floor(patch.completedDatesDelta ?? 0)),
      patch.lastError === undefined ? existing.last_error : patch.lastError,
      patch.summary ? json(patch.summary) : existing.summary_json,
      patch.artifacts ? json(patch.artifacts) : existing.artifacts_json,
      patch.finished ? 1 : 0,
    )
    .run()
}

export async function getHistoricalQualityRun(db: D1Database, auditRunId: string): Promise<HistoricalQualityRunRow | null> {
  const row = await db
    .prepare(`SELECT * FROM historical_quality_runs WHERE audit_run_id = ?1`)
    .bind(auditRunId)
    .first<HistoricalQualityRunRow>()
  return row ?? null
}

export async function listHistoricalQualityRuns(db: D1Database, limit = 20): Promise<HistoricalQualityRunRow[]> {
  const rows = await db
    .prepare(`SELECT * FROM historical_quality_runs ORDER BY started_at DESC LIMIT ?1`)
    .bind(Math.max(1, Math.min(100, Math.floor(limit))))
    .all<HistoricalQualityRunRow>()
  return rows.results ?? []
}

export async function upsertHistoricalQualityDaily(db: D1Database, row: HistoricalQualityDailyRow): Promise<void> {
  const columns = Object.keys(row)
  const placeholders = columns.map((_, index) => `?${index + 1}`).join(', ')
  const updates = columns
    .filter((column) => !['audit_run_id', 'collection_date', 'scope'].includes(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(', ')
  const values = columns.map((column) => (row as Record<string, unknown>)[column])
  await db
    .prepare(
      `INSERT INTO historical_quality_daily (${columns.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT(audit_run_id, collection_date, scope) DO UPDATE SET ${updates}`,
    )
    .bind(...values)
    .run()
}

export async function replaceHistoricalQualityFindings(
  db: D1Database,
  auditRunId: string,
  collectionDate: string,
  scope: HistoricalQualityScope,
  findings: Array<{
    stableFindingKey: string
    datasetKind: DatasetKind | null
    criterionCode: string
    subjectKind: HistoricalQualityFindingRow['subject_kind']
    severity: HistoricalQualitySeverity
    severityWeight: number
    originClass: HistoricalQualityOriginClass
    originConfidence: number
    bankName?: string | null
    lenderCode?: string | null
    productId?: string | null
    productName?: string | null
    seriesKey?: string | null
    summary: string
    explanation: string
    sourceIngestAnomalyId?: number | null
    sampleIdentifiers?: Record<string, unknown>
    metrics?: Record<string, unknown>
    evidence?: Record<string, unknown>
    drilldownSql?: Record<string, unknown>
  }>,
): Promise<void> {
  await db
    .prepare(`DELETE FROM historical_quality_findings WHERE audit_run_id = ?1 AND collection_date = ?2 AND scope = ?3`)
    .bind(auditRunId, collectionDate, scope)
    .run()
  for (const finding of findings) {
    await db
      .prepare(
        `INSERT INTO historical_quality_findings (
           audit_run_id, stable_finding_key, collection_date, scope, dataset_kind, criterion_code, subject_kind,
           severity, severity_weight, origin_class, origin_confidence, bank_name, lender_code, product_id,
           product_name, series_key, summary, explanation, source_ingest_anomaly_id, sample_identifiers_json,
           metrics_json, evidence_json, drilldown_sql_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)`,
      )
      .bind(
        auditRunId,
        finding.stableFindingKey,
        collectionDate,
        scope,
        finding.datasetKind,
        finding.criterionCode,
        finding.subjectKind,
        finding.severity,
        finding.severityWeight,
        finding.originClass,
        finding.originConfidence,
        finding.bankName ?? null,
        finding.lenderCode ?? null,
        finding.productId ?? null,
        finding.productName ?? null,
        finding.seriesKey ?? null,
        finding.summary,
        finding.explanation,
        finding.sourceIngestAnomalyId ?? null,
        json(finding.sampleIdentifiers ?? {}),
        json(finding.metrics ?? {}),
        json(finding.evidence ?? {}),
        json(finding.drilldownSql ?? {}),
      )
      .run()
  }
}

export async function upsertHistoricalQualityFindings(
  db: D1Database,
  auditRunId: string,
  collectionDate: string,
  scope: HistoricalQualityScope,
  findings: Array<{
    stableFindingKey: string
    datasetKind: DatasetKind | null
    criterionCode: string
    subjectKind: HistoricalQualityFindingRow['subject_kind']
    severity: HistoricalQualitySeverity
    severityWeight: number
    originClass: HistoricalQualityOriginClass
    originConfidence: number
    bankName?: string | null
    lenderCode?: string | null
    productId?: string | null
    productName?: string | null
    seriesKey?: string | null
    summary: string
    explanation: string
    sourceIngestAnomalyId?: number | null
    sampleIdentifiers?: Record<string, unknown>
    metrics?: Record<string, unknown>
    evidence?: Record<string, unknown>
    drilldownSql?: Record<string, unknown>
  }>,
): Promise<void> {
  for (const finding of findings) {
    await db
      .prepare(
        `INSERT INTO historical_quality_findings (
           audit_run_id, stable_finding_key, collection_date, scope, dataset_kind, criterion_code, subject_kind,
           severity, severity_weight, origin_class, origin_confidence, bank_name, lender_code, product_id,
           product_name, series_key, summary, explanation, source_ingest_anomaly_id, sample_identifiers_json,
           metrics_json, evidence_json, drilldown_sql_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
         ON CONFLICT(audit_run_id, stable_finding_key) DO UPDATE SET
           collection_date = excluded.collection_date,
           scope = excluded.scope,
           dataset_kind = excluded.dataset_kind,
           criterion_code = excluded.criterion_code,
           subject_kind = excluded.subject_kind,
           severity = excluded.severity,
           severity_weight = excluded.severity_weight,
           origin_class = excluded.origin_class,
           origin_confidence = excluded.origin_confidence,
           bank_name = excluded.bank_name,
           lender_code = excluded.lender_code,
           product_id = excluded.product_id,
           product_name = excluded.product_name,
           series_key = excluded.series_key,
           summary = excluded.summary,
           explanation = excluded.explanation,
           source_ingest_anomaly_id = excluded.source_ingest_anomaly_id,
           sample_identifiers_json = excluded.sample_identifiers_json,
           metrics_json = excluded.metrics_json,
           evidence_json = excluded.evidence_json,
           drilldown_sql_json = excluded.drilldown_sql_json`,
      )
      .bind(
        auditRunId,
        finding.stableFindingKey,
        collectionDate,
        scope,
        finding.datasetKind,
        finding.criterionCode,
        finding.subjectKind,
        finding.severity,
        finding.severityWeight,
        finding.originClass,
        finding.originConfidence,
        finding.bankName ?? null,
        finding.lenderCode ?? null,
        finding.productId ?? null,
        finding.productName ?? null,
        finding.seriesKey ?? null,
        finding.summary,
        finding.explanation,
        finding.sourceIngestAnomalyId ?? null,
        json(finding.sampleIdentifiers ?? {}),
        json(finding.metrics ?? {}),
        json(finding.evidence ?? {}),
        json(finding.drilldownSql ?? {}),
      )
      .run()
  }
}

export async function listHistoricalQualityDailyByRun(db: D1Database, auditRunId: string): Promise<HistoricalQualityDailyRow[]> {
  const rows = await db
    .prepare(`SELECT * FROM historical_quality_daily WHERE audit_run_id = ?1 ORDER BY collection_date ASC, scope ASC`)
    .bind(auditRunId)
    .all<HistoricalQualityDailyRow>()
  return rows.results ?? []
}

export async function listHistoricalQualityFindingsByRun(db: D1Database, auditRunId: string): Promise<HistoricalQualityFindingRow[]> {
  const rows = await db
    .prepare(`SELECT * FROM historical_quality_findings WHERE audit_run_id = ?1 ORDER BY collection_date ASC, severity_weight DESC, id ASC`)
    .bind(auditRunId)
    .all<HistoricalQualityFindingRow>()
  return rows.results ?? []
}

export async function listHistoricalQualityFindingsByRunDateScope(
  db: D1Database,
  auditRunId: string,
  collectionDate: string,
  scope: HistoricalQualityScope,
): Promise<HistoricalQualityFindingRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM historical_quality_findings
       WHERE audit_run_id = ?1
         AND collection_date = ?2
         AND scope = ?3
       ORDER BY severity_weight DESC, id ASC`,
    )
    .bind(auditRunId, collectionDate, scope)
    .all<HistoricalQualityFindingRow>()
  return rows.results ?? []
}
