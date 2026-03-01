# Test fixtures – real data only

All fixtures in this directory must be **real data**: exported from production, captured from a real ingest run, or from the specified external data sources. Do not add hand-crafted or mock data.

- **real-normalized-home-loan-row.json** – One valid normalized home loan row (e.g. from CDR ingest or production export). Used by normalize-quality tests.
- **real-normalized-savings-row.json** – One valid normalized savings row. Used by normalize-savings tests.
- **real-normalized-td-row.json** – One valid normalized term-deposit row. Used by normalize-savings tests.
- **real-lender-rate-page-no-rates.html** – Real lender page HTML where the parser should find no rate rows (e.g. LVR/disclaimer content). Capture from lender seed_rate_urls.
- **real-lender-rate-page-with-rates.html** – Real lender page HTML where the parser should find at least one home-loan rate. Capture from lender seed_rate_urls.

To refresh fixtures from production or a real run, use your project’s export/ingest tooling and save the output here.
