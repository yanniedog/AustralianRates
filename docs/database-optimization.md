# D1 database optimization

Summary of how the API keeps the database smaller, faster, and within resource limits.

## Retention (automatic pruning)

High-churn tables are pruned so they stay bounded. Pruning runs after every health check (scheduled and manual), so no separate cron is needed.

| Table | Retention | Implemented in |
|-------|-----------|----------------|
| `global_log` | 14 days (warn/error), 48 hours (info/debug) | `workers/api/src/db/retention-prune.ts` |
| `ingest_anomalies` | 90 days | `workers/api/src/db/retention-prune.ts` |
| `health_check_runs` | 7 days | `workers/api/src/db/health-check-runs.ts` |
| `integrity_audit_runs` | 30 days | `workers/api/src/db/integrity-audit-runs.ts` |
| `run_reports` (+ run_seen_*, lender_dataset_runs) | 180 days | `workers/api/src/db/retention-prune.ts` |
| `fetch_events` | 90 days | `workers/api/src/db/retention-prune.ts` |
| `raw_payloads` | Orphan cleanup (no matching raw_objects) | `workers/api/src/db/retention-prune.ts` |

Effects: less D1 storage, faster `COUNT(*)` and `ORDER BY ts DESC` on log/anomaly tables, less data transferred on admin log queries and dumps. For the full optimization plan (invariants: front-end data never lost, admin status/integrity pragmatic), see `docs/database-optimization-plan.md`.

## Log context size

Logger limits persisted `context` to 8,000 characters per row (`workers/api/src/utils/logger.ts`). Reduces `global_log` row size and storage.

## Export (dump) throughput

Admin full-dump job uses larger batches and more parts per pass to reduce queue invocations and finish faster: `DATABASE_DUMP_ROW_BATCH_SIZE` and `DATABASE_DUMP_PARTS_PER_PASS` in `workers/api/src/routes/admin-download-dump.ts`.

## VACUUM (reclaim space after deletes)

After large deletes (e.g. retention prunes or one-off cleanups), SQLite does not automatically reclaim disk space until `VACUUM` is run. In Cloudflare D1, run VACUUM only during a maintenance window; it can be slow and may affect availability. From repo root (with wrangler and DB name):

```bash
# Example: run VACUUM via wrangler (check current wrangler d1 execute docs)
# npx wrangler d1 execute australianrates_api --remote --command "VACUUM;"
```

Use sparingly; retention pruning alone keeps growth in check.

## Database size and breakdown

- **Total size:** Reported by the D1 API as `meta.size_after` (bytes) on query results. In the Cloudflare dashboard: D1 > your database > Metrics. Typical production size is in the hundreds of MB; limits are 500 MB (Free) / 10 GB (Paid).
- **What drives size:** Row count and average row size per table. The largest contributors are usually:
  - **fetch_events** – one row per HTTP fetch; 90-day retention keeps it bounded.
  - **historical_loan_rates**, **historical_savings_rates**, **historical_term_deposit_rates** – bulk of user-facing data; do not prune without product agreement.
  - **raw_objects** – one row per content hash (R2 pointer); grows with unique payloads.
  - **run_reports**, **run_seen_***, **lender_dataset_runs** – 180-day retention.
  - **global_log**, **ingest_anomalies** – 14d/48h and 90-day retention.
- **Live breakdown:** After deploying the API, run from repo root (with `ADMIN_API_TOKEN` in `.env`):
  ```bash
  node fetch-db-stats.js
  ```
  This calls `GET /api/home-loan-rates/admin/db/stats` and prints total size and per-table row counts (largest first). Alternatively use `GET /api/home-loan-rates/admin/db/audit` for table row counts only.

## Schema and indexes

- Canonical keys (`product_key`, `series_key`) are used for longitudinal correctness; see AGENTS.md and `docs/MISSION_AND_TECHNICAL_SPEC.md`.
- Metadata tables use `WITHOUT ROWID` where the primary key is the natural key (migration 0022), saving space and improving lookup performance.
- Indexes are added in migrations to match hot query patterns (latest by series, filters, admin lists). Do not drop indexes without measuring query plans first.
