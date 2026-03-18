# D1 database optimization

Summary of how the API keeps the database smaller, faster, and within resource limits.

## Retention (automatic pruning)

High-churn tables are pruned so they stay bounded. Pruning runs after every health check (scheduled and manual), so no separate cron is needed.

| Table | Retention | Implemented in |
|-------|-----------|----------------|
| `global_log` | 14 days (warn/error), 48 hours (info/debug) | `workers/api/src/db/retention-prune.ts` |
| `ingest_anomalies` | 3 days | `workers/api/src/db/retention-prune.ts` |
| `health_check_runs` | 3 days | `workers/api/src/db/health-check-runs.ts` |
| `integrity_audit_runs` | 3 days | `workers/api/src/db/integrity-audit-runs.ts` |
| `run_reports` (+ run_seen_*, lender_dataset_runs) | 3 days | `workers/api/src/db/retention-prune.ts` |
| `fetch_events` | 3 days | `workers/api/src/db/retention-prune.ts` |
| `raw_objects` | Orphan cleanup (content_hash not in fetch_events) | `workers/api/src/db/retention-prune.ts` |
| `raw_payloads` | Orphan cleanup (no matching raw_objects) | `workers/api/src/db/retention-prune.ts` |

Effects: less D1 storage, faster `COUNT(*)` and `ORDER BY ts DESC` on log/anomaly tables, less data transferred on admin log queries and dumps. For the full optimization plan (invariants: front-end data never lost, admin status/integrity pragmatic), see `docs/database-optimization-plan.md`.

## Log context size

Logger limits persisted `context` to 8,000 characters per row (`workers/api/src/utils/logger.ts`). Reduces `global_log` row size and storage.

## Export (dump) throughput

Admin full-dump job uses larger batches and more parts per pass to reduce queue invocations and finish faster: `DATABASE_DUMP_ROW_BATCH_SIZE` and `DATABASE_DUMP_PARTS_PER_PASS` in `workers/api/src/routes/admin-download-dump.ts`.

## Rate bounds triggers after migration 0032

Migration 0032 drops and does not recreate the rate bounds triggers (from 0012) because D1/wrangler splits migration SQL on semicolons, which breaks `CREATE TRIGGER` bodies on remote. Application validation remains the primary enforcement. To re-create the triggers, run the DDL from `workers/api/migrations/0012_rate_bounds_triggers.sql` manually (e.g. one trigger per file with `wrangler d1 execute australianrates_api --remote --file=...` from `workers/api`).

## VACUUM (reclaim space after deletes)

After large deletes (e.g. retention prunes or one-off cleanups), SQLite does not automatically reclaim disk space until `VACUUM` is run. In Cloudflare D1, run VACUUM only during a maintenance window; it can be slow and may affect availability. From `workers/api`:

```bash
npx wrangler d1 execute australianrates_api --remote --command "VACUUM;"
```

Use sparingly; retention pruning alone keeps growth in check.

## Database size and breakdown

- **Total size:** Reported by the D1 API as `meta.size_after` (bytes) on query results. In the Cloudflare dashboard: D1 > your database > Metrics. Typical production size is in the hundreds of MB; limits are 500 MB (Free) / 10 GB (Paid).
- **What drives size:** Row count and average row size per table. The largest contributors are usually:
  - **historical_loan_rates**, **historical_savings_rates**, **historical_term_deposit_rates** – one row per (product_key, collection_date); bulk of user-facing data (migration 0032). Do not prune without product agreement.
  - **fetch_events** – one row per HTTP fetch; 3-day retention keeps it bounded.
  - **raw_objects** – pruned to content_hashes still in fetch_events (3-day window).
  - **run_reports**, **run_seen_***, **lender_dataset_runs** – 3-day retention.
  - **global_log**, **ingest_anomalies** – 14d/48h and 3-day retention.
- **Live breakdown:** After deploying the API, run from repo root (with `ADMIN_API_TOKEN` in `.env`):
  ```bash
  node fetch-db-stats.js
  ```
  This calls `GET /api/home-loan-rates/admin/db/stats` and prints total size and per-table row counts (largest first). Alternatively use `GET /api/home-loan-rates/admin/db/audit` for table row counts only.

## Plan status (one row per day, no intra-day duplicates)

The optimization plan in `docs/database-optimization-plan.md` is **fully implemented**:

- **Front-end historical tables:** One row per (product_key, collection_date). Migration 0032 deduplicated existing data (preferring `run_source = 'scheduled'`, then latest `parsed_at`). The write path uses `ON CONFLICT` on the natural key so new inserts never create a second row for the same product and day.
- **Backend retention:** fetch_events, run_reports (+ run_seen_*, lender_dataset_runs), ingest_anomalies, health_check_runs, integrity_audit_runs use 3-day retention. raw_objects and raw_payloads are pruned to the retained window. Retention runs after every health check (e.g. every 15 minutes via cron).

**Why total row count is still high:** Most rows are in **backend/operational** tables, not in the historical rate tables:

| Source | Typical share | Notes |
|--------|----------------|-------|
| fetch_events | Largest (~180k+ in 3-day window) | One row per HTTP fetch; many lenders × products per run |
| run_seen_series, run_seen_products | ~68k, ~16k | 3-day retention; one per (run, series/product) |
| download_change_feed, client_historical_tasks | ~62k, ~56k | Operational; no retention in plan (optional later) |
| raw_objects | ~60k | 3-day window after fetch_events prune |
| historical_loan_rates, historical_savings_rates, historical_term_deposit_rates | ~13k, ~7k, ~21k | **One row per product per day**; no intra-day duplicates |

To confirm there are no intra-day duplicates in historical tables, run (with `ADMIN_API_TOKEN` in `.env`):

```bash
node fetch-duplicate-check.js
```

Expect `duplicate_rows=0` for each table and `one_row_per_day: yes`. The API also exposes `GET /api/home-loan-rates/admin/db/duplicate-check` (admin auth required).

## Front-end data shape

- **One row per (product_key, collection_date):** Migration 0032 enforces at most one row per product per day in historical_* tables. Charts and APIs naturally get one point per day. Write path uses ON CONFLICT on the natural key (no run_source) so the last write for that day wins.

## Schema and indexes

- Canonical keys (`product_key`, `series_key`) are used for longitudinal correctness; see AGENTS.md and `docs/MISSION_AND_TECHNICAL_SPEC.md`.
- Metadata tables use `WITHOUT ROWID` where the primary key is the natural key (migration 0022), saving space and improving lookup performance.
- Indexes are added in migrations to match hot query patterns (latest by series, filters, admin lists). Do not drop indexes without measuring query plans first.
