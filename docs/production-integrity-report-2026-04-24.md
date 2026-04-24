# Production Database Integrity Report - 2026-04-24

## Summary

Read-only production checks on 2026-04-24 found no evidence of current D1 rate-data corruption. Current health integrity is green, the CDR pipeline audit is green, and the latest data integrity audit is amber only for legacy provenance and economic-series freshness findings. The active reliability gap is coverage for NAB on collection date `2026-04-24`: index fetch failed for `home_loans`, `savings`, and `term_deposits`.

## Production Checks

| Check | Result |
| --- | --- |
| Admin health | `overall_ok=true`, `latest_integrity_ok=true`, checked `2026-04-24T09:15:47.461Z` |
| Status debug bundle | `ok=true`, remediation hints `0`, latest integrity audit `overall_ok=true` |
| CDR audit | `report_ok=true`, generated `2026-04-24T10:23:05.033Z`, checks `10`, failed/errors/warns `0/0/0` |
| Latest integrity audit | `status=amber`, `overall_ok=1`, total `36`, passed `34`, failed `2` |
| Coverage gaps | `collection_date=2026-04-24`, gaps `3`, errors `3`, warns `0` |

## Integrity Findings

| Finding | Count | Assessment |
| --- | ---: | --- |
| Current corruption indicators | `0` | No quarantined rows, key mismatch counts, duplicate counts, or current provenance failures were reported. |
| `economic_stale_status_rows` | `1` | Operational freshness issue for `major_trading_partner_growth_proxy`; not rate-data corruption. |
| `historical_provenance_legacy_unverifiable_rows` | `54,743` | Legacy provenance gap. Current exact/reconstructed provenance remains intact; quarantined rows `0`. |

## Current Coverage Gap

| Lender | Dataset | Reason |
| --- | --- | --- |
| NAB | `home_loans` | `index_fetch_not_succeeded` |
| NAB | `savings` | `index_fetch_not_succeeded` |
| NAB | `term_deposits` | `index_fetch_not_succeeded` |

Live CDR probing confirmed NAB responds with 406 for `x-v: 6` and `x-v: 5`, advertising minimum `3` and maximum `4`; NAB responds successfully with `x-v: 4` and `x-min-v: 4`. The API version probe path now explicitly parses that NAB-style minimum/maximum response and retries version `4`.

## Reliability Controls Added

| Control | Cost profile |
| --- | --- |
| Daily post-ingest assurance report in `app_config` | One compact JSON row, refreshed after public package refresh. |
| Latest collection coverage grouping | Reads latest `lender_dataset_runs` rows only. |
| Product-key mismatch counts | Three latest-date count queries. |
| Raw fetch linkage count | One latest-date count query against `fetch_events`/`raw_objects`. |
| Public package freshness check | KV reads for the expected public snapshot package keys. |
| Hard failure signal | One sampled error when a lender fails index fetch for all three datasets on the latest date. |

## Required Remediation

1. Run targeted daily ingest for lender `nab` and collection date `2026-04-24`, scoped to `home_loans`, `savings`, and `term_deposits`.
2. Confirm coverage gaps for NAB on `2026-04-24` reduce to `0`.
3. Rebuild public snapshot packages.
4. Run post-ingest assurance and confirm `hard_fail_lenders=0`, `product_key_mismatches=0`, `raw_linkage_gaps=0`, and package freshness passes.
