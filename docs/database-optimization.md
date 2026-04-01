# D1 database optimization

Summary of how the API keeps the database smaller, faster, and within resource limits.

## Retention (automatic pruning)

High-churn tables are pruned so they stay bounded. Pruning runs after every health check (scheduled and manual), so no separate cron is needed.

| Table | Retention | Implemented in |
|-------|-----------|----------------|
| `global_log` | 48 hours (all levels), then cap at 200k rows (oldest first) | `workers/api/src/db/retention-prune.ts` |
| `ingest_anomalies` | 1 day | `workers/api/src/db/retention-prune.ts` |
| `health_check_runs` | 1 day | `workers/api/src/db/health-check-runs.ts` |
| `integrity_audit_runs` | 1 day | `workers/api/src/db/integrity-audit-runs.ts` |
| `run_reports` (+ `run_seen_*`, `lender_dataset_runs`) | 30 days | `workers/api/src/db/retention-prune.ts` |
| `fetch_events` | 3650 days | `workers/api/src/db/retention-prune.ts` |
| `raw_objects` | Orphan cleanup only after fetch-event pruning; effectively follows the retained fetch-events window | `workers/api/src/db/retention-prune.ts` |
| `raw_payloads` | Orphan cleanup (no matching `raw_objects`) | `workers/api/src/db/retention-prune.ts` |
| `download_change_feed` | 1 day | `workers/api/src/db/retention-prune.ts` |
| `client_historical_runs` (+ tasks, batches CASCADE) | 1 day | `workers/api/src/db/retention-prune.ts` |
| `historical_provenance_recovery_log` | 30 days, but only after `historical_provenance_recovery_runs` has summary rows | `workers/api/src/db/retention-prune.ts` |

Effects:
- Low-value operational churn stays compact.
- Raw run-state remains available for recent longitudinal quality investigations.
- Provenance lineage (`fetch_events`, `raw_objects`, `historical_provenance_status`) remains long-term.

Guardrail:
- Do not shorten `fetch_events` / `raw_objects` retention.
- Do not lengthen raw run-state retention further unless the historical-quality evidence model is still complete and the size audit still supports it.

To compact immediately after deploy, run from repo root with `ADMIN_API_TOKEN` in `.env`:

```bash
node trigger-retention.js
```

## Retention size audit

Before changing any raw run-state retention window, run the read-only retention size audit and inspect the recommendation:

- Admin route: `GET /api/home-loan-rates/admin/audits/historical-quality/retention-size-audit`
- Script: `node scripts/retention-size-audit-prod.js --output-json artifacts/retention-size-audit.json --output-md docs/retention-size-audit.md`
- Guardrail: if `evidence_backfill.has_permanent_evidence_backfill` is false, do not lengthen raw run-state retention.

Production result on 2026-04-01 after backfill:
- `historical_quality_daily` evidence backfill completed for all 34 retained historical dates.
- Current DB size was about `730.649 MB`.
- 30-day raw run-state retention was recommended and allowed.
- Estimated extra storage for moving from 1 day to 30 days was only `12.718 MB`.

## Log context size

Logger limits persisted `context` to 8,000 characters per row (`workers/api/src/utils/logger.ts`). This reduces `global_log` row size and storage.

## Export (dump) throughput

Admin full-dump jobs use larger batches and more parts per pass to reduce queue invocations and finish faster: `DATABASE_DUMP_ROW_BATCH_SIZE` and `DATABASE_DUMP_PARTS_PER_PASS` in `workers/api/src/routes/admin-download-dump.ts`.

## VACUUM (reclaim space after deletes)

After large deletes, SQLite does not automatically reclaim disk space until `VACUUM` is run. In Cloudflare D1, run `VACUUM` only during a maintenance window because it can be slow and may affect availability.

From `workers/api`:

```bash
npx wrangler d1 execute australianrates_api --remote --command "VACUUM;"
```

Use sparingly. Retention pruning alone usually keeps growth in check.

## Database size and breakdown

The largest storage contributors are usually:

- `historical_loan_rates`, `historical_savings_rates`, `historical_term_deposit_rates`: user-facing time-series truth. Do not prune without explicit product agreement.
- `fetch_events`: one row per HTTP fetch; retained for 3650 days because it is part of the provenance chain.
- `raw_objects`: retained only while referenced by retained `fetch_events`.
- `run_reports`, `run_seen_*`, `lender_dataset_runs`: 30-day raw run-state window.
- `historical_provenance_recovery_log`: high-churn row-level debug table; capped at 30 days once summary rows exist.
- `global_log`, `ingest_anomalies`, `download_change_feed`, `client_historical_*`: deliberately short-lived operational churn.

For a live breakdown, run from repo root:

```bash
node fetch-db-stats.js
```

This calls `GET /api/home-loan-rates/admin/db/stats` and prints total size and per-table row counts. Alternatively use `GET /api/home-loan-rates/admin/db/audit` for row counts only.

## Plan status

Current state:

- Historical rate tables are one row per `(product_key, collection_date)`.
- Raw run-state is retained for 30 days.
- Long-term provenance is preserved through `fetch_events`, `raw_objects`, and `historical_provenance_status`.
- Row-level provenance recovery churn is compacted after 30 days once `historical_provenance_recovery_runs` summaries exist.
- Low-value operational churn remains on 1-day retention.

## Front-end data shape

- One row per `(product_key, collection_date)`: migration 0032 enforces at most one row per product per day in `historical_*` tables.
- Charts and APIs naturally get one point per day.
- The write path uses `ON CONFLICT` on the natural key so the last write for that day wins.

## Schema and indexes

- Canonical keys (`product_key`, `series_key`) are used for longitudinal correctness; see `AGENTS.md` and `docs/MISSION_AND_TECHNICAL_SPEC.md`.
- Metadata tables use `WITHOUT ROWID` where the primary key is the natural key (migration 0022), saving space and improving lookup performance.
- Indexes are added in migrations to match hot query patterns. Do not drop indexes without measuring query plans first.
