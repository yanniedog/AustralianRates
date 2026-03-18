# Database optimization plan

This document defines how to keep the D1 database smaller and optimised while (a) never losing front-end data and (b) keeping admin status and integrity features pragmatic and useful.

## Invariants

### (a) Front-end data is never lost

- **Do not drop or over-prune** any table or column that feeds the public site or API.
- **User-facing data** lives in:
  - `historical_loan_rates`, `historical_savings_rates`, `historical_term_deposit_rates`
  - `latest_home_loan_series`, `latest_savings_series`, `latest_td_series`
  - `home_loan_rate_events`, `savings_rate_events`, `term_deposit_rate_events` (if used by charts/exports)
  - `chart_pivot_cache`, `rba_cash_rates`
  - `cdr_detail_payload_store` (referenced by historical/latest for detail)
- **Retention on user data**: If historical rates (or events/intervals) ever get retention pruning, it must be **no shorter than** the intended chart/export horizon (e.g. 730 days). Do not prune these tables unless product explicitly agrees.
- **Orphan pruning** on `cdr_detail_payload_store` is safe only for hashes that are no longer referenced by any row in historical_* or latest_* (or after historical retention has run).

### (b) Admin status and integrity remain pragmatic and useful

- **Run history**: `run_reports` (and run_seen_*, lender_dataset_runs) drive run list, coverage gaps, and “runs with no outputs”. Keep **at least 90 days** (current 180 days is fine).
- **Health**: `health_check_runs` (e.g. 7 days) so status page shows recent health.
- **Integrity**: `integrity_audit_runs` (e.g. 30 days) so admin can re-run and compare.
- **Fetch lineage**: `fetch_events` is used by admin remediation (show fetch events), admin download (operational stream), and CDR audit (validate fetch_events vs raw_objects). Keep **at least 90 days** of fetch_events so remediation and CDR audit have recent lineage. Older historical rows may have `fetch_event_id` pointing to pruned rows (getFetchEventById returns null); that is acceptable.
- **Logs**: `global_log` 14d (warn/error) and 48h (info/debug) so actionable issues and recent context remain.
- **Anomalies**: `ingest_anomalies` (e.g. 90 days) for diagnostics.

## Concrete actions

### 1. Fetch_events retention (implemented)

- **Add** retention pruning for `fetch_events`: delete rows where `fetched_at < now - 90 days`.
- **Run** after other retention prunes (e.g. in `runRetentionPrunes`).
- **Effect**: Largest table by row count shrinks; admin keeps 90 days of lineage for remediation and CDR audit.

### 2. Fetch_events column slim (implemented)

- **Drop** from `fetch_events` (migration): `response_headers_json`, `body_bytes`, `duration_ms`, `notes`, `job_kind`.
- **Reason**: Not used in WHERE/JOIN/ORDER; only for admin display. `body_bytes` is redundant with `raw_objects.body_bytes`; headers/duration/notes/job_kind are not required for lineage or audit.
- **Code**: Stop inserting and selecting these columns; for `getFetchEventById`, source `body_bytes` from `raw_objects` in the existing JOIN when needed for display.

### 3. Other retention (already in place or optional)

- **Already in place**: `global_log`, `ingest_anomalies`, `run_reports` (+ run_seen_*, lender_dataset_runs), `raw_payloads` orphans, `health_check_runs`, `integrity_audit_runs` (see `database-optimization.md`).
- **Optional later**: If needed for size, add retention for `download_change_feed`, `client_historical_runs` (+ tasks/batches), `admin_download_jobs` (+ artifacts), and/or `historical_*` (e.g. 730 days) with aligned pruning of `*_rate_events` and `*_rate_intervals`. Do not add these without explicit product/ops agreement and without ensuring (a) and (b) above.

### 4. Raw_objects

- **Do not** prune `raw_objects` by age alone; they are referenced by `fetch_events` and by R2 keys. If desired, only prune hashes that are no longer referenced by any retained `fetch_event` (after fetch_events retention has run).

## Verification

- After any retention or schema change: run `npm run test:api` and `npm run typecheck:api`; run `npm run test:homepage` if deploy affects production.
- Admin: confirm status page, coverage-gap report, CDR audit, and remediation (e.g. “show fetch events”) still work within the retained windows.
