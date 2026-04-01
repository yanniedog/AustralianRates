import { describe, expect, it } from 'vitest'
import {
  anomalyPressureScore,
  continuityScore,
  countDeviationScore,
  evidenceConfidenceScore,
  intraDayScore,
  provenanceScore,
  structuralScore,
  transitionScore,
} from '../src/db/historical-quality-metrics'
import { chooseOperationalRetentionDays, computeHistoricalQualityCutoffs } from '../src/db/historical-quality-summary'
import { projectRetentionCandidate } from '../src/db/retention-size-audit'
import { nextHistoricalQualityLenderCursor, shouldSplitHistoricalQualityBatch } from '../src/pipeline/historical-quality-batching'

describe('historical quality metrics', () => {
  it('computes structural, provenance, transition, and evidence scores from literal inputs', () => {
    const structural = structuralScore({
      rowCount: 100,
      duplicateRows: 2,
      missingRequiredRows: 4,
      invalidValueRows: 1,
      crossTableConflictRows: 3,
    })
    expect(structural.score).toBeCloseTo((0.98 + 0.96 + 0.99 + 0.97) / 4, 6)
    expect(provenanceScore({ exact: 80, reconstructed: 10, legacy: 5, quarantined: 5, unclassified: 0 })).toBeCloseTo(0.9, 1)
    expect(countDeviationScore(100, 100, 10, 0.2)).toBe(1)
    expect(anomalyPressureScore(5, 100)).toBeGreaterThan(0.7)
    expect(continuityScore(2, 3, 100)).toBe(0.95)
    expect(transitionScore(0.95, 0.9, 0.8)).toBeCloseTo((0.95 + 0.9 + 0.8) / 3, 6)
    expect(evidenceConfidenceScore(0.8, 1)).toBe(0.9)
    expect(intraDayScore(0.9, 0.8, 0.85, 0.95)).toBeCloseTo(0.865, 6)
  })

  it('chooses retention only after daily evidence backfill exists', () => {
    expect(
      chooseOperationalRetentionDays({
        projectionsMb: { 7: 10, 14: 20, 30: 40 },
        currentDbSizeMb: 750,
        hasPermanentEvidenceBackfill: false,
      }),
    ).toEqual({
      recommended_days: 7,
      allowed: false,
      reason: 'daily_evidence_not_backfilled',
    })
    expect(
      chooseOperationalRetentionDays({
        projectionsMb: { 7: 6, 14: 42, 30: 120 },
        currentDbSizeMb: 750,
        hasPermanentEvidenceBackfill: true,
      }).recommended_days,
    ).toBe(14)
    expect(projectRetentionCandidate({ candidateDays: 14, avgRowsPerDay: 100, avgBytesPerDay: 2_000 })).toEqual({
      candidate_days: 14,
      added_days: 0,
      projected_added_rows: 0,
      projected_added_bytes: 0,
      projected_added_mb: 0,
    })
  })
})

describe('historical quality cutoffs and batching helpers', () => {
  it('returns no clean cutoff when catastrophic days persist', () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      audit_run_id: 'run',
      collection_date: `2026-03-${String(index + 1).padStart(2, '0')}`,
      scope: 'overall',
      row_count: 100,
      bank_count: 1,
      product_count: 1,
      series_count: 100,
      active_series_count: 100,
      changed_series_count: 10,
      provenance_exact_count: 80,
      provenance_reconstructed_count: 10,
      provenance_legacy_count: 5,
      provenance_quarantined_count: 20,
      provenance_unclassified_count: 0,
      duplicate_rows: 1,
      missing_required_rows: 0,
      invalid_value_rows: 0,
      cross_table_conflict_rows: 0,
      explained_appearances: 0,
      unexplained_appearances: 10,
      explained_disappearances: 0,
      unexplained_disappearances: 10,
      baseline_bank_count: 1,
      baseline_product_count: 1,
      baseline_series_count: 100,
      baseline_confidence: 'high',
      raw_run_state_present: 1,
      permanent_evidence_present: 0,
      raw_run_state_expected: 1,
      uniqueness_score: 1,
      required_field_score: 1,
      domain_validity_score: 1,
      cross_table_consistency_score: 1,
      structural_score_v1: 0.99,
      provenance_score_v1: 0.85,
      bank_count_score: 1,
      product_count_score: 1,
      series_count_score: 1,
      coverage_score_v1: 0.9,
      anomaly_pressure_score_v1: 0.8,
      intra_day_score_v1: 0.9,
      continuity_score_v1: 0.7,
      count_stability_score_v1: 0.8,
      rate_flow_score_v1: 0.8,
      transition_score_v1: 0.76,
      run_state_observability_score: 1,
      evidence_confidence_score_v1: 0.9,
      metrics_json: '{}',
      evidence_json: '{}',
    }))
    expect(computeHistoricalQualityCutoffs(rows as any).balanced.start_date).toBeNull()
    expect(shouldSplitHistoricalQualityBatch(6001)).toBe(true)
    expect(nextHistoricalQualityLenderCursor(['a', 'b', 'c'], null)).toBe('a')
    expect(nextHistoricalQualityLenderCursor(['a', 'b', 'c'], 'b')).toBe('c')
  })
})
