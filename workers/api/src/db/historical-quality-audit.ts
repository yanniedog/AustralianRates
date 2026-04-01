import { FETCH_EVENT_PROVENANCE_ENFORCEMENT_START } from './retention-prune'
import { datasetConfigForScope } from './historical-quality-common'
import { collectHistoricalQualityFindings, type HistoricalQualityFindingsResult } from './historical-quality-findings'
import {
  anomalyPressureScore,
  countDeviationScore,
  countStabilityScore,
  evidenceConfidenceScore,
  intraDayScore,
  provenanceScore,
  rateFlowScore,
  runStateObservabilityScore,
  structuralScore,
  transitionScore,
  continuityScore,
} from './historical-quality-metrics'
import {
  hasPermanentHistoricalQualityEvidence,
  loadReferenceWindow,
  loadRunStateSnapshot,
  type HistoricalQualityReferenceWindow,
  type HistoricalQualityRunStateSnapshot,
} from './historical-quality-queries'
import type {
  HistoricalQualityDailyRow,
  HistoricalQualityDatasetScope,
  HistoricalQualityScope,
} from './historical-quality-types'

type NumberRow = Record<string, number | string | null>

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function lenderWhere(scope: HistoricalQualityDatasetScope, lenderCode?: string | null, alias = 'rates', lenderParamIndex = 2): string {
  if (!lenderCode) return ''
  return ` AND EXISTS (
    SELECT 1
    FROM lender_dataset_runs ldr
    WHERE ldr.collection_date = ${alias}.collection_date
      AND ldr.dataset_kind = '${scope}'
      AND ldr.bank_name = ${alias}.bank_name
      AND ldr.lender_code = ?${lenderParamIndex}
  )`
}

export type HistoricalQualityCountsSnapshot = Pick<
  HistoricalQualityDailyRow,
  'row_count' | 'bank_count' | 'product_count' | 'series_count' | 'active_series_count' | 'changed_series_count'
>

export type HistoricalQualityStructureSnapshot = Pick<
  HistoricalQualityDailyRow,
  'duplicate_rows' | 'missing_required_rows' | 'invalid_value_rows' | 'cross_table_conflict_rows'
>

export type HistoricalQualityProvenanceSnapshot = Pick<
  HistoricalQualityDailyRow,
  | 'provenance_exact_count'
  | 'provenance_reconstructed_count'
  | 'provenance_legacy_count'
  | 'provenance_quarantined_count'
  | 'provenance_unclassified_count'
>

export type HistoricalQualityFindingMetrics = Pick<
  HistoricalQualityFindingsResult,
  | 'explainedAppearances'
  | 'unexplainedAppearances'
  | 'explainedDisappearances'
  | 'unexplainedDisappearances'
  | 'weightedAffectedSeries'
  | 'weightedRateFlowFlags'
>

async function loadDatasetCounts(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
  lenderCode?: string | null,
): Promise<HistoricalQualityCountsSnapshot> {
  const config = datasetConfigForScope(scope)
  const binds = lenderCode ? [collectionDate, lenderCode] : [collectionDate]
  const row = await db
    .prepare(
      `WITH ordered AS (
         SELECT rates.series_key, rates.bank_name, rates.product_id, rates.interest_rate, rates.collection_date,
                LAG(rates.interest_rate) OVER (PARTITION BY rates.series_key ORDER BY rates.collection_date) AS prev_rate
         FROM ${config.table} rates
         WHERE 1 = 1${lenderWhere(scope, lenderCode, 'rates', 2)}
       )
       SELECT COUNT(*) AS row_count,
              COUNT(DISTINCT bank_name) AS bank_count,
              COUNT(DISTINCT bank_name || '|' || product_id) AS product_count,
              COUNT(DISTINCT series_key) AS series_count,
              COUNT(DISTINCT series_key) AS active_series_count,
              SUM(CASE WHEN prev_rate IS NOT NULL AND ABS(interest_rate - prev_rate) > 0.000001 THEN 1 ELSE 0 END) AS changed_series_count
       FROM ordered
       WHERE collection_date = ?1`,
    )
    .bind(...binds)
    .first<NumberRow>()
  return {
    row_count: num(row?.row_count),
    bank_count: num(row?.bank_count),
    product_count: num(row?.product_count),
    series_count: num(row?.series_count),
    active_series_count: num(row?.active_series_count),
    changed_series_count: num(row?.changed_series_count),
  }
}

async function loadStructuralCounts(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
  lenderCode?: string | null,
): Promise<HistoricalQualityStructureSnapshot> {
  const config = datasetConfigForScope(scope)
  const lenderBinds = lenderCode ? [collectionDate, lenderCode] : [collectionDate]
  const [duplicateRow, missingRow, invalidRow, conflictRow] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(SUM(n), 0) AS duplicate_rows
         FROM (
           SELECT COUNT(*) AS n
           FROM ${config.table} rates
           WHERE rates.collection_date = ?1
             ${lenderCode ? `AND EXISTS (
               SELECT 1
               FROM lender_dataset_runs ldr
               WHERE ldr.collection_date = rates.collection_date
                 AND ldr.dataset_kind = '${scope}'
                 AND ldr.bank_name = rates.bank_name
                 AND ldr.lender_code = ?2
              )` : ''}
           GROUP BY rates.series_key
           HAVING COUNT(*) > 1
         )`,
      )
      .bind(...lenderBinds)
      .first<NumberRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS missing_required_rows
         FROM ${config.table} rates
         WHERE rates.collection_date = ?1
           ${lenderWhere(scope, lenderCode, 'rates', 2)}
           AND (
             product_id IS NULL OR TRIM(product_id) = '' OR
             product_name IS NULL OR TRIM(product_name) = '' OR
             series_key IS NULL OR TRIM(series_key) = '' OR
             source_url IS NULL OR TRIM(source_url) = ''
           )`,
      )
      .bind(...lenderBinds)
      .first<NumberRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS invalid_value_rows
         FROM ${config.table} rates
         WHERE rates.collection_date = ?1
           ${lenderWhere(scope, lenderCode, 'rates', 4)}
           AND (interest_rate IS NULL OR interest_rate < ?2 OR interest_rate > ?3)`,
      )
      .bind(collectionDate, config.rateMin, config.rateMax, ...(lenderCode ? [lenderCode] : []))
      .first<NumberRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS cross_table_conflict_rows
         FROM ${config.table} rates
         LEFT JOIN series_catalog sc
           ON sc.dataset_kind = ?2
          AND sc.series_key = rates.series_key
         LEFT JOIN product_catalog pc
           ON pc.dataset_kind = ?2
          AND pc.bank_name = rates.bank_name
          AND pc.product_id = rates.product_id
         WHERE rates.collection_date = ?1
           ${lenderWhere(scope, lenderCode, 'rates', 3)}
           AND (sc.series_key IS NULL OR pc.product_id IS NULL)`,
      )
      .bind(collectionDate, scope, ...(lenderCode ? [lenderCode] : []))
      .first<NumberRow>(),
  ])
  return {
    duplicate_rows: num(duplicateRow?.duplicate_rows),
    missing_required_rows: num(missingRow?.missing_required_rows),
    invalid_value_rows: num(invalidRow?.invalid_value_rows),
    cross_table_conflict_rows: num(conflictRow?.cross_table_conflict_rows),
  }
}

async function loadProvenanceCounts(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
  lenderCode?: string | null,
): Promise<HistoricalQualityProvenanceSnapshot> {
  const config = datasetConfigForScope(scope)
  const binds = lenderCode ? [collectionDate, FETCH_EVENT_PROVENANCE_ENFORCEMENT_START, lenderCode] : [collectionDate, FETCH_EVENT_PROVENANCE_ENFORCEMENT_START]
  const row = await db
    .prepare(
      `WITH classified AS (
         SELECT CASE
           WHEN fe.id IS NOT NULL AND ro.content_hash IS NOT NULL
             AND (
               (rates.cdr_product_detail_hash IS NOT NULL AND TRIM(rates.cdr_product_detail_hash) != '' AND rates.cdr_product_detail_hash = fe.content_hash)
               OR (rates.source_url IS NOT NULL AND TRIM(rates.source_url) != '' AND rates.source_url = fe.source_url)
             ) THEN 'exact'
           WHEN fe.id IS NOT NULL AND ro.content_hash IS NOT NULL
             AND fe.product_id IS NOT NULL AND TRIM(fe.product_id) != ''
             AND rates.product_id IS NOT NULL AND TRIM(rates.product_id) != ''
             AND fe.product_id != rates.product_id THEN 'quarantined'
           WHEN fe.id IS NOT NULL AND ro.content_hash IS NOT NULL THEN 'reconstructed'
           WHEN datetime(rates.parsed_at) < datetime(?2) THEN 'legacy'
           ELSE 'quarantined'
         END AS provenance_state
         FROM ${config.table} rates
         LEFT JOIN fetch_events fe ON fe.id = rates.fetch_event_id
         LEFT JOIN raw_objects ro ON ro.content_hash = fe.content_hash
         WHERE rates.collection_date = ?1
           ${lenderWhere(scope, lenderCode, 'rates', 3)}
       )
       SELECT
         SUM(CASE WHEN provenance_state = 'exact' THEN 1 ELSE 0 END) AS exact_count,
         SUM(CASE WHEN provenance_state = 'reconstructed' THEN 1 ELSE 0 END) AS reconstructed_count,
         SUM(CASE WHEN provenance_state = 'legacy' THEN 1 ELSE 0 END) AS legacy_count,
         SUM(CASE WHEN provenance_state = 'quarantined' THEN 1 ELSE 0 END) AS quarantined_count
       FROM classified`,
    )
    .bind(...binds)
    .first<NumberRow>()
  return {
    provenance_exact_count: num(row?.exact_count),
    provenance_reconstructed_count: num(row?.reconstructed_count),
    provenance_legacy_count: num(row?.legacy_count),
    provenance_quarantined_count: num(row?.quarantined_count),
    provenance_unclassified_count: 0,
  }
}

export function buildHistoricalQualityDailyRow(input: {
  auditRunId: string
  collectionDate: string
  scope: HistoricalQualityDatasetScope
  counts: HistoricalQualityCountsSnapshot
  structure: HistoricalQualityStructureSnapshot
  provenance: HistoricalQualityProvenanceSnapshot
  reference: HistoricalQualityReferenceWindow
  runState: HistoricalQualityRunStateSnapshot
  permanentEvidencePresent: boolean
  findingMetrics: HistoricalQualityFindingMetrics
}): HistoricalQualityDailyRow {
  const structureScores = structuralScore({
    rowCount: input.counts.row_count,
    duplicateRows: input.structure.duplicate_rows,
    missingRequiredRows: input.structure.missing_required_rows,
    invalidValueRows: input.structure.invalid_value_rows,
    crossTableConflictRows: input.structure.cross_table_conflict_rows,
  })
  const provenanceValue = provenanceScore({
    exact: input.provenance.provenance_exact_count,
    reconstructed: input.provenance.provenance_reconstructed_count,
    legacy: input.provenance.provenance_legacy_count,
    quarantined: input.provenance.provenance_quarantined_count,
    unclassified: input.provenance.provenance_unclassified_count,
  })
  const bankCountScore = countDeviationScore(input.counts.bank_count, input.reference.baselineBankCount, 3, 0.15)
  const productCountScore = countDeviationScore(input.counts.product_count, input.reference.baselineProductCount, 10, 0.2)
  const seriesCountScore = countDeviationScore(input.counts.series_count, input.reference.baselineSeriesCount, 25, 0.2)
  const coverageScore = (bankCountScore + productCountScore + seriesCountScore) / 3
  const anomalyPressure = anomalyPressureScore(input.findingMetrics.weightedAffectedSeries, input.counts.active_series_count)
  const continuityValue = continuityScore(
    input.findingMetrics.unexplainedAppearances,
    input.findingMetrics.unexplainedDisappearances,
    input.counts.active_series_count,
  )
  const countStability = countStabilityScore(input.counts.series_count, input.reference.previousSeriesCount)
  const rateFlowValue = rateFlowScore(input.findingMetrics.weightedRateFlowFlags, input.counts.changed_series_count)
  const transitionValue = transitionScore(continuityValue, countStability, rateFlowValue)
  const observability = runStateObservabilityScore({
    rawRunStatePresent: input.runState.rawRunStatePresent,
    permanentEvidencePresent: input.permanentEvidencePresent,
    rawRunStateExpected: input.runState.rawRunStateExpected,
  })
  const evidenceConfidence = evidenceConfidenceScore(provenanceValue, observability)
  const intraDay = intraDayScore(structureScores.score, provenanceValue, coverageScore, anomalyPressure)
  return {
    audit_run_id: input.auditRunId,
    collection_date: input.collectionDate,
    scope: input.scope,
    ...input.counts,
    ...input.provenance,
    ...input.structure,
    explained_appearances: input.findingMetrics.explainedAppearances,
    unexplained_appearances: input.findingMetrics.unexplainedAppearances,
    explained_disappearances: input.findingMetrics.explainedDisappearances,
    unexplained_disappearances: input.findingMetrics.unexplainedDisappearances,
    baseline_bank_count: input.reference.baselineBankCount,
    baseline_product_count: input.reference.baselineProductCount,
    baseline_series_count: input.reference.baselineSeriesCount,
    baseline_confidence: input.reference.confidence,
    raw_run_state_present: input.runState.rawRunStatePresent ? 1 : 0,
    permanent_evidence_present: input.permanentEvidencePresent ? 1 : 0,
    raw_run_state_expected: input.runState.rawRunStateExpected ? 1 : 0,
    uniqueness_score: structureScores.uniqueness,
    required_field_score: structureScores.requiredField,
    domain_validity_score: structureScores.domainValidity,
    cross_table_consistency_score: structureScores.crossTableConsistency,
    structural_score_v1: structureScores.score,
    provenance_score_v1: provenanceValue,
    bank_count_score: bankCountScore,
    product_count_score: productCountScore,
    series_count_score: seriesCountScore,
    coverage_score_v1: coverageScore,
    anomaly_pressure_score_v1: anomalyPressure,
    intra_day_score_v1: intraDay,
    continuity_score_v1: continuityValue,
    count_stability_score_v1: countStability,
    rate_flow_score_v1: rateFlowValue,
    transition_score_v1: transitionValue,
    run_state_observability_score: observability,
    evidence_confidence_score_v1: evidenceConfidence,
    metrics_json: JSON.stringify({
      previous_date: input.reference.previousDate,
      next_date: input.reference.nextDate,
      weighted_affected_series_v1: input.findingMetrics.weightedAffectedSeries,
      weighted_rate_flow_flags_v1: input.findingMetrics.weightedRateFlowFlags,
    }),
    evidence_json: JSON.stringify({
      run_state: input.runState,
      baseline_confidence: input.reference.confidence,
      continuity_previous_date: input.reference.previousDate,
    }),
  }
}

export async function computeHistoricalQualityDatasetBatch(
  db: D1Database,
  auditRunId: string,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
  lenderCode?: string | null,
): Promise<{ dailyRow: HistoricalQualityDailyRow; findings: HistoricalQualityFindingsResult }> {
  const [counts, structure, provenance, reference, runState, permanentEvidencePresent] = await Promise.all([
    loadDatasetCounts(db, collectionDate, scope, lenderCode),
    loadStructuralCounts(db, collectionDate, scope, lenderCode),
    loadProvenanceCounts(db, collectionDate, scope, lenderCode),
    loadReferenceWindow(db, collectionDate, scope),
    loadRunStateSnapshot(db, collectionDate, scope),
    hasPermanentHistoricalQualityEvidence(db, collectionDate, scope),
  ])
  const findings = await collectHistoricalQualityFindings(db, {
    collectionDate,
    scope,
    previousDate: reference.previousDate,
    nextDate: reference.nextDate,
    healthyFinalized: runState.healthyFinalized,
    lenderCode,
  })
  const dailyRow = buildHistoricalQualityDailyRow({
    auditRunId,
    collectionDate,
    scope,
    counts,
    structure,
    provenance,
    reference,
    runState,
    permanentEvidencePresent,
    findingMetrics: findings,
  })
  return { dailyRow, findings }
}

export function aggregateHistoricalQualityOverallRow(
  auditRunId: string,
  collectionDate: string,
  rows: HistoricalQualityDailyRow[],
): HistoricalQualityDailyRow {
  const sum = (selector: (row: HistoricalQualityDailyRow) => number) => rows.reduce((total, row) => total + selector(row), 0)
  const avg = (selector: (row: HistoricalQualityDailyRow) => number | null) =>
    rows.length === 0 ? 0 : rows.reduce((total, row) => total + num(selector(row)), 0) / rows.length
  return {
    audit_run_id: auditRunId,
    collection_date: collectionDate,
    scope: 'overall' as HistoricalQualityScope,
    row_count: sum((row) => row.row_count),
    bank_count: sum((row) => row.bank_count),
    product_count: sum((row) => row.product_count),
    series_count: sum((row) => row.series_count),
    active_series_count: sum((row) => row.active_series_count),
    changed_series_count: sum((row) => row.changed_series_count),
    provenance_exact_count: sum((row) => row.provenance_exact_count),
    provenance_reconstructed_count: sum((row) => row.provenance_reconstructed_count),
    provenance_legacy_count: sum((row) => row.provenance_legacy_count),
    provenance_quarantined_count: sum((row) => row.provenance_quarantined_count),
    provenance_unclassified_count: sum((row) => row.provenance_unclassified_count),
    duplicate_rows: sum((row) => row.duplicate_rows),
    missing_required_rows: sum((row) => row.missing_required_rows),
    invalid_value_rows: sum((row) => row.invalid_value_rows),
    cross_table_conflict_rows: sum((row) => row.cross_table_conflict_rows),
    explained_appearances: sum((row) => row.explained_appearances),
    unexplained_appearances: sum((row) => row.unexplained_appearances),
    explained_disappearances: sum((row) => row.explained_disappearances),
    unexplained_disappearances: sum((row) => row.unexplained_disappearances),
    baseline_bank_count: avg((row) => row.baseline_bank_count),
    baseline_product_count: avg((row) => row.baseline_product_count),
    baseline_series_count: avg((row) => row.baseline_series_count),
    baseline_confidence: rows.some((row) => row.baseline_confidence === 'low') ? 'low' : rows.some((row) => row.baseline_confidence === 'bootstrap_forward') ? 'bootstrap_forward' : 'high',
    raw_run_state_present: rows.every((row) => row.raw_run_state_present === 1) ? 1 : 0,
    permanent_evidence_present: rows.every((row) => row.permanent_evidence_present === 1) ? 1 : 0,
    raw_run_state_expected: rows.some((row) => row.raw_run_state_expected === 1) ? 1 : 0,
    uniqueness_score: avg((row) => row.uniqueness_score),
    required_field_score: avg((row) => row.required_field_score),
    domain_validity_score: avg((row) => row.domain_validity_score),
    cross_table_consistency_score: avg((row) => row.cross_table_consistency_score),
    structural_score_v1: avg((row) => row.structural_score_v1),
    provenance_score_v1: avg((row) => row.provenance_score_v1),
    bank_count_score: avg((row) => row.bank_count_score),
    product_count_score: avg((row) => row.product_count_score),
    series_count_score: avg((row) => row.series_count_score),
    coverage_score_v1: avg((row) => row.coverage_score_v1),
    anomaly_pressure_score_v1: avg((row) => row.anomaly_pressure_score_v1),
    intra_day_score_v1: avg((row) => row.intra_day_score_v1),
    continuity_score_v1: avg((row) => row.continuity_score_v1),
    count_stability_score_v1: avg((row) => row.count_stability_score_v1),
    rate_flow_score_v1: avg((row) => row.rate_flow_score_v1),
    transition_score_v1: avg((row) => row.transition_score_v1),
    run_state_observability_score: avg((row) => row.run_state_observability_score),
    evidence_confidence_score_v1: avg((row) => row.evidence_confidence_score_v1),
    metrics_json: JSON.stringify({ dataset_scopes: rows.map((row) => row.scope) }),
    evidence_json: JSON.stringify({ aggregated_from_dataset_rows: true }),
  }
}
