import type { DatasetKind } from '../../../../packages/shared/src'

export const HISTORICAL_QUALITY_DATASET_SCOPES = ['home_loans', 'savings', 'term_deposits'] as const
export const HISTORICAL_QUALITY_SCOPES = ['overall', ...HISTORICAL_QUALITY_DATASET_SCOPES] as const

export type HistoricalQualityDatasetScope = (typeof HISTORICAL_QUALITY_DATASET_SCOPES)[number]
export type HistoricalQualityScope = (typeof HISTORICAL_QUALITY_SCOPES)[number]
export type HistoricalQualityMode = 'whole_date_scope' | 'split_by_lender'
export type HistoricalQualityRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial'
export type HistoricalQualitySeverity = 'low' | 'medium' | 'high' | 'severe'
export type HistoricalQualityOriginClass = 'internal' | 'external' | 'market' | 'unknown'
export type HistoricalQualityBaselineConfidence = 'high' | 'bootstrap_forward' | 'low'

export type HistoricalQualityRunRow = {
  audit_run_id: string
  trigger_source: 'manual' | 'resume' | 'script' | 'scheduled'
  target_db: string
  criteria_version: string
  status: HistoricalQualityRunStatus
  mode: HistoricalQualityMode
  next_collection_date: string | null
  next_scope: HistoricalQualityDatasetScope | null
  lender_cursor: string | null
  total_dates: number
  processed_batches: number
  completed_dates: number
  last_error: string | null
  filters_json: string
  summary_json: string
  artifacts_json: string
  started_at: string
  updated_at: string
  finished_at: string | null
}

export type HistoricalQualityDailyRow = {
  audit_run_id: string
  collection_date: string
  scope: HistoricalQualityScope
  row_count: number
  bank_count: number
  product_count: number
  series_count: number
  active_series_count: number
  changed_series_count: number
  provenance_exact_count: number
  provenance_reconstructed_count: number
  provenance_legacy_count: number
  provenance_quarantined_count: number
  provenance_unclassified_count: number
  duplicate_rows: number
  missing_required_rows: number
  invalid_value_rows: number
  cross_table_conflict_rows: number
  explained_appearances: number
  unexplained_appearances: number
  explained_disappearances: number
  unexplained_disappearances: number
  baseline_bank_count: number | null
  baseline_product_count: number | null
  baseline_series_count: number | null
  baseline_confidence: HistoricalQualityBaselineConfidence
  raw_run_state_present: number
  permanent_evidence_present: number
  raw_run_state_expected: number
  uniqueness_score: number | null
  required_field_score: number | null
  domain_validity_score: number | null
  cross_table_consistency_score: number | null
  structural_score_v1: number | null
  provenance_score_v1: number | null
  bank_count_score: number | null
  product_count_score: number | null
  series_count_score: number | null
  coverage_score_v1: number | null
  anomaly_pressure_score_v1: number | null
  intra_day_score_v1: number | null
  continuity_score_v1: number | null
  count_stability_score_v1: number | null
  rate_flow_score_v1: number | null
  transition_score_v1: number | null
  run_state_observability_score: number | null
  evidence_confidence_score_v1: number | null
  metrics_json: string
  evidence_json: string
}

export type HistoricalQualityFindingRow = {
  id: number
  audit_run_id: string
  stable_finding_key: string
  collection_date: string
  scope: HistoricalQualityScope
  dataset_kind: DatasetKind | null
  criterion_code: string
  subject_kind: 'day' | 'product' | 'series' | 'product_family' | 'lender_dataset'
  severity: HistoricalQualitySeverity
  severity_weight: number
  origin_class: HistoricalQualityOriginClass
  origin_confidence: number
  bank_name: string | null
  lender_code: string | null
  product_id: string | null
  product_name: string | null
  series_key: string | null
  summary: string
  explanation: string
  source_ingest_anomaly_id: number | null
  sample_identifiers_json: string
  metrics_json: string
  evidence_json: string
  drilldown_sql_json: string
  created_at: string
}

export function isHistoricalQualityDatasetScope(value: string | null | undefined): value is HistoricalQualityDatasetScope {
  return HISTORICAL_QUALITY_DATASET_SCOPES.includes(String(value) as HistoricalQualityDatasetScope)
}

export function isHistoricalQualityScope(value: string | null | undefined): value is HistoricalQualityScope {
  return HISTORICAL_QUALITY_SCOPES.includes(String(value) as HistoricalQualityScope)
}
