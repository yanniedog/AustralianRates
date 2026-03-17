# Data integrity audit

Full data integrity and verification checks for all data in the API database (D1). The audit detects **dead**, **invalid**, **duplicate**, and **erroneous** data.

## Admin portal

- **Page:** Admin > **Data integrity** (`/admin/integrity.html`).
- **Traffic lights:** Green = all checks passed; amber = minor/informational issues only; red = issues that require attention.
- **Manual run:** Use **Run audit now** to re-run the audit and verify fixes.
- **Daily run:** The audit runs automatically once per day at **04:00 UTC** (scheduled cron). Results are stored and shown on the Data integrity page.

## What is checked

| Category   | Checks |
|-----------|--------|
| **Dead**  | Orphan `product_presence_status` (no matching `product_catalog`); orphan `fetch_events` (no `raw_objects`); orphan `raw_payloads` (no `raw_objects`); orphan rows in `latest_home_loan_series` / `latest_savings_series` / `latest_td_series` (series_key not present in historical table). |
| **Invalid** | Missing or mismatched `series_key` vs canonical product_key expression (per dataset); `interest_rate` out of bounds (home 0.5–25%, savings/td 0–15%); NULL/empty required fields (bank_name, product_id, collection_date, interest_rate). |
| **Duplicate** | Exact duplicate rows in historical tables: same (series_key, collection_date, run_id, interest_rate) appearing more than once (home_loans, savings, term_deposits). |
| **Erroneous** | Runs with status `ok` but zero rows written and problematic lender_dataset_runs; any query execution error (recorded as a finding). |
| **Indicator** | Latest vs global freshness (scheduled vs global max collection_date per dataset; informational only). |

## How to run the full audit

From repo root, with Cloudflare credentials and network:

```bash
node scripts/data-integrity-audit-prod.js --remote --db australianrates_api
```

Optional:

- `--output-json=<path>` – default: `artifacts/data-integrity-audit-<date>.json`
- `--output-md=<path>` – default: `docs/data-integrity-audit-<date>.md`

Exit code: 0 if all checks passed, 1 if any failed (or script error). Output is written to stdout as one JSON line (paths and `failed_count`).

The script runs read-only SQL against production D1 via `wrangler d1 execute australianrates_api --remote`. Each query is run in sequence; a single query failure is recorded as an erroneous finding and the audit continues. Reports are written to the paths above.

## Existing integrity checks (no DB access)

The API already runs integrity checks on each health run and stores the result:

- **Product key consistency** – missing/mismatched series_key on historical tables.
- **Orphan product_presence_status** – presence rows with no product_catalog row (when `FEATURE_INTEGRITY_PROBES_ENABLED` is on).
- **Fetch event / raw_object linkage** – fetch_events referencing missing raw_objects.
- **Runs with no outputs** – ok runs with zero historical rows and invariant violations.
- **Legacy raw_payload backlog** – raw_payloads with no raw_objects (informational).
- **Dataset staleness** – latest collection_date per dataset vs Melbourne date.
- **Recent anomaly volume** – ingest_anomalies in last 7 days by severity.

Rate-change endpoints also run **rate-change integrity** per dataset (missing key dimensions, identity collisions, duplicate transitions, excluded-row accounting).

To see the latest integrity result without running the full audit:

1. Trigger a health run: `POST /admin/health/run` (admin auth).
2. Read latest: `GET /admin/health` and use `latest.integrity`.

## Runbook (manual queries)

For one-off manual checks, use the integrity runbook (read-only SQL you can run with `wrangler d1 execute australianrates_api --remote --command "..."`):

```bash
node scripts/print-integrity-runbook.js
```

## Coverage audit (overlap and conflicts)

For overlap and conflict analysis (same series_key + collection_date from multiple run_sources, with or without conflicting state), use the production coverage audit:

```bash
node scripts/coverage-audit-prod.js --remote --db australianrates_api
```

This produces `artifacts/production-coverage-audit-<date>.json` and `docs/production-coverage-audit-<date>.md`.
