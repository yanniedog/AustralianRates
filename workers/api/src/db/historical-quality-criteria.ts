export type HistoricalQualityCriterion = {
  code: string
  label: string
}

export type HistoricalQualityCriterionGroup = {
  key: string
  label: string
  criteria: HistoricalQualityCriterion[]
}

const DAILY_COUNTERS: HistoricalQualityCriterionGroup = {
  key: 'daily_counters',
  label: 'Daily counters',
  criteria: [
    { code: 'row_count', label: 'Rows' },
    { code: 'bank_count', label: 'Lenders' },
    { code: 'product_count', label: 'Products' },
    { code: 'new_product_count', label: 'New' },
    { code: 'lost_product_count', label: 'Lost' },
    { code: 'cdr_missing_product_count', label: 'CDR miss' },
    { code: 'renamed_same_id_count', label: 'Rename' },
    { code: 'same_id_name_same_rate_other_detail_changed_count', label: 'Detail' },
    { code: 'changed_id_same_name_count', label: 'ID churn' },
    { code: 'increased_rate_product_count', label: 'Up' },
    { code: 'decreased_rate_product_count', label: 'Down' },
    { code: 'top_degraded_lenders', label: 'Top lenders' },
  ],
}

const SCORE_COMPONENTS: HistoricalQualityCriterionGroup = {
  key: 'score_components',
  label: 'Score components',
  criteria: [
    { code: 'structural_score_v1', label: 'Struct' },
    { code: 'uniqueness_score', label: 'Unique' },
    { code: 'required_field_score', label: 'Req' },
    { code: 'domain_validity_score', label: 'Domain' },
    { code: 'cross_table_consistency_score', label: 'Cross' },
    { code: 'provenance_score_v1', label: 'Prov' },
    { code: 'coverage_score_v1', label: 'Cov' },
    { code: 'anomaly_pressure_score_v1', label: 'Anom' },
    { code: 'continuity_score_v1', label: 'Cont' },
    { code: 'count_stability_score_v1', label: 'Stable' },
    { code: 'rate_flow_score_v1', label: 'Flow' },
    { code: 'transition_score_v1', label: 'Trans' },
    { code: 'run_state_observability_score', label: 'Obs' },
    { code: 'evidence_confidence_score_v1', label: 'Evid' },
  ],
}

const FINDING_RULES: HistoricalQualityCriterionGroup = {
  key: 'finding_rules',
  label: 'Finding rules',
  criteria: [
    { code: 'appearance_wave', label: 'Appear wave' },
    { code: 'reappearing_series', label: 'Reappear' },
    { code: 'disappearance_wave', label: 'Disappear wave' },
    { code: 'disappearance_gap', label: 'Disappear gap' },
    { code: 'abrupt_rate_move', label: 'Abrupt move' },
    { code: 'product_id_churn', label: 'ID churn' },
    { code: 'rba_opposite_direction', label: 'RBA opp' },
    { code: 'rba_larger_than_cycle_move', label: 'RBA over' },
    { code: 'rba_smaller_than_cycle_move', label: 'RBA under' },
    { code: 'multi_move_same_rba_cycle', label: 'RBA multi' },
  ],
}

export function listHistoricalQualityCriteria(): HistoricalQualityCriterionGroup[] {
  return [DAILY_COUNTERS, SCORE_COMPONENTS, FINDING_RULES]
}
