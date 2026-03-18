# Database optimization plan

This document defines how to keep the D1 database smaller and optimised while (a) never losing front-end data and (b) keeping admin status and integrity features pragmatic and useful.

## Invariants

### (a) Front-end data is never lost

- **Do not drop or over-prune** any table or column that feeds the public site or API.
- **User-facing data** lives in:
  - `historical_loan_rates`, `historical_savings_rates`, `historical_term_deposit_rates` (one row per (product_key, collection_date); migration 0032)
  - `latest_home_loan_series`, `latest_savings_series`, `latest_td_series`
  - `home_loan_rate_events`, `savings_rate_events`, `term_deposit_rate_events` (if used by charts/exports)
  - `chart_pivot_cache`, `rba_cash_rates`
  - `cdr_detail_payload_store` (referenced by historical/latest for detail)
- **Retention on user data**: If historical rates (or events/intervals) ever get retention pruning, it must be **no shorter than** the intended chart/export horizon (e.g. 730 days). Do not prune these tables unless product explicitly agrees.
- **Orphan pruning** on `cdr_detail_payload_store` is safe only for hashes that are no longer referenced by any row in historical_* or latest_* (or after historical retention has run).

### (b) Admin status and integrity remain pragmatic and useful

- **Run history**: `run_reports` (and run_seen_*, lender_dataset_runs) drive run list, coverage gaps, and “runs with no outputs”. Keep **3 days** for backend integrity and validation (lineage repair, CDR audit, coverage-gap).
- **Logs**: `global_log` 14d (warn/error) and 48h (info/debug) so actionable issues and recent context remain.
- Older historical rate rows may have `fetch_event_id` pointing to pruned fetch_events (lookup returns null); that is acceptable.

## Concrete actions

### 1. Backend retention and raw_objects (implemented)

- **fetch_events**: Prune rows where `fetched_at < now - 3 days` (in `runRetentionPrunes`).
- **raw_objects**: After pruning fetch_events, delete rows where `content_hash NOT IN (SELECT content_hash FROM fetch_events)` so storage matches the 3-day lineage window.
- **run_reports**, **ingest_anomalies**: 3 days. **health_check_runs**, **integrity_audit_runs**: 3 days.
- **Effect**: Backend tables stay small; admin remediation and CDR audit use recent lineage only.

### 2. Fetch_events column slim (implemented)

- **Drop** from `fetch_events` (migration): `response_headers_json`, `body_bytes`, `duration_ms`, `notes`, `job_kind`.
- **Reason**: Not used in WHERE/JOIN/ORDER; only for admin display. `body_bytes` is redundant with `raw_objects.body_bytes`; headers/duration/notes/job_kind are not required for lineage or audit.
- **Code**: Stop inserting and selecting these columns; for `getFetchEventById`, source `body_bytes` from `raw_objects` in the existing JOIN when needed for display.

### 3. Other retention (already in place or optional)

- **Already in place**: `global_log`, `ingest_anomalies`, `run_reports` (+ run_seen_*, lender_dataset_runs), `raw_payloads` orphans, `health_check_runs`, `integrity_audit_runs` (see `database-optimization.md`).
- **Optional later**: If needed for size, add retention for `download_change_feed`, `client_historical_runs` (+ tasks/batches), `admin_download_jobs` (+ artifacts), and/or `historical_*` (e.g. 730 days) with aligned pruning of `*_rate_events` and `*_rate_intervals`. Do not add these without explicit product/ops agreement and without ensuring (a) and (b) above.

### 4. Raw_objects (implemented)

- Prune `raw_objects` after `fetch_events` retention: delete where `content_hash NOT IN (SELECT content_hash FROM fetch_events)`. Keeps only objects referenced by the retained 3-day fetch_events window.

## Verification

- After any retention or schema change: run `npm run test:api` and `npm run typecheck:api`; run `npm run test:homepage` if deploy affects production.
- Admin: confirm status page, coverage-gap report, CDR audit, and remediation (e.g. “show fetch events”) still work within the retained windows.
- After applying migration 0032: optionally run projection rebuild for all datasets so rate_events and rate_intervals reflect deduplicated historical data; chart_pivot_cache refreshes on next cron.
