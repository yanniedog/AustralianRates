# Production Coverage Audit

- Generated at: `2026-03-15T02:26:24.148Z`
- Target DB: `australianrates_api`

## Recommendation

- Do not wipe the database. Continue from the current baseline starting on 2026-02-26.
- Do not describe the current data as deep historical coverage; it is a recent baseline with known lender/day gaps.
- Clean overlap days first, especially 2026-03-09 across all datasets and 2026-03-05 for term deposits.
- Prioritize recurring lender gaps over wholesale resets, especially UBank in home loans and savings and Great Southern Bank in home loans.
- Treat zero-row days as system coverage gaps that should be visible in ops dashboards.

## Canonical Rule Set

- Default canonical source is scheduled.
- If scheduled and manual rows share the same series_key and collection_date and have identical normalized state, keep scheduled and archive/delete manual.
- If a series_key plus collection_date exists only in manual, keep it until a scheduled replacement exists.
- If scheduled and manual disagree on normalized state for the same series_key and collection_date, do not auto-delete either row.
- Never dedupe across different collection_date or different series_key values.

## Dataset Summary

| Dataset | Rows | Dates | First date | Last date | Distinct series | Distinct products |
| --- | --- | --- | --- | --- | --- | --- |
| home_loans | 11870 | 16 | 2026-02-26 | 2026-03-15 | 1110 | 312 |
| savings | 6762 | 13 | 2026-02-26 | 2026-03-15 | 483 | 151 |
| term_deposits | 21498 | 17 | 2026-02-26 | 2026-03-15 | 1786 | 73 |

## Coverage State

| Dataset | First coverage | Cursor | Status | Empty streak | Last tick status | Last tick message |
| --- | --- | --- | --- | --- | --- | --- |
| mortgage | 2026-02-26 | 2023-11-17 | active | 826 | completed_empty | run_status=completed rows=0 |
| savings | 2026-02-26 | 2023-11-18 | active | 821 | completed_empty | run_status=completed rows=0 |
| term_deposits | 2026-02-26 | 2023-11-17 | active | 820 | completed_empty | run_status=completed rows=0 |

## Overlap Summary

| Dataset | Overlapping series-dates | Conflicting series-dates |
| --- | --- | --- |
| home_loans | 1645 | 207 |
| savings | 1166 | 237 |
| term_deposits | 4206 | 88 |

## Home loans

| Metric | Value |
| --- | --- |
| Total banks | 16 |
| Dates in range | 18 |
| Observed dates | 16 |
| Full coverage dates | 2026-03-09 |
| Empty dates | 2026-02-28, 2026-03-01 |
| Always missing on observed days | - |

### Date Coverage

| Date | Status | Banks | Missing | Missing banks | Rows | Series | Exact dupes | Conflicts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-02-26 | partial | 13/16 | 3 | AMP Bank, Great Southern Bank, UBank | 616 | 308 | 308 | 0 |
| 2026-02-27 | partial | 13/16 | 3 | AMP Bank, Great Southern Bank, UBank | 307 | 307 | 0 | 0 |
| 2026-02-28 | empty | 0/16 | 16 | AMP Bank, ANZ, Bank of Melbourne, Bank of Queensland, Bankwest, Bendigo and Adelaide Bank, Commonwealth Bank of Australia, Great Southern Bank, HSBC Australia, ING, Macquarie Bank, National Australia Bank, St. George Bank, Suncorp Bank, UBank, Westpac Banking Corporation | 0 | 0 | 0 | 0 |
| 2026-03-01 | empty | 0/16 | 16 | AMP Bank, ANZ, Bank of Melbourne, Bank of Queensland, Bankwest, Bendigo and Adelaide Bank, Commonwealth Bank of Australia, Great Southern Bank, HSBC Australia, ING, Macquarie Bank, National Australia Bank, St. George Bank, Suncorp Bank, UBank, Westpac Banking Corporation | 0 | 0 | 0 | 0 |
| 2026-03-02 | partial | 11/16 | 5 | AMP Bank, Commonwealth Bank of Australia, Great Southern Bank, ING, UBank | 313 | 313 | 0 | 0 |
| 2026-03-03 | partial | 11/16 | 5 | AMP Bank, Commonwealth Bank of Australia, Great Southern Bank, ING, UBank | 313 | 313 | 0 | 0 |
| 2026-03-04 | partial | 11/16 | 5 | AMP Bank, Commonwealth Bank of Australia, Great Southern Bank, ING, UBank | 313 | 313 | 0 | 0 |
| 2026-03-05 | partial | 13/16 | 3 | AMP Bank, Great Southern Bank, UBank | 716 | 403 | 313 | 0 |
| 2026-03-06 | partial | 13/16 | 3 | AMP Bank, Great Southern Bank, UBank | 400 | 400 | 0 | 0 |
| 2026-03-07 | partial | 13/16 | 3 | AMP Bank, Great Southern Bank, UBank | 800 | 400 | 400 | 0 |
| 2026-03-08 | partial | 13/16 | 3 | AMP Bank, Great Southern Bank, UBank | 400 | 400 | 0 | 0 |
| 2026-03-09 | full | 16/16 | 0 | - | 1730 | 1106 | 417 | 207 |
| 2026-03-10 | partial | 15/16 | 1 | UBank | 1042 | 1042 | 0 | 0 |
| 2026-03-11 | partial | 15/16 | 1 | UBank | 1042 | 1042 | 0 | 0 |
| 2026-03-12 | partial | 15/16 | 1 | UBank | 1042 | 1042 | 0 | 0 |
| 2026-03-13 | partial | 15/16 | 1 | UBank | 1042 | 1042 | 0 | 0 |
| 2026-03-14 | partial | 14/16 | 2 | Great Southern Bank, UBank | 897 | 897 | 0 | 0 |
| 2026-03-15 | partial | 14/16 | 2 | Great Southern Bank, UBank | 897 | 897 | 0 | 0 |

### Recurring Gap Banks

| Bank | Missing observed dates | Observed dates | Missing ratio | Missing dates |
| --- | --- | --- | --- | --- |
| UBank | 15 | 16 | 0.9375 | 2026-02-26, 2026-02-27, 2026-03-02, 2026-03-03, 2026-03-04, 2026-03-05, 2026-03-06, 2026-03-07, 2026-03-08, 2026-03-10, 2026-03-11, 2026-03-12, 2026-03-13, 2026-03-14, 2026-03-15 |
| Great Southern Bank | 11 | 16 | 0.6875 | 2026-02-26, 2026-02-27, 2026-03-02, 2026-03-03, 2026-03-04, 2026-03-05, 2026-03-06, 2026-03-07, 2026-03-08, 2026-03-14, 2026-03-15 |
| AMP Bank | 9 | 16 | 0.5625 | 2026-02-26, 2026-02-27, 2026-03-02, 2026-03-03, 2026-03-04, 2026-03-05, 2026-03-06, 2026-03-07, 2026-03-08 |
| Commonwealth Bank of Australia | 3 | 16 | 0.1875 | 2026-03-02, 2026-03-03, 2026-03-04 |
| ING | 3 | 16 | 0.1875 | 2026-03-02, 2026-03-03, 2026-03-04 |

## Savings

| Metric | Value |
| --- | --- |
| Total banks | 16 |
| Dates in range | 18 |
| Observed dates | 13 |
| Full coverage dates | 2026-03-09 |
| Empty dates | 2026-02-28, 2026-03-01, 2026-03-02, 2026-03-03, 2026-03-04 |
| Always missing on observed days | - |

### Date Coverage

| Date | Status | Banks | Missing | Missing banks | Rows | Series | Exact dupes | Conflicts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-02-26 | partial | 14/16 | 2 | ING, UBank | 524 | 262 | 262 | 0 |
| 2026-02-27 | partial | 14/16 | 2 | ING, UBank | 262 | 262 | 0 | 0 |
| 2026-02-28 | empty | 0/16 | 16 | AMP Bank, ANZ, Bank of Melbourne, Bank of Queensland, Bankwest, Bendigo and Adelaide Bank, Commonwealth Bank of Australia, Great Southern Bank, HSBC Australia, ING, Macquarie Bank, National Australia Bank, St. George Bank, Suncorp Bank, UBank, Westpac Banking Corporation | 0 | 0 | 0 | 0 |
| 2026-03-01 | empty | 0/16 | 16 | AMP Bank, ANZ, Bank of Melbourne, Bank of Queensland, Bankwest, Bendigo and Adelaide Bank, Commonwealth Bank of Australia, Great Southern Bank, HSBC Australia, ING, Macquarie Bank, National Australia Bank, St. George Bank, Suncorp Bank, UBank, Westpac Banking Corporation | 0 | 0 | 0 | 0 |
| 2026-03-02 | empty | 0/16 | 16 | AMP Bank, ANZ, Bank of Melbourne, Bank of Queensland, Bankwest, Bendigo and Adelaide Bank, Commonwealth Bank of Australia, Great Southern Bank, HSBC Australia, ING, Macquarie Bank, National Australia Bank, St. George Bank, Suncorp Bank, UBank, Westpac Banking Corporation | 0 | 0 | 0 | 0 |
| 2026-03-03 | empty | 0/16 | 16 | AMP Bank, ANZ, Bank of Melbourne, Bank of Queensland, Bankwest, Bendigo and Adelaide Bank, Commonwealth Bank of Australia, Great Southern Bank, HSBC Australia, ING, Macquarie Bank, National Australia Bank, St. George Bank, Suncorp Bank, UBank, Westpac Banking Corporation | 0 | 0 | 0 | 0 |
| 2026-03-04 | empty | 0/16 | 16 | AMP Bank, ANZ, Bank of Melbourne, Bank of Queensland, Bankwest, Bendigo and Adelaide Bank, Commonwealth Bank of Australia, Great Southern Bank, HSBC Australia, ING, Macquarie Bank, National Australia Bank, St. George Bank, Suncorp Bank, UBank, Westpac Banking Corporation | 0 | 0 | 0 | 0 |
| 2026-03-05 | partial | 15/16 | 1 | UBank | 444 | 444 | 0 | 0 |
| 2026-03-06 | partial | 15/16 | 1 | UBank | 452 | 452 | 0 | 0 |
| 2026-03-07 | partial | 15/16 | 1 | UBank | 904 | 452 | 452 | 0 |
| 2026-03-08 | partial | 15/16 | 1 | UBank | 452 | 452 | 0 | 0 |
| 2026-03-09 | full | 16/16 | 0 | - | 932 | 480 | 215 | 237 |
| 2026-03-10 | partial | 15/16 | 1 | UBank | 470 | 470 | 0 | 0 |
| 2026-03-11 | partial | 15/16 | 1 | UBank | 470 | 470 | 0 | 0 |
| 2026-03-12 | partial | 15/16 | 1 | UBank | 470 | 470 | 0 | 0 |
| 2026-03-13 | partial | 15/16 | 1 | UBank | 469 | 469 | 0 | 0 |
| 2026-03-14 | partial | 15/16 | 1 | UBank | 449 | 449 | 0 | 0 |
| 2026-03-15 | partial | 15/16 | 1 | UBank | 464 | 464 | 0 | 0 |

### Recurring Gap Banks

| Bank | Missing observed dates | Observed dates | Missing ratio | Missing dates |
| --- | --- | --- | --- | --- |
| UBank | 12 | 13 | 0.9231 | 2026-02-26, 2026-02-27, 2026-03-05, 2026-03-06, 2026-03-07, 2026-03-08, 2026-03-10, 2026-03-11, 2026-03-12, 2026-03-13, 2026-03-14, 2026-03-15 |
| ING | 2 | 13 | 0.1538 | 2026-02-26, 2026-02-27 |

## Term deposits

| Metric | Value |
| --- | --- |
| Total banks | 15 |
| Dates in range | 18 |
| Observed dates | 17 |
| Full coverage dates | 2026-03-05, 2026-03-06, 2026-03-07, 2026-03-08, 2026-03-09, 2026-03-10, 2026-03-11, 2026-03-12, 2026-03-13, 2026-03-14, 2026-03-15 |
| Empty dates | 2026-02-28 |
| Always missing on observed days | - |

### Date Coverage

| Date | Status | Banks | Missing | Missing banks | Rows | Series | Exact dupes | Conflicts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-02-26 | partial | 13/15 | 2 | HSBC Australia, ING | 1612 | 806 | 806 | 0 |
| 2026-02-27 | partial | 13/15 | 2 | HSBC Australia, ING | 806 | 806 | 0 | 0 |
| 2026-02-28 | empty | 0/15 | 15 | AMP Bank, ANZ, Bank of Melbourne, Bank of Queensland, Bankwest, Bendigo and Adelaide Bank, Commonwealth Bank of Australia, Great Southern Bank, HSBC Australia, ING, Macquarie Bank, National Australia Bank, St. George Bank, Suncorp Bank, Westpac Banking Corporation | 0 | 0 | 0 | 0 |
| 2026-03-01 | partial | 14/15 | 1 | Commonwealth Bank of Australia | 1536 | 768 | 768 | 0 |
| 2026-03-02 | partial | 14/15 | 1 | Commonwealth Bank of Australia | 768 | 768 | 0 | 0 |
| 2026-03-03 | partial | 14/15 | 1 | Commonwealth Bank of Australia | 766 | 766 | 0 | 0 |
| 2026-03-04 | partial | 14/15 | 1 | Commonwealth Bank of Australia | 768 | 768 | 0 | 0 |
| 2026-03-05 | full | 15/15 | 0 | - | 1703 | 941 | 756 | 6 |
| 2026-03-06 | full | 15/15 | 0 | - | 934 | 934 | 0 | 0 |
| 2026-03-07 | full | 15/15 | 0 | - | 1870 | 935 | 935 | 0 |
| 2026-03-08 | full | 15/15 | 0 | - | 935 | 935 | 0 | 0 |
| 2026-03-09 | full | 15/15 | 0 | - | 2557 | 1622 | 853 | 82 |
| 2026-03-10 | full | 15/15 | 0 | - | 1210 | 1210 | 0 | 0 |
| 2026-03-11 | full | 15/15 | 0 | - | 1212 | 1212 | 0 | 0 |
| 2026-03-12 | full | 15/15 | 0 | - | 1212 | 1212 | 0 | 0 |
| 2026-03-13 | full | 15/15 | 0 | - | 1242 | 1242 | 0 | 0 |
| 2026-03-14 | full | 15/15 | 0 | - | 1182 | 1182 | 0 | 0 |
| 2026-03-15 | full | 15/15 | 0 | - | 1185 | 1185 | 0 | 0 |

### Recurring Gap Banks

| Bank | Missing observed dates | Observed dates | Missing ratio | Missing dates |
| --- | --- | --- | --- | --- |
| Commonwealth Bank of Australia | 4 | 17 | 0.2353 | 2026-03-01, 2026-03-02, 2026-03-03, 2026-03-04 |
| HSBC Australia | 2 | 17 | 0.1176 | 2026-02-26, 2026-02-27 |
| ING | 2 | 17 | 0.1176 | 2026-02-26, 2026-02-27 |

## Legacy Residue

| Source type | Orphan rows |
| --- | --- |
| wayback_html | 3060 |
| cdr_products | 328 |
| cdr_product_detail | 326 |

## SQL Pack

### coverage_over_time_template

```sql
SELECT collection_date, bank_name, COUNT(*) AS row_count, COUNT(DISTINCT series_key) AS series_count
FROM {{table}}
GROUP BY collection_date, bank_name
ORDER BY collection_date, bank_name;
```

### conflict_review_template

```sql
SELECT series_key, collection_date, COALESCE(run_source, 'scheduled') AS run_source
FROM {{table}}
WHERE series_key = ? AND collection_date = ?
ORDER BY run_source, parsed_at;
```

### lender_gap_dashboard_template

```sql
SELECT collection_date, bank_name, COUNT(*) AS row_count, COUNT(DISTINCT series_key) AS series_count
FROM {{table}}
GROUP BY collection_date, bank_name
ORDER BY collection_date DESC, bank_name ASC;
```

### home_loans_safe_exact_duplicate_candidates

```sql
WITH grouped AS (
  SELECT
    series_key,
    collection_date,
    COUNT(DISTINCT COALESCE(run_source, 'scheduled')) AS sources,
    COUNT(DISTINCT printf('%s|%s|%s', COALESCE(interest_rate,''), COALESCE(comparison_rate,''), COALESCE(annual_fee,''))) AS states
  FROM historical_loan_rates
  GROUP BY series_key, collection_date
)
SELECT series_key, collection_date
FROM grouped
WHERE sources > 1
  AND states = 1
ORDER BY collection_date, series_key;
```

### savings_safe_exact_duplicate_candidates

```sql
WITH grouped AS (
  SELECT
    series_key,
    collection_date,
    COUNT(DISTINCT COALESCE(run_source, 'scheduled')) AS sources,
    COUNT(DISTINCT printf('%s|%s|%s|%s|%s', COALESCE(interest_rate,''), COALESCE(min_balance,''), COALESCE(max_balance,''), COALESCE(monthly_fee,''), COALESCE(conditions,''))) AS states
  FROM historical_savings_rates
  GROUP BY series_key, collection_date
)
SELECT series_key, collection_date
FROM grouped
WHERE sources > 1
  AND states = 1
ORDER BY collection_date, series_key;
```

### term_deposits_safe_exact_duplicate_candidates

```sql
WITH grouped AS (
  SELECT
    series_key,
    collection_date,
    COUNT(DISTINCT COALESCE(run_source, 'scheduled')) AS sources,
    COUNT(DISTINCT printf('%s|%s|%s', COALESCE(interest_rate,''), COALESCE(min_deposit,''), COALESCE(max_deposit,''))) AS states
  FROM historical_term_deposit_rates
  GROUP BY series_key, collection_date
)
SELECT series_key, collection_date
FROM grouped
WHERE sources > 1
  AND states = 1
ORDER BY collection_date, series_key;
```
