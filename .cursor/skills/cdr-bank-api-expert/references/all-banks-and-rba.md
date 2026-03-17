# All banks and RBA data reference

## All banks (lenders.json)

The canonical list lives in `workers/api/config/lenders.json`. Each lender must have a matching playbook in `workers/api/src/ingest/lender-playbooks.ts` (by `code`). As of the last sync:

| code | name | products_endpoint host (primary) |
|------|------|----------------------------------|
| cba | CBA | api.commbank.com.au |
| westpac | Westpac | digital-api.westpac.com.au |
| nab | NAB | openbank.api.nab.com.au |
| anz | ANZ | api.anz |
| macquarie | Macquarie | api.macquariebank.io |
| bendigo_adelaide | Bendigo & Adelaide | api.cdr.bendigobank.com.au |
| suncorp | Suncorp | id-ob.suncorpbank.com.au |
| bankwest | Bankwest | open-api.bankwest.com.au |
| ing | ING | id.ob.ing.com.au |
| amp | AMP | pub.cdr-sme.amp.com.au |
| hsbc | HSBC | public.ob.hsbc.com.au |
| ubank | UBank | public.cdr-api.86400.com.au |
| stgeorge | St. George | digital-api.stgeorge.com.au |
| bankofmelbourne | Bank of Melbourne | digital-api.bankofmelbourne.com.au |
| boq | BOQ | api.cds.boq.com.au |
| great_southern | Great Southern Bank | api.open-banking.greatsouthernbank.com.au (+ additional_products_endpoints) |

Ensure **full coverage**: every bank above is included in daily runs for each dataset (home_loans, savings, term_deposits) where the bank offers products. No bank should be dropped from config without explicit reason; adding a new data-holder bank requires a new entry in lenders.json and a playbook.

---

## CDR API protocols

- **CDR Register**: `https://api.cdr.gov.au/cdr-register/v1/` — banking data-holders, brands, endpoints. Discovery uses `/all/data-holders/brands/summary`, `/banking/data-holders/brands`, `/banking/register`.
- **Banking product list**: Path `/cds-au/v1/banking/products`. Optional pagination via `next` link in response. All banks implement this under CDS AU.
- **Standards**: Consumer Data Standards (Australia) — [Consumer Data Standards](https://github.com/ConsumerDataStandardsAustralia/standards). Banking APIs: product reference data (index + product detail). Version negotiation via `x-v` header; repo tries versions in playbook order (e.g. 3, 4, 5, 6, 2, 1).
- **Product detail**: `/cds-au/v1/banking/products/{productId}`. Response shape varies by product category (e.g. residential mortgage vs deposit). Parsing in `mortgage-parse.ts` (home loans) and `cdr-savings.ts` (savings/term deposits).

When configuring a bank, verify its public product API base URL and any version quirks; ensure `register_brand_name` matches the CDR register so discovery fallback works.

---

## RBA data: cash rate and inflation

### Required RBA metrics

1. **RBA cash rate** — implemented.
2. **Headline inflation rate** — required; to be obtained at same frequency as bank data and stored in DB.
3. **One other key inflation metric** — required (e.g. trimmed mean CPI, or other RBA/ABS measure); same frequency and storage.

### Current implementation (cash rate only)

- **Source**: `https://www.rba.gov.au/statistics/tables/csv/f1-data.csv` (RBA F1 table CSV).
- **Ingest**: `workers/api/src/ingest/rba.ts` — `collectRbaCashRateForDate(db, collectionDate, env)`. Parses CSV to date + cash rate; upserts for the given collection date using latest effective rate on or before that date.
- **Storage**: Table `rba_cash_rates` (migration `0002_rba_cash_rates.sql`): `collection_date`, `cash_rate`, `effective_date`, `source_url`, `fetched_at`.
- **Frequency**: Collected at the start of each daily run in `workers/api/src/pipeline/bootstrap-jobs.ts` (same run that triggers bank CDR collection for the Melbourne collection date).
- **Backfill**: `backfillRbaCashRatesForDateRange(db, startDate, endDate, env)`; admin POST `/api/home-loan-rates/admin/rba/backfill` with body `startDate`, `endDate`.

### Inflation (to be added or verified)

- **Headline inflation**: Typically year-ended CPI (e.g. RBA “Measures of Consumer Price Inflation” or ABS CPI). Must be fetched at same cadence as daily run and stored in DB (new table or existing if present).
- **Other key inflation metric**: e.g. trimmed mean CPI, or RBA’s preferred measure; same cadence and storage.
- **Reliable storage**: Use upsert-by-date (or equivalent) so each collection date has at most one row per metric; retain source_url and fetched_at for audit. Backfill endpoint for date ranges if needed.

Ensure RBA data is **not** collected on a different schedule than bank data: it must run as part of (or immediately after) the same daily bootstrap so coverage and “as at” dates stay aligned.
