# Data integrity audit report

Generated: 2026-03-17T05:02:39.914Z
Target DB: australianrates_api

## Summary

- Total checks: 18
- Passed: 16
- Failed: 2
- Dead data issues: 1
- Invalid data issues: 0
- Duplicate data issues: 0
- Other issues: 1

## Findings

### product_key_consistency [invalid] PASS

- Count: 0
- Detail: {"missing_series_key_total":0,"mismatched_series_key_total":0,"by_dataset":[{"dataset":"home_loans","missing_series_key":0,"mismatched_series_key":0},{"dataset":"savings","missing_series_key":0,"mismatched_series_key":0},{"dataset":"term_deposits","missing_series_key":0,"mismatched_series_key":0}]}

### orphan_product_presence_status [dead] PASS

- Count: 0
- Detail: {"orphan_count":0}

### fetch_event_raw_object_linkage [dead] PASS

- Count: 0
- Detail: {"orphan_count":0}

### legacy_raw_payload_backlog [dead] PASS

- Count: 3714
- Detail: {"orphan_count":3714}

### runs_with_no_outputs [erroneous] FAIL

- Count: 291
- Detail: {"runs_with_no_outputs":291}

### exact_duplicate_rows_home_loans [duplicate] PASS

- Count: 0
- Detail: {"duplicate_groups":0,"duplicate_rows":0}

### exact_duplicate_rows_savings [duplicate] PASS

- Count: 0
- Detail: {"duplicate_groups":0,"duplicate_rows":0}

### exact_duplicate_rows_term_deposits [duplicate] PASS

- Count: 0
- Detail: {"duplicate_groups":0,"duplicate_rows":0}

### out_of_range_rates_home_loans [invalid] PASS

- Count: 0
- Detail: {"bounds":"0.5-25","out_of_range_count":0}

### out_of_range_rates_savings [invalid] PASS

- Count: 0
- Detail: {"bounds":"0-15","out_of_range_count":0}

### out_of_range_rates_term_deposits [invalid] PASS

- Count: 0
- Detail: {"bounds":"0-15","out_of_range_count":0}

### null_required_fields_home_loans [invalid] PASS

- Count: 0
- Detail: {"null_count":0}

### null_required_fields_savings [invalid] PASS

- Count: 0
- Detail: {"null_count":0}

### null_required_fields_term_deposits [invalid] PASS

- Count: 0
- Detail: {"null_count":0}

### orphan_latest_home_loan_series [dead] PASS

- Count: 0
- Detail: {"orphan_count":0}

### orphan_latest_savings_series [dead] FAIL

- Count: 2
- Detail: {"orphan_count":2}

### orphan_latest_td_series [dead] PASS

- Count: 0
- Detail: {"orphan_count":0}

### latest_vs_global_freshness [indicator] PASS

- Detail: {"mismatch_dataset_count":0,"datasets":[{"dataset":"home_loans","global_latest":"2026-03-17","scheduled_latest":"2026-03-17","latest_global_mismatch":0},{"dataset":"savings","global_latest":"2026-03-17","scheduled_latest":"2026-03-17","latest_global_mismatch":0},{"dataset":"term_deposits","global_latest":"2026-03-17","scheduled_latest":"2026-03-17","latest_global_mismatch":0}]}

## Executed commands

- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT 'home_loans' AS dataset, COUNT(*) AS total_rows, COUNT(DISTINCT series_key) AS distinct_series FROM historical_loan_rates UNION ALL SELECT 'savings', COUNT(*), COUNT(DISTINCT series_key) FROM historical_savings_rates UNION ALL SELECT 'term_deposits', COUNT(*), COUNT(DISTINCT series_key) FROM historical_term_deposit_rates --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT 'home_loans' AS dataset, SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END) AS missing_series_key, SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure) THEN 1 ELSE 0 END) AS mismatched_series_key FROM historical_loan_rates UNION ALL SELECT 'savings', SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END), SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier) THEN 1 ELSE 0 END) FROM historical_savings_rates UNION ALL SELECT 'term_deposits', SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END), SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier || '|' || interest_payment) THEN 1 ELSE 0 END) FROM historical_term_deposit_rates --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT COUNT(*) AS orphan_count FROM product_presence_status p LEFT JOIN product_catalog c ON c.dataset_kind = p.section AND c.bank_name = p.bank_name AND c.product_id = p.product_id WHERE c.product_id IS NULL --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT COUNT(*) AS orphan_count FROM fetch_events fe LEFT JOIN raw_objects ro ON ro.content_hash = fe.content_hash WHERE ro.content_hash IS NULL --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT COUNT(*) AS orphan_count FROM raw_payloads rp LEFT JOIN raw_objects ro ON ro.content_hash = rp.content_hash WHERE ro.content_hash IS NULL --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command WITH run_outputs AS ( SELECT rr.run_id, (SELECT COUNT(*) FROM historical_loan_rates hl WHERE hl.run_id = rr.run_id) AS home_rows, (SELECT COUNT(*) FROM historical_savings_rates hs WHERE hs.run_id = rr.run_id) AS savings_rows, (SELECT COUNT(*) FROM historical_term_deposit_rates ht WHERE ht.run_id = rr.run_id) AS td_rows FROM run_reports rr ) SELECT COUNT(*) AS runs_with_no_outputs FROM run_outputs WHERE (home_rows + savings_rows + td_rows) = 0 --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command WITH g AS (SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n FROM historical_loan_rates GROUP BY series_key, collection_date, run_id, interest_rate HAVING COUNT(*) > 1) SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS duplicate_rows FROM g --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command WITH g AS (SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n FROM historical_savings_rates GROUP BY series_key, collection_date, run_id, interest_rate HAVING COUNT(*) > 1) SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS duplicate_rows FROM g --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command WITH g AS (SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n FROM historical_term_deposit_rates GROUP BY series_key, collection_date, run_id, interest_rate HAVING COUNT(*) > 1) SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS duplicate_rows FROM g --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT COUNT(*) AS out_of_range_count FROM historical_loan_rates WHERE interest_rate < 0.5 OR interest_rate > 25 --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT COUNT(*) AS out_of_range_count FROM historical_savings_rates WHERE interest_rate < 0 OR interest_rate > 15 --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT COUNT(*) AS out_of_range_count FROM historical_term_deposit_rates WHERE interest_rate < 0 OR interest_rate > 15 --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name,'')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id,'')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date,'')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS null_count FROM historical_loan_rates --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name,'')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id,'')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date,'')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS null_count FROM historical_savings_rates --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name,'')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id,'')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date,'')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS null_count FROM historical_term_deposit_rates --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT COUNT(*) AS orphan_count FROM latest_home_loan_series l LEFT JOIN (SELECT DISTINCT series_key FROM historical_loan_rates) h ON h.series_key = l.series_key WHERE h.series_key IS NULL --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT COUNT(*) AS orphan_count FROM latest_savings_series l LEFT JOIN (SELECT DISTINCT series_key FROM historical_savings_rates) h ON h.series_key = l.series_key WHERE h.series_key IS NULL --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command SELECT COUNT(*) AS orphan_count FROM latest_td_series l LEFT JOIN (SELECT DISTINCT series_key FROM historical_term_deposit_rates) h ON h.series_key = l.series_key WHERE h.series_key IS NULL --json` (exit 0)
- `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js wrangler d1 execute australianrates_api --remote --command WITH dataset_latest AS ( SELECT 'home_loans' AS dataset, MAX(collection_date) AS global_latest, MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest FROM historical_loan_rates UNION ALL SELECT 'savings', MAX(collection_date), MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) FROM historical_savings_rates UNION ALL SELECT 'term_deposits', MAX(collection_date), MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) FROM historical_term_deposit_rates ) SELECT dataset, global_latest, scheduled_latest, CASE WHEN global_latest IS NULL OR scheduled_latest IS NULL THEN NULL WHEN global_latest = scheduled_latest THEN 0 ELSE 1 END AS latest_global_mismatch FROM dataset_latest ORDER BY dataset --json` (exit 0)