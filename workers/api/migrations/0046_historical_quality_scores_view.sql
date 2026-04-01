CREATE VIEW IF NOT EXISTS historical_quality_daily_scores_v1 AS
SELECT
  audit_run_id,
  collection_date,
  scope,
  structural_score_v1,
  provenance_score_v1,
  coverage_score_v1,
  anomaly_pressure_score_v1,
  intra_day_score_v1,
  transition_score_v1,
  evidence_confidence_score_v1,
  (0.50 * intra_day_score_v1 + 0.30 * transition_score_v1 + 0.20 * evidence_confidence_score_v1) AS overall_day_quality_score_v1,
  (0.25 * intra_day_score_v1 + 0.50 * transition_score_v1 + 0.25 * evidence_confidence_score_v1) AS longitudinal_impact_score_v1
FROM historical_quality_daily;
