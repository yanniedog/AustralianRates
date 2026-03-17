# Database live audit: coverage and redundancy

Assessment of what is stored in the API D1 database, how to get live row counts, and where data is excessive or redundant.

---

## 1. How to get live table stats

**Option A – Admin API (production or local)**  
Call with admin auth:

```http
GET /api/home-loan-rates/admin/db/audit
```

Response: `{ ok, generated_at, tables: [ { name, row_count } ] }` for every user table (from `sqlite_master`, excluding `sqlite_%` and `_cf_%`). Use this for a quick snapshot of current row counts.

**Option B – Integrity audit script (production, read-only)**  
From repo root:

```bash
node scripts/data-integrity-audit-prod.js --remote --db australianrates_api
```

Outputs `artifacts/data-integrity-audit-<date>.json` and `docs/data-integrity-audit-<date>.md` with dataset row counts, distinct series, duplicate/orphan/out-of-range checks, and samples. Does not return per-table counts for every table; use `/admin/db/audit` for that.

---

## 2. Table inventory and coverage

Tables are grouped by role. Names match `sqlite_master` (and the dump builder).

### 2.1 Core rate data (source of truth)

| Table | Purpose | Redundancy note |
|-------|--------|------------------|
| **historical_loan_rates** | One row per (bank, product, collection_date, LVR, rate_structure, …) home loan rate observation. Canonical time-series for charts and exports. | None. This is the source. |
| **historical_savings_rates** | Same for savings accounts (account_type, rate_type, deposit_tier, …). | None. |
| **historical_term_deposit_rates** | Same for term deposits (term_months, deposit_tier, interest_payment, …). | None. |

These tables are the only source of truth for rate history. All other rate-like tables are either derived (latest_*, events, intervals) or metadata (catalogs, presence).

### 2.2 Derived “latest” and analytics (denormalised for read path)

| Table | Purpose | Redundancy note |
|-------|--------|------------------|
| **latest_home_loan_series** | One row per series_key: “current” snapshot (latest collection_date) for that series. Used by public latest-rate APIs. | **Redundant with historical**: derivable as “last row per series_key” from historical_loan_rates. Kept for fast reads and to support is_removed/removed_at. |
| **latest_savings_series** | Same for savings. | Same as above. |
| **latest_td_series** | Same for term deposits. | Same as above. |
| **home_loan_rate_events** | Event log (rate_change, spec_change, removed, etc.) per series/date. Built from historical. | **Redundant with historical**: events could be recomputed from historical. Kept for analytics and rate-change UX. |
| **savings_rate_events** | Same for savings. | Same. |
| **td_rate_events** | Same for term deposits. | Same. |
| **home_loan_rate_intervals** | “Open interval” (effective_from/to) per series. Derived from events/history. | **Redundant with historical + events**: derivable. Kept for interval queries. |
| **savings_rate_intervals** | Same for savings. | Same. |
| **td_rate_intervals** | Same for term deposits. | Same. |

So: **latest_***, **\*_rate_events**, and **\*_rate_intervals** are deliberate denormalisations for performance and product features. They are redundant in the sense that they could be recomputed from historical_* (and in the case of events/intervals, they are built from historical by the analytics projection). They are not “excessive” unless event/interval retention is unbounded (see below).

### 2.3 Catalogs and presence (identity and lifecycle)

| Table | Purpose | Redundancy note |
|-------|--------|------------------|
| **product_catalog** | One row per (dataset_kind, bank_name, product_id): product identity, first/last seen dates, latest name/URL. | **Partially redundant**: product_id and bank_name appear in every historical row; catalog is a summary for “which products exist” and filters. |
| **series_catalog** | One row per series_key: dimensions (raw_dimensions_json), first/last seen. | **Partially redundant**: series_key and dimensions are derivable from historical; catalog is for listing/filtering and lifecycle. |
| **series_presence_status** | Per-series “still present / removed” and last_seen. Used by ingest and presence repair. | **Overlaps with series_catalog** (last_seen, is_removed). Both are updated by the same pipeline; could be merged in theory but serve slightly different queries. |
| **product_presence_status** | Per-product presence/removal (section = dataset). | Overlaps with product_catalog (is_removed, last_seen). |

So: **product_catalog**, **series_catalog**, **series_presence_status**, and **product_presence_status** duplicate some information that exists in historical_* and in each other, but they are the canonical place for “list of products/series” and “removed or not”. Not excessive if kept in sync; excess would be unbounded growth (no retention on catalogs is correct – they are dimension tables).

### 2.4 Ingest and run metadata

| Table | Purpose | Redundancy note |
|-------|--------|------------------|
| **run_reports** | One row per run: status, started_at, finished_at, per_lender_json, errors_json. | **Large blobs**: per_lender_json and errors_json can grow with number of lenders and errors. No retention; table grows forever. See “Excessive / redundant” below. |
| **lender_dataset_runs** | Per (run_id, lender_code, dataset_kind): counts (expected_detail_count, written_row_count, …), finalized_at, last_error. | Complements run_reports; not redundant. No retention. |
| **run_seen_products** | Per run/lender/dataset: which (bank, product_id) were seen. | Used for presence and idempotency. Grows with runs; no retention. **Candidates for retention** (e.g. keep last N runs). |
| **run_seen_series** | Per run/lender/dataset: which series_key were seen. | Same as run_seen_products. |
| **fetch_events** | One row per fetch: source_url, content_hash, fetched_at, run_id, http_status, body_bytes, etc. | Lineage and debugging. **Unbounded growth**; no retention. Large contributor to row count and dump size. |
| **raw_objects** | One row per content_hash: r2_key, body_bytes, content_type. Bodies in R2. | Needed for fetch_events lineage. Grows with unique payloads. |
| **raw_payloads** | Legacy: similar to fetch_events + raw_objects for older ingest path. | **Redundant with fetch_events + raw_objects** where the new pipeline is used. Known backlog of orphans (e.g. thousands of rows) with no matching raw_objects. **Excessive**: safe to prune or backfill linkage and then prune. |
| **ingest_anomalies** | Parsing anomalies (severity, reason, candidate_json). | **Retention applied**: 90-day prune (see docs/database-optimization.md). |
| **ingest_replay_queue** | Queue for replaying ingest. | Small; operational. |
| **lender_endpoint_cache** | Cache of lender endpoint URLs and expiry. | Small. |
| **cdr_detail_payload_store** | CDR product-detail payloads by hash (keyed store). | Deduped by hash; size depends on product mix. |

### 2.5 Admin, export, and operational

| Table | Purpose | Redundancy note |
|-------|--------|------------------|
| **admin_download_jobs** | Jobs for admin exports (database dump, operational snapshot). | Grows with jobs; consider retention for completed/failed jobs. |
| **admin_download_artifacts** | Per-job artifact metadata (file_name, r2_key, row_count, cursor). | Same as above. |
| **export_jobs** | Term-deposit (and similar) export jobs. | Same. |
| **download_change_feed** | Change feed for optimized/canonical/operational streams. | **Unbounded growth** unless pruned; each write can emit rows. |
| **global_log** | Application log (level, source, message, code, context, run_id, lender_code). | **Retention applied**: 30-day prune. |
| **health_check_runs** | Site health runs (components_json, integrity_json, e2e, etc.). | **Retention applied**: 7-day prune. |
| **integrity_audit_runs** | Data integrity audit runs (summary_json, findings_json). | **Retention applied**: 30-day prune. |
| **app_config** | Key-value app config (e.g. ingest pause). | Tiny. |
| **dataset_coverage_progress** | Coverage progress state. | Small. |
| **analytics_projection_state** | State for event/interval projection (pending/processing/completed). | Small. |

### 2.6 Other

| Table | Purpose | Redundancy note |
|-------|--------|------------------|
| **rba_cash_rates** | RBA cash rate by date. | Small; reference data. |
| **backfill_cursors** | Backfill state per cursor. | Small. |
| **auto_backfill_progress** | Auto-backfill progress per lender. | Small. |
| **brand_normalization_map** | Raw brand name → canonical bank name. | Small. |
| **client_historical_runs** | Client-triggered historical pull runs. | Grows with runs; consider retention. |
| **client_historical_tasks** | Tasks per run. | Same. |
| **client_historical_batches** | Batches per task. | Same. |

---

## 3. Where data is excessive or redundant

### 3.1 Completely redundant / safe to reduce

- **raw_payloads**  
  Legacy table; new pipeline uses **fetch_events** + **raw_objects**. Many rows have no matching **raw_objects** (known orphan backlog). **Action**: (1) Backfill linkage where possible, or (2) mark legacy and prune old raw_payloads by fetched_at (e.g. keep last 90 days) or delete orphans. Reduces storage and dump size.

- **latest_*_series vs historical_***  
  Latest tables are a materialised view of “current” state. Redundancy is by design for read performance. **Not excessive** unless historical is pruned and latest is not (then they must stay in sync). No action for “redundancy”; only ensure they are refreshed by the pipeline.

- **Events and intervals**  
  **\*_rate_events** and **\*_rate_intervals** are derived from historical. Redundancy is by design. **Potential excess**: if these tables never prune, they grow with every collection day. Today there is no retention on events/intervals; if they become the largest tables, consider retention (e.g. keep events for last N years) or archiving.

### 3.2 Unbounded growth (no retention)

- **run_reports**  
  Every run adds one row; **per_lender_json** and **errors_json** can be large. **Excess**: JSON blobs and row count grow forever. **Action**: Consider retention (e.g. keep 90 or 180 days) or cap total rows; optionally compact old runs to a short summary and clear the blobs.

- **fetch_events**  
  One row per HTTP fetch. **Excess**: high row count and large dump size. **Action**: Consider retention (e.g. 90 or 180 days) for lineage; or archive to cold storage and prune.

- **run_seen_products** / **run_seen_series**  
  Grow with every run. **Excess**: many rows for old runs that are no longer needed for presence. **Action**: Retention (e.g. keep last 30–90 days of runs) or delete by run_id for runs older than N days.

- **download_change_feed**  
  Grows with every emitted change. **Excess**: unbounded. **Action**: Retention by cursor_id or emitted_at (e.g. keep last N days) if consumers do not need full history.

- **admin_download_jobs** / **admin_download_artifacts**  
  **Action**: Retention for completed/failed jobs (e.g. keep 90 days) to limit growth.

- **client_historical_runs** / **client_historical_tasks** / **client_historical_batches**  
  **Action**: Retention (e.g. keep 90 days) if no long-term need.

### 3.3 Already bounded (retention in place)

- **global_log**: 30-day prune (after each health check).
- **ingest_anomalies**: 90-day prune.
- **health_check_runs**: 7-day prune.
- **integrity_audit_runs**: 30-day prune.

See **docs/database-optimization.md**.

### 3.4 Large but not redundant

- **historical_loan_rates**, **historical_savings_rates**, **historical_term_deposit_rates**  
  Core data. Size is proportional to (series × collection_dates). Not redundant; reducing size would mean archiving old dates (business decision).

- **raw_objects**  
  One row per unique content hash; bodies in R2. Size is proportional to unique payloads. Not redundant; could be trimmed only if some hashes are no longer referenced (e.g. after fetch_events retention).

---

## 4. Suggested next steps

1. **Get live counts**  
   Call `GET /api/home-loan-rates/admin/db/audit` (with admin auth) and/or run `node scripts/data-integrity-audit-prod.js --remote --db australianrates_api`. Record table row counts and, for historical_*, MIN/MAX collection_date (e.g. via ad-hoc queries or a small script).

2. **Identify largest tables**  
   Sort `tables` by `row_count`; focus on **run_reports**, **fetch_events**, **run_seen_products**, **run_seen_series**, **download_change_feed**, **raw_payloads**, and **admin_download_***.

3. **Prune or retain**  
   - **raw_payloads**: Delete orphans or apply retention by fetched_at (after backing up or confirming no dependency).
   - **run_reports** / **lender_dataset_runs**: Add retention (e.g. 90–180 days) or cap; optionally compact old per_lender_json/errors_json.
   - **fetch_events**: Add retention (e.g. 90–180 days) if lineage beyond that is not required.
   - **run_seen_products** / **run_seen_series**: Delete by run_id for runs older than N days.
   - **download_change_feed**: Add retention by emitted_at or cursor_id.
   - **admin_download_jobs** / **admin_download_artifacts**: Retain last N days of completed jobs.

4. **Events/intervals**  
   If **\*_rate_events** or **\*_rate_intervals** dominate size, consider retention or archiving policy (e.g. keep last 2 years).

5. **Re-run audit**  
   After changes, run `/admin/db/audit` and the integrity audit again to confirm row counts and integrity.

---

## 5. Reference

- **Table list source**: `workers/api/src/routes/admin-download-dump.ts` (`listDatabaseDumpTables`), `sqlite_master`.
- **Retention and optimisation**: `docs/database-optimization.md`.
- **Integrity checks**: `docs/data-integrity-audit.md`, `workers/api/src/db/integrity-checks.ts`, `workers/api/src/db/data-integrity-audit.ts`.
- **Canonical key**: `product_key` / `series_key`; see AGENTS.md and `docs/MISSION_AND_TECHNICAL_SPEC.md`.
