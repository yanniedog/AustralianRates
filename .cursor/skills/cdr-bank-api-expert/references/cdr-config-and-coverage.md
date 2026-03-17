# CDR config schema and coverage gap reference

## lenders.json (LenderConfig)

- **code**: Unique lender code (e.g. `cba`, `westpac`, `nab`). Must match playbook key in `lender-playbooks.ts`.
- **name**: Short display name (e.g. `CBA`, `Westpac`).
- **canonical_bank_name**: Full legal/canonical name (e.g. `Commonwealth Bank of Australia`). Used in brand matching and display.
- **register_brand_name**: Name as it appears in the CDR register (e.g. `Commonwealth Bank of Australia`, `Westpac`). Used by `discovery.ts` to match register brands; must align with register or discovery may pick wrong brand/endpoint.
- **products_endpoint**: Primary CDR products URL: `https://<host>/cds-au/v1/banking/products`. Required for reliable ingest when register is slow or brand match fails.
- **additional_products_endpoints**: Optional list of alternate product API URLs (e.g. Great Southern Bank has two hosts). All are tried via `candidateProductEndpoints`.
- **seed_rate_urls**: URLs for fallback/scraping or documentation; not used for CDR product discovery.

## LenderPlaybook (lender-playbooks.ts)

- **code**: Must match `LenderConfig.code`.
- **cdrVersions**: Ordered list of CDR API versions to try (e.g. `[3, 4, 5, 6, 2, 1]`). Used by `fetchCdrJson` when calling bank APIs.
- **minRatePercent** / **maxRatePercent**: Valid rate range; rows outside are dropped. Typical 0.5–20.
- **dailyMinConfidence** / **historicalMinConfidence**: Minimum confidence for daily vs historical; rows below are dropped.
- **includeKeywords** / **excludeKeywords**: Applied to product/detail text. Over-restrictive includes can yield zero accepted rows; broad excludes (disclaimer, LVR, etc.) are in COMMON_EXCLUDE.

## Discovery (cdr/discovery.ts)

- Register URLs: `api.cdr.gov.au/cdr-register/v1/...` (all/data-holders/brands/summary, banking/data-holders/brands, banking/register).
- `extractBrands` builds `RegisterBrand[]` (brandName, legalEntityName, endpointUrl). Endpoint is normalized to `/cds-au/v1/banking/products`.
- `selectBestMatchingBrand(lender, brands)` uses `brandMatchScore` (name tokens) plus `hostAffinityScore` (configured vs discovered host). Prefer setting `products_endpoint` in lenders.json so ingest does not depend solely on register.
- `discoverProductsEndpoint(lender)` tries register first, then `configuredProductEndpoints(lender)` from lenders.json.

## Coverage gap reasons (lender-dataset-invariants)

| Reason | Meaning |
|--------|--------|
| index_fetch_not_succeeded | Product index fetch for this lender/dataset failed. Check endpoint, network, CDR versions. |
| lineage_errors_present | Some detail fetches have lineage errors. Check detail URLs and fetch_event linkage. |
| failed_detail_fetches_present | One or more product detail fetches failed. Check detail endpoint and response shape. |
| detail_processing_incomplete | completed_detail_count + failed_detail_count < expected_detail_count. Some details never processed. |
| zero_written_rows_for_nonzero_expected_details | No rows written despite expected details. Parsing or validation may be dropping all rows. |
| zero_accepted_rows_for_nonzero_expected_details | No rows passed playbook/validation. Check keywords, rate range, confidence. |
| detail_fetch_events_missing | expected_detail_count > 0 but no detail fetch events. Index or detail queue path issue. |
| dataset_not_finalized | Run not finalized (warn only if it is the only reason). |

## No-gaps checklist

1. **Endpoint**: Bank has a working `products_endpoint` (and `additional_products_endpoints` if needed). URL returns CDR JSON (data array, possible next link).
2. **Register names**: `register_brand_name` and `canonical_bank_name` match or closely match CDR register so discovery fallback resolves.
3. **Playbook**: Playbook exists for lender `code`; `cdrVersions` includes versions the bank supports; keywords and rate/confidence bounds do not exclude all products.
4. **No truncation**: No cap on products per lender or pages that drops scope (see hard-limits-registry.json). Pagination uses continuation state if bounded.
5. **Coverage audit**: For the target collection date, coverage gap audit shows no errors (or only dataset_not_finalized warns). Run via admin or `runCoverageGapAudit`.
6. **CDR audit**: Pipeline audit passes (retrieved, processed, stored, archived, tracked). Fix missing raw objects, fetch_event links, series_key, and presence tracking as needed.
7. **Data quality flag**: Ingest path sets `data_quality_flag` to `cdr_live` (or equivalent) for live CDR so public/analytics views show CDR data.

## RBA data (cash rate and inflation)

- **Cash rate**: Ingest `workers/api/src/ingest/rba.ts`; DB `workers/api/src/db/rba-cash-rate.ts`; table `rba_cash_rates`. Collected in same daily run as banks via `bootstrap-jobs.ts`. Backfill: `backfillRbaCashRatesForDateRange`; admin POST `/admin/rba/backfill`.
- **Headline inflation + one other key inflation metric**: Must be obtained at the same frequency as bank collection and stored reliably. If not yet implemented, add tables and ingest (e.g. from RBA statistics or ABS CPI) and schedule with the daily run. See [all-banks-and-rba.md](all-banks-and-rba.md).

## Lender-specific notes

- **Bendigo & Adelaide**: Product detail has been observed returning 400, 406, and 500 for some products. 400/406 are treated as non-retryable. For 406, if the response body does not include "Versions available:", the pipeline logs `cdr_406_no_versions_advertised` with a body snippet. Check admin actionable logs (`detail_fetch_failed`) and coverage-gap report; verify product IDs are still offered by the bank.

## Key files (ingest and pipeline)

- **Index/detail fetch**: `workers/api/src/ingest/cdr/http.ts` (`fetchCdrJson`), `mortgage-fetch.ts`, `cdr-savings.ts` (product list + detail).
- **Discovery**: `workers/api/src/ingest/cdr/discovery.ts` (`discoverProductsEndpoint`, `extractProducts`, `nextLink`).
- **Product endpoints**: `workers/api/src/ingest/product-endpoints.ts` (`configuredProductEndpoints`, `candidateProductEndpoints`).
- **Coverage**: `workers/api/src/pipeline/coverage-gap-audit.ts`, `coverage-gap-remediation.ts`, `workers/api/src/db/lender-dataset-status.ts`, `workers/api/src/utils/lender-dataset-invariants.ts`.
- **CDR audit**: `workers/api/src/pipeline/cdr-audit.ts`; admin route `/admin/cdr-audit` and POST `/admin/cdr-audit/run`.
- **RBA**: `workers/api/src/ingest/rba.ts`, `workers/api/src/db/rba-cash-rate.ts`; daily run in `workers/api/src/pipeline/bootstrap-jobs.ts`.
