# Data Integrity Audit Report

**Australian Rates – API Database (D1)**  
**Report date:** 17 March 2026  
**Target:** Production database `australianrates_api` (Cloudflare D1, remote)  
**Audit execution:** 17 March 2026, 05:06:42 UTC (~2.9 minutes)

---

## 1. Executive summary

A full data-integrity audit was run against the production API database. The audit ran **18 checks** across dead, invalid, duplicate, and erroneous data. **16 checks passed**; **2 outcomes are reported as failed**:

- **1 data finding:** 2 orphan rows in `latest_savings_series` (dead data).
- **1 execution finding:** The “runs with no outputs” check could not be executed (D1 storage timeout during that single query); this is an audit-tool/execution issue, not a database integrity result.

**Overall assessment:** Data integrity is **good**. No invalid or duplicate rate data was found. One minor dead-data issue (2 savings “latest” rows) and one known legacy backlog (raw payloads) are documented below. No missing/mismatched product keys, no out-of-range rates, and no exact duplicate historical rows.

---

## 2. Scope and method

### 2.1 Scope

- **Database:** `australianrates_api` (production, remote).
- **Tables in scope:** Historical rate tables (`historical_loan_rates`, `historical_savings_rates`, `historical_term_deposit_rates`), latest-series tables (`latest_home_loan_series`, `latest_savings_series`, `latest_td_series`), catalog/linkage tables (`product_catalog`, `product_presence_status`, `raw_payloads`, `raw_objects`, `fetch_events`), run metadata (`run_reports`, `lender_dataset_runs`).

### 2.2 Method

- Read-only SQL executed via `wrangler d1 execute australianrates_api --remote`.
- Each check is a single SELECT (or WITH...SELECT). No data was modified.
- Checks are defined in `tools/node-scripts/src/integrity/data-integrity-audit-prod.ts`.
- Script: `node scripts/data-integrity-audit-prod.js --remote --db australianrates_api`.
- Outputs: `artifacts/data-integrity-audit-2026-03-17.json`, `docs/data-integrity-audit-2026-03-17.md`.

### 2.3 Coverage summary

| Category    | Checks run | Passed | Failed |
|------------|------------|--------|--------|
| Invalid    | 7          | 7      | 0      |
| Dead       | 5          | 4      | 1      |
| Duplicate  | 3          | 3      | 0      |
| Erroneous  | 1          | 0      | 1 (execution) |
| Indicator  | 1          | 1      | 0      |
| **Total**  | **18**     | **16** | **2**  |

---

## 3. Results by category

### 3.1 Invalid data

All checks **passed**. No invalid data was found.

| Check | Result | Detail |
|-------|--------|--------|
| product_key_consistency | PASS | Missing series_key: 0; mismatched series_key: 0 (all three datasets). |
| out_of_range_rates_home_loans | PASS | 0 rows outside 0.5–25%. |
| out_of_range_rates_savings | PASS | 0 rows outside 0–15%. |
| out_of_range_rates_term_deposits | PASS | 0 rows outside 0–15%. |
| null_required_fields_home_loans | PASS | 0 rows with NULL/empty bank_name, product_id, collection_date, or interest_rate. |
| null_required_fields_savings | PASS | 0. |
| null_required_fields_term_deposits | PASS | 0. |

**Conclusion:** No malformed keys, no out-of-range rates, no missing required fields in historical rate data.

---

### 3.2 Dead data

Four checks passed; **one check failed** (orphan latest savings series).

| Check | Result | Detail |
|-------|--------|--------|
| orphan_product_presence_status | PASS | 0 presence rows without a matching product_catalog row. |
| fetch_event_raw_object_linkage | PASS | 0 fetch_events without a matching raw_objects row. |
| legacy_raw_payload_backlog | PASS (informational) | 3,714 raw_payloads without a matching raw_objects row; treated as known legacy backlog, not a new failure. |
| orphan_latest_home_loan_series | PASS | 0. |
| **orphan_latest_savings_series** | **FAIL** | **2** rows in `latest_savings_series` have a series_key that does not appear in `historical_savings_rates`. |
| orphan_latest_td_series | PASS | 0. |

**Finding (dead data):**  
- **Severity:** Low.  
- **Description:** Two rows in `latest_savings_series` reference a `series_key` that no longer exists in `historical_savings_rates`. Those “latest” rows are stale (e.g. series retired or data removed from historical).  
- **Impact:** Savings “latest” view can expose up to 2 series that have no history; charts/exports for those series would have no historical points.  
- **Recommendation:** Identify the 2 series_keys (e.g. `SELECT series_key FROM latest_savings_series l LEFT JOIN (SELECT DISTINCT series_key FROM historical_savings_rates) h ON h.series_key = l.series_key WHERE h.series_key IS NULL`) and either remove them from `latest_savings_series` or backfill/restore corresponding historical rows if they should still be active.

---

### 3.3 Duplicate data

All checks **passed**. No exact duplicate rows were found.

| Check | Result | Detail |
|-------|--------|--------|
| exact_duplicate_rows_home_loans | PASS | 0 duplicate groups, 0 duplicate rows (same series_key, collection_date, run_id, interest_rate). |
| exact_duplicate_rows_savings | PASS | 0, 0. |
| exact_duplicate_rows_term_deposits | PASS | 0, 0. |

**Conclusion:** No exact duplicates in historical rate tables.

---

### 3.4 Erroneous / execution

| Check | Result | Detail |
|-------|--------|--------|
| runs_with_no_outputs_count | FAIL (execution) | Query did not complete. Cloudflare D1 returned: “D1 DB storage operation exceeded timeout which caused object to be reset.” The audit uses a subquery-heavy SELECT for this check; when run via `--file`, the operation timed out. This is an **audit execution** failure, not a database integrity result. |

**Conclusion:** The number of “runs with no outputs” was **not** measured in this run. Re-run this single check (e.g. via runbook or a lighter query), or run the same audit again; the rest of the audit completed successfully.

---

### 3.5 Indicator (informational)

| Check | Result | Detail |
|-------|--------|--------|
| latest_vs_global_freshness | PASS | All three datasets: global_latest = scheduled_latest = 2026-03-17; mismatch count = 0. |

**Conclusion:** Scheduled and global latest collection dates align; no freshness mismatch observed.

---

## 4. Findings summary

| # | Severity | Category | Check | Count / detail |
|---|----------|----------|--------|----------------|
| 1 | Low | Dead | orphan_latest_savings_series | 2 rows in latest_savings_series with no matching historical series_key. |
| 2 | N/A (execution) | Erroneous | runs_with_no_outputs_count | Check could not be executed (D1 timeout). |

---

## 5. Recommendations

1. **Remediate orphan latest savings (2 rows):** Run the diagnostic query above to get the two `series_key` values, then either delete those rows from `latest_savings_series` or restore/backfill the corresponding rows in `historical_savings_rates` if the products are still active.
2. **Re-check “runs with no outputs”:** Run the runbook query for `api_runs_no_outputs_count` manually, or split/simplify the audit query so it runs within D1 time limits, then re-run the audit or this check.
3. **Legacy raw_payload backlog (3,714):** Continue to treat as known backlog; no change to audit pass/fail. Address via existing repair/archival procedures if desired.

---

## 6. Artifacts and references

- **Full JSON:** `artifacts/data-integrity-audit-2026-03-17.json`
- **Short MD:** `docs/data-integrity-audit-2026-03-17.md`
- **Audit script:** `tools/node-scripts/src/integrity/data-integrity-audit-prod.ts`
- **How to run:** `docs/data-integrity-audit.md`

---

**Report generated from audit output dated 2026-03-17T05:06:42.311Z.**
