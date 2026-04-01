# Database optimization plan

This document defines how to keep the D1 database smaller while preserving user-facing history and enough operational evidence for integrity work.

## Invariants

### Front-end data is never lost

- Do not drop or over-prune any table or column that feeds the public site or API.
- User-facing data lives in:
  - `historical_loan_rates`, `historical_savings_rates`, `historical_term_deposit_rates`
  - `latest_home_loan_series`, `latest_savings_series`, `latest_td_series`
  - `home_loan_rate_events`, `savings_rate_events`, `term_deposit_rate_events` when used by charts or exports
  - `chart_pivot_cache`, `rba_cash_rates`
  - `cdr_detail_payload_store` when still referenced by historical or latest rows
- If historical rates or events are ever pruned, the retention horizon must not be shorter than the intended chart/export horizon and must have explicit product approval.

### Admin status and integrity remain useful

- `run_reports` (+ `run_seen_*`, `lender_dataset_runs`) are retained for 30 days because the historical-quality evidence model now exists and the production size audit showed that 30 days is cheap enough.
- `fetch_events` and `raw_objects` remain long-retention provenance tables.
- `historical_provenance_recovery_runs` is the durable summary record for provenance repair activity.
- `historical_provenance_recovery_log` is only a recent debug log and can be pruned after summaries exist.

## Current retention model

### Long-term

- `historical_*_rates`
- `latest_*_series`
- `fetch_events`
- `raw_objects`
- `historical_provenance_status`
- `historical_provenance_recovery_runs`
- `product_catalog`, `series_catalog`, `product_presence_status`, `series_presence_status`
- `rba_cash_rates`

### Medium-term

- `run_reports`
- `run_seen_products`
- `run_seen_series`
- `lender_dataset_runs`
- `historical_provenance_recovery_log`

Current target: 30 days.

### Short-term

- `ingest_anomalies`
- `health_check_runs`
- `integrity_audit_runs`
- `download_change_feed`
- `client_historical_runs`, `client_historical_tasks`, `client_historical_batches`

Current target: 1 day.

### Special

- `raw_payloads`: orphan cleanup only.
- `raw_objects`: prune only when no retained `fetch_events` row still references the content hash.
- `ingest_replay_queue`: terminal rows retain a short recent window; active rows are never pruned by age.

## Concrete actions already implemented

1. Keep `fetch_events` on a 3650-day window and prune `raw_objects` only after `fetch_events` pruning.
2. Keep raw run-state (`run_reports` + `run_seen_*` + `lender_dataset_runs`) on a 30-day window.
3. Keep low-value churn (`ingest_anomalies`, `download_change_feed`, `client_historical_*`) on a 1-day window.
4. Write `historical_provenance_recovery_runs` summaries and prune `historical_provenance_recovery_log` to 30 days only after summaries exist.

## Verification

After any retention or schema change:

- `npm run typecheck:api`
- `npm run test:api`
- `npm run test:homepage` if production behavior changed
- `npm run test:archive` for deploy sign-off in this repo

Operational verification:

- Run `node scripts/retention-size-audit-prod.js`
- Run `node scripts/historical-quality-audit-prod.js` when the evidence model or scoring logic changes materially
- Trigger `node trigger-retention.js` after deploy if you need the new pruning policy to take effect immediately
