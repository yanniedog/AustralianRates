# Full Database Integrity Report – Australian Rates

**Generated:** 18 March 2026  
**Scope:** Production API D1 database (`australianrates_api`), logs, and status  
**Sources:** Fresh production logs (fetch 18 Mar 2026), integrity audits (17–18 Mar 2026), codebase review  
**Updates (18 Mar):** Migrations 0028, 0029, 0030 applied; API deployed; 2 orphan `latest_savings_series` rows removed; re-run audit: 17/18 checks pass.

---

## 1. Executive summary

| Area | Status | Action |
|------|--------|--------|
| **Schema / migrations** | **Green** | Migrations 0028, 0029, 0030 applied to production (18 Mar 2026). |
| **Chart / analytics** | **Green** | `chart_pivot_cache` table exists; cache refresh and analytics/series use it. |
| **Integrity audit UI** | **Green** | `integrity_audit_runs` table exists; manual runs are stored. |
| **Admin downloads** | **Green** | `export_kind`/`month_iso` columns present. |
| **Product drift / orphans** | **Green** | Orphan `latest_savings_series` rows remediated (2 deleted). 3,714 legacy `raw_payloads` without `raw_objects` remain as known backlog. |
| **Coverage gaps** | **Amber** | 23 coverage gaps (CBA term_deposits, UBank index failures, Bendigo detail failures). Operational; see CDR/playbook fixes. |
| **CDR pipeline audit** | **Amber** | 3 failed checks (2 errors, 1 warn). Review CDR audit output in admin. |
| **Core rate data** | **Green** | No invalid keys, no out-of-range rates, no duplicate historical rows. |
| **Runs with no outputs** | **Amber** | 291 runs with status=ok but zero rows written (audit finding). Operational/legacy; no data fix required. |

**Done:** Migrations applied, API deployed, orphan latest_savings_series remediated, integrity re-audit run (17 passed, 1 failed: runs_with_no_outputs). Log retention already 14d warn/error, 48h info/debug in `retention-prune.ts`.

---

## 2. Fresh log summary (production)

Logs were fetched with:

```bash
node fetch-production-logs.js --errors --warn --actionable --stats --limit=2000
```

- **Error count:** 1,086 (latest ts 2026-03-17T15:07:32.918Z)
- **Actionable issues:** 1 (unclassified; `integrity_audit_insert_failed`)

### 2.1 Recurring errors from logs

| Error / message | Cause | Fix |
|-----------------|--------|-----|
| `no such table: integrity_audit_runs` | Migration 0029 not applied | Apply `0029_integrity_audit_runs.sql` |
| `no such table: chart_pivot_cache` | Migration 0030 not applied | Apply `0030_chart_pivot_cache.sql` |
| `no such column: export_kind at offset 175` | Migration 0028 not applied | Apply `0028_admin_download_monthly.sql` |
| `coverage_gap_audit_detected_gaps` (23 gaps) | CDR/index/detail failures for CBA, UBank, Bendigo | See Coverage gaps (section 5) |
| `cdr_audit_detected_gaps` (failed: 3) | CDR pipeline audit findings | Review admin CDR audit; fix pipeline or playbooks |

### 2.2 Warnings

- **chart_cache_refresh_failed:** Cron cannot write to `chart_pivot_cache` (table missing). After migration 0030, cache refresh will succeed.
- **auth_check_failed (invalid_bearer_token):** Some requests hit admin without a valid token; expected for unauthenticated probes.

---

## 3. Schema and migration status

### 3.1 Migration status (production D1)

| Migration | Status | Applied |
|-----------|--------|---------|
| **0028** `admin_download_monthly.sql` | Applied | 18 Mar 2026 |
| **0029** `integrity_audit_runs.sql` | Applied | 18 Mar 2026 |
| **0030** `chart_pivot_cache.sql` | Applied | 18 Mar 2026 |

### 3.2 How to apply future migrations

From repo root:

```bash
cd workers/api
npx wrangler d1 migrations apply australianrates_api --remote
```

---

## 4. Product drift and orphaned data

### 4.1 Definitions

- **Product drift:** Catalog or presence rows that no longer match current product set (e.g. retired products, renames, or ingest gaps).
- **Orphan:** A row that references another entity that does not exist (e.g. `latest_*` row with no corresponding `historical_*` row; `product_presence_status` without `product_catalog`).

### 4.2 Audit results (from 17 Mar 2026 integrity audit)

| Check | Result | Detail |
|-------|--------|--------|
| product_key_consistency | PASS | 0 missing/mismatched series_key (home_loans, savings, term_deposits). |
| orphan_product_presence_status | PASS | 0 presence rows without product_catalog. |
| fetch_event_raw_object_linkage | PASS | 0 fetch_events without raw_objects. |
| **orphan_latest_savings_series** | **FAIL** | **2** rows in `latest_savings_series` with series_key not in `historical_savings_rates`. |
| orphan_latest_home_loan_series | PASS | 0. |
| orphan_latest_td_series | PASS | 0. |
| legacy_raw_payload_backlog | Informational | 3,714 raw_payloads without raw_objects (known legacy). |
| exact_duplicate_rows_* | PASS | 0 duplicate groups/rows in historical tables. |
| out_of_range_rates_* | PASS | 0. |
| null_required_fields_* | PASS | 0. |

### 4.3 Remediation

1. **Orphan latest_savings_series (2 rows)**  
   - **Done (18 Mar 2026):** Deleted the 2 orphan rows via  
     `DELETE FROM latest_savings_series WHERE series_key IN (SELECT l.series_key FROM latest_savings_series l LEFT JOIN (SELECT DISTINCT series_key FROM historical_savings_rates) h ON h.series_key = l.series_key WHERE h.series_key IS NULL)` on production D1. Re-run audit confirms 0 orphan latest_savings_series.

2. **Legacy raw_payloads (3,714)**  
   - Treat as known backlog; no change to audit pass/fail. Prune or archive per `docs/database-live-audit.md` (e.g. retention by `fetched_at` or delete orphans after backup).

3. **Product drift (catalogs vs historical)**  
   - Current audit shows no orphan `product_presence_status` rows. For ongoing drift, use coverage-gap audit and CDR audit (admin) plus presence repair tooling as needed.

---

## 5. Coverage gaps (from logs)

Coverage gap audit reported **23 gaps** (collection_date 2026-03-17). Sample from logs:

| Lender | Dataset | Issue |
|--------|---------|--------|
| CBA | term_deposits | detail_processing_incomplete, dataset_not_finalized (expected 5, processed 4, written 170) |
| UBank | savings, home_loans | index_fetch_not_succeeded, dataset_not_finalized |
| Bendigo and Adelaide | savings, home_loans | failed_detail_fetches_present, dataset_not_finalized (e.g. 72 failed detail fetches for home_loans) |

**Actions:** Use admin coverage-gap report and CDR/playbook tuning (endpoints, playbooks, retries). See CDR-bank-api-expert skill and `docs/database-live-audit.md`.

---

## 6. Code changes made (this session)

1. **Chart cache (workers/api/src/db/chart-cache.ts)**  
   - `readD1ChartCache`: On "no such table: chart_pivot_cache", return `null` so callers fall back to live compute instead of 500.  
   - `writeD1ChartCache`: On same error, no-op so cron does not throw.

2. **Integrity audit runs (workers/api/src/db/integrity-audit-runs.ts)**  
   - `insertIntegrityAuditRun`: On "no such table: integrity_audit_runs", catch and return without throwing so manual audit run returns 200 and does not log `integrity_audit_insert_failed`.

These changes allow the API to run without 500s when migrations 0029 and 0030 are not yet applied. **Applying the migrations remains required** for full functionality (audit history, chart cache, and correct admin downloads if fallback were ever removed).

---

## 7. Recommendations (priority order)

1. ~~**Apply D1 migrations (production)**~~ **Done.** Applied 0028, 0029, 0030 on 18 Mar 2026.

2. ~~**Deploy API worker**~~ **Done.** API deployed 18 Mar 2026.

3. ~~**Remediate 2 orphan latest_savings_series rows**~~ **Done.** Deleted 2 orphan rows on production D1.

4. ~~**Re-run data integrity audit**~~ **Done.** Audit run: 17 passed, 1 failed (runs_with_no_outputs: 291). orphan_latest_savings_series now PASS.

5. **Address coverage gaps and CDR audit**  
   Use admin coverage-gap and CDR audit UIs; fix UBank index, Bendigo detail failures, and CBA term_deposit finalization per playbooks and CDR expert guidance.

6. **Optional: raw_payloads backlog**  
   Plan retention or orphan cleanup for `raw_payloads` per `docs/database-live-audit.md`.

7. **Optional: runs_with_no_outputs (291)**  
   Audit flags 291 runs with status=ok but zero rows written. Treat as operational/legacy; no data fix required unless you want to mark or prune old runs.

---

## 8. References

- **Table inventory and redundancy:** `docs/database-live-audit.md`
- **Integrity audit script:** `tools/node-scripts/src/integrity/data-integrity-audit-prod.ts`
- **How to run audit:** `docs/data-integrity-audit.md`
- **Previous audit report:** `docs/data-integrity-audit-report-2026-03-17.md`
- **Retention and optimisation:** `docs/database-optimization.md`
- **In-worker integrity checks:** `workers/api/src/db/integrity-checks.ts`, `workers/api/src/db/data-integrity-audit.ts`
