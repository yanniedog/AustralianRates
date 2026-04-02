export type HistoricalQualityCriterion = {
  code: string
  label: string
  description: string
}

export type HistoricalQualityCriterionGroup = {
  key: string
  label: string
  description: string
  criteria: HistoricalQualityCriterion[]
}

const DAILY_COUNTERS: HistoricalQualityCriterionGroup = {
  key: 'daily_counters',
  label: 'Daily counters',
  description: 'Compact per-day counts persisted in historical_quality_daily and exposed through the admin day list/detail APIs.',
  criteria: [
    { code: 'row_count', label: 'Rows', description: 'Stored historical rows observed for the day and scope.' },
    { code: 'bank_count', label: 'Lenders', description: 'Distinct lenders present for the day and scope.' },
    { code: 'product_count', label: 'Products', description: 'Distinct products present for the day and scope.' },
    { code: 'new_product_count', label: 'New products', description: 'Products present today but absent on the previous observed date.' },
    { code: 'lost_product_count', label: 'Lost products', description: 'Products present on the previous observed date but absent today.' },
    { code: 'cdr_missing_product_count', label: 'CDR-missing products', description: 'Products whose absence is paired with incomplete or unhealthy lender-day run evidence.' },
    { code: 'renamed_same_id_count', label: 'Same ID renamed', description: 'Products whose name changed while product_id stayed the same.' },
    {
      code: 'same_id_name_same_rate_other_detail_changed_count',
      label: 'Same ID/name/rate other-detail changes',
      description: 'Products whose ID, name, and rate held steady while some other stored product detail changed.',
    },
    { code: 'changed_id_same_name_count', label: 'Changed ID same name', description: 'Products whose product_id changed while the name and dimensional fingerprint stayed aligned.' },
    { code: 'increased_rate_product_count', label: 'Rate increases', description: 'Distinct products with at least one upward rate move on the day.' },
    { code: 'decreased_rate_product_count', label: 'Rate decreases', description: 'Distinct products with at least one downward rate move on the day.' },
    { code: 'top_degraded_lenders', label: 'Top degraded lenders', description: 'Top five lenders with the worst combined provenance, structure, and anomaly pressure for the day.' },
  ],
}

const SCORE_COMPONENTS: HistoricalQualityCriterionGroup = {
  key: 'score_components',
  label: 'Score components',
  description: 'Persisted score components used to explain daily quality, evidence confidence, and longitudinal continuity.',
  criteria: [
    { code: 'structural_score_v1', label: 'Structural score', description: 'Average of uniqueness, required-field, domain-validity, and cross-table-consistency scores.' },
    { code: 'uniqueness_score', label: 'Uniqueness score', description: 'Penalises duplicate natural-key rows.' },
    { code: 'required_field_score', label: 'Required-field score', description: 'Penalises missing identifiers, names, source URLs, and other mandatory fields.' },
    { code: 'domain_validity_score', label: 'Domain-validity score', description: 'Penalises invalid numeric values such as impossible or out-of-range rates.' },
    { code: 'cross_table_consistency_score', label: 'Cross-table consistency score', description: 'Penalises row shapes that disagree with linked catalog, presence, or provenance evidence.' },
    { code: 'provenance_score_v1', label: 'Provenance score', description: 'Weighted confidence from exact, reconstructed, legacy, unclassified, and quarantined provenance classes.' },
    { code: 'coverage_score_v1', label: 'Coverage score', description: 'Compares bank, product, and series counts against the rolling baseline for that dataset scope.' },
    { code: 'anomaly_pressure_score_v1', label: 'Anomaly-pressure score', description: 'Penalises days with dense or severe finding coverage across the active series set.' },
    { code: 'continuity_score_v1', label: 'Continuity score', description: 'Penalises unexplained appearances and disappearances versus the prior observed date.' },
    { code: 'count_stability_score_v1', label: 'Count-stability score', description: 'Penalises abrupt day-to-day swings in series counts versus the previous observed day.' },
    { code: 'rate_flow_score_v1', label: 'Rate-flow score', description: 'Penalises abrupt, contradictory, or multi-move rate behaviour on the day.' },
    { code: 'transition_score_v1', label: 'Transition score', description: 'Average of continuity, count stability, and rate-flow scores.' },
    { code: 'run_state_observability_score', label: 'Run-state observability score', description: 'Scores whether raw run evidence or permanent daily evidence exists for the assessed day.' },
    { code: 'evidence_confidence_score_v1', label: 'Evidence-confidence score', description: 'Average of provenance confidence and run-state observability.' },
  ],
}

const FINDING_RULES: HistoricalQualityCriterionGroup = {
  key: 'finding_rules',
  label: 'Finding rules',
  description: 'Persisted anomaly and churn classifications recorded into historical_quality_findings.',
  criteria: [
    { code: 'appearance_wave', label: 'Appearance wave', description: 'A lender-day or scope suddenly gains an unusual cluster of products or series.' },
    { code: 'reappearing_series', label: 'Reappearing series', description: 'A previously missing series returns after a gap.' },
    { code: 'disappearance_wave', label: 'Disappearance wave', description: 'A lender-day or scope suddenly loses an unusual cluster of products or series.' },
    { code: 'disappearance_gap', label: 'Disappearance gap', description: 'A product or series vanishes while adjacent history suggests it should still exist.' },
    { code: 'abrupt_rate_move', label: 'Abrupt rate move', description: 'A rate changes by an unusually large amount versus nearby peers or its own prior history.' },
    { code: 'product_id_churn', label: 'Product ID churn', description: 'A product appears to be rekeyed or re-identified while keeping the same name/dimensions.' },
    { code: 'rba_opposite_direction', label: 'RBA opposite direction', description: 'Variable home-loan rates move opposite to the current RBA cycle direction.' },
    { code: 'rba_larger_than_cycle_move', label: 'Larger than RBA move', description: 'Variable home-loan rates move more than the corresponding RBA cycle change.' },
    { code: 'rba_smaller_than_cycle_move', label: 'Smaller than RBA move', description: 'Variable home-loan rates move less than the corresponding RBA cycle change.' },
    { code: 'multi_move_same_rba_cycle', label: 'Multiple moves in one RBA cycle', description: 'Variable home-loan series move more than once inside the same RBA cash-rate cycle.' },
  ],
}

export function listHistoricalQualityCriteria(): HistoricalQualityCriterionGroup[] {
  return [DAILY_COUNTERS, SCORE_COMPONENTS, FINDING_RULES]
}
