# Historical Quality Audit

- Run: `historical-quality:2026-04-01T05:05:06.745Z:53db59ae-5e7e-48b1-b0f8-9c57b0d67751`
- Status: `completed`
- Started: `2026-04-01 05:05:06`
- Finished: `2026-04-01 05:08:07`

## Cutoff Candidates

```json
{
  "conservative": {
    "start_date": null,
    "reason": "no_clean_cutoff"
  },
  "balanced": {
    "start_date": "2026-04-01",
    "reason": "thresholds_satisfied"
  },
  "aggressive": {
    "start_date": "2026-03-24",
    "reason": "thresholds_satisfied"
  }
}
```

## Overall Daily Scores

- 2026-02-26: structural=1.000 provenance=0.400 transition=0.833 evidence=0.375
- 2026-02-27: structural=1.000 provenance=0.400 transition=0.804 evidence=0.375
- 2026-03-01: structural=1.000 provenance=0.133 transition=0.752 evidence=0.242
- 2026-03-02: structural=1.000 provenance=0.267 transition=0.809 evidence=0.308
- 2026-03-03: structural=1.000 provenance=0.267 transition=0.809 evidence=0.308
- 2026-03-04: structural=1.000 provenance=0.267 transition=0.887 evidence=0.308
- 2026-03-05: structural=1.000 provenance=0.441 transition=0.523 evidence=0.396
- 2026-03-06: structural=1.000 provenance=0.457 transition=0.968 evidence=0.404
- 2026-03-07: structural=1.000 provenance=0.457 transition=0.928 evidence=0.404
- 2026-03-08: structural=1.000 provenance=0.458 transition=1.000 evidence=0.404
- 2026-03-09: structural=1.000 provenance=0.440 transition=0.632 evidence=0.395
- 2026-03-10: structural=1.000 provenance=0.464 transition=0.651 evidence=0.407
- 2026-03-11: structural=1.000 provenance=0.463 transition=0.985 evidence=0.406
- 2026-03-12: structural=1.000 provenance=0.467 transition=0.972 evidence=0.409
- 2026-03-13: structural=1.000 provenance=0.472 transition=0.807 evidence=0.411
- 2026-03-14: structural=1.000 provenance=0.492 transition=0.765 evidence=0.421
- 2026-03-15: structural=1.000 provenance=0.490 transition=0.738 evidence=0.420
- 2026-03-16: structural=1.000 provenance=0.493 transition=0.796 evidence=0.421
- 2026-03-17: structural=1.000 provenance=0.492 transition=0.809 evidence=0.421
- 2026-03-18: structural=1.000 provenance=0.495 transition=0.820 evidence=0.422
- 2026-03-19: structural=1.000 provenance=0.492 transition=0.798 evidence=0.421
- 2026-03-20: structural=1.000 provenance=0.493 transition=0.804 evidence=0.422
- 2026-03-21: structural=1.000 provenance=0.518 transition=0.852 evidence=0.434
- 2026-03-22: structural=1.000 provenance=0.530 transition=0.760 evidence=0.440
- 2026-03-23: structural=1.000 provenance=0.532 transition=0.753 evidence=0.441
- 2026-03-24: structural=1.000 provenance=0.537 transition=0.777 evidence=0.443
- 2026-03-25: structural=1.000 provenance=0.558 transition=0.799 evidence=0.454
- 2026-03-26: structural=1.000 provenance=0.593 transition=0.760 evidence=0.472
- 2026-03-27: structural=1.000 provenance=0.717 transition=0.829 evidence=0.533
- 2026-03-28: structural=1.000 provenance=0.831 transition=0.750 evidence=0.591
- 2026-03-29: structural=1.000 provenance=1.000 transition=0.844 evidence=0.675
- 2026-03-30: structural=1.000 provenance=1.000 transition=0.761 evidence=0.675
- 2026-03-31: structural=1.000 provenance=1.000 transition=0.902 evidence=0.667
- 2026-04-01: structural=1.000 provenance=1.000 transition=0.852 evidence=1.000

## Findings

- 2026-02-26 term_deposits product_id_churn low: AMP Bank: AMP Bank GO 6 Month Term Deposit shows product_id churn
- 2026-02-26 term_deposits product_id_churn low: AMP Bank: AMP Bank GO 12 Month Business Term Deposit shows product_id churn
- 2026-02-26 term_deposits product_id_churn low: AMP Bank: AMP Bank GO 12 Month Term Deposit shows product_id churn
- 2026-02-26 term_deposits product_id_churn low: AMP Bank: AMP Bank GO 6 Month Business Term Deposit shows product_id churn
- 2026-02-27 term_deposits abrupt_rate_move severe: Bendigo and Adelaide Bank: Fixed Rate Farm Management Deposit moved -355.00 bps
- 2026-02-27 home_loans rba_smaller_than_cycle_move medium: Bendigo and Adelaide Bank: variable-rate move lagged the RBA cycle move
- 2026-02-27 home_loans disappearance_gap low: Bendigo and Adelaide Bank: 1 series disappeared
- 2026-02-27 home_loans rba_opposite_direction low: Bendigo and Adelaide Bank: variable-rate move opposed the RBA cycle
- 2026-02-27 term_deposits product_id_churn low: AMP Bank: AMP Bank GO 6 Month Term Deposit shows product_id churn
- 2026-02-27 term_deposits product_id_churn low: AMP Bank: AMP Bank GO 12 Month Business Term Deposit shows product_id churn
- 2026-02-27 term_deposits product_id_churn low: AMP Bank: AMP Bank GO 12 Month Term Deposit shows product_id churn
- 2026-02-27 term_deposits product_id_churn low: AMP Bank: AMP Bank GO 6 Month Business Term Deposit shows product_id churn
- 2026-03-01 home_loans disappearance_gap severe: ANZ: 20 series disappeared
- 2026-03-01 home_loans disappearance_gap severe: Bankwest: 38 series disappeared
- 2026-03-01 home_loans disappearance_gap severe: Bendigo and Adelaide Bank: 60 series disappeared
- 2026-03-01 home_loans disappearance_wave severe: Commonwealth Bank of Australia: 65 series disappeared
- 2026-03-01 home_loans disappearance_gap severe: Macquarie Bank: 40 series disappeared
- 2026-03-01 home_loans disappearance_gap severe: Suncorp Bank: 21 series disappeared
- 2026-03-01 savings disappearance_gap severe: ANZ: 25 series disappeared
- 2026-03-01 savings disappearance_gap severe: Bank of Melbourne: 37 series disappeared

