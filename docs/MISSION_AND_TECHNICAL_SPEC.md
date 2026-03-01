# AustralianRates Mission and Technical Spec

## Mission

AustralianRates exists to collect, normalize, store, and publish comparable Australian rate data for home loans, savings accounts, and term deposits. The system provides transparent public APIs and a trusted admin control plane so operators can verify data freshness, diagnose failures, and keep historical continuity without manual spreadsheet workflows.

## Product Objective

- Publish reliable, queryable rate data for the three supported datasets.
- Keep scheduled ingestion operating with visible status and failure diagnostics.
- Preserve longitudinal continuity so a single product can be tracked over time.
- Expose data through stable public endpoints and downloadable exports.

## Project Philosophy: Real Data Only

Tests and tooling in this project must not rely on mock or simulated data. This is both a quality stance and an enforcement rule.

- **Why:** Tests that use fake rows, stubbed APIs, or in-memory fake databases validate behavior against an artificial world. They can pass while production fails on real shapes, real APIs, and real persistence. We want tests to reflect reality so that passing tests mean the system works with real data.
- **Principle:** All test data must be real. Use real D1 (e.g. via vitest-pool-workers with migrations), real API responses, or fixture files captured from production or real ingest runs. Pure unit tests that only use literal inputs (e.g. parsing a string) are acceptable; anything that looks like business data must come from a real source.
- **Rule:** No mock or simulated data in tests. No fake D1, no vi.mock with fake business data, no stub fetch returning fake JSON. Tests that need real bindings may be skipped until run in an integration environment, but must not be implemented with mocks.

See AGENTS.md (Test Data) and `.cursor/rules/no-mock-test-data.mdc` for the concrete rule and implementation guidance.

## Core Invariants

- **Canonical longitudinal identity:** `product_key` is the canonical identity for longitudinal tracking. For home loans it is `bank_name|product_id|security_purpose|repayment_type|lvr_tier|rate_structure`.
- **Dataset-scoped product identity:** Savings and term-deposit datasets use dataset-specific product keys defined by schema migrations and query views.
- **Collection date semantics:** `collection_date` represents Melbourne-date collection semantics, not arbitrary client-local dates.
- **Run source semantics:** `run_source` is always one of `scheduled` or `manual`.
- **Public API truth source:** Public responses are derived from persisted D1 data, not synthetic mock payloads.
- **Operational visibility:** Problem states must be logged with enough context to map to actionable admin guidance.
- **Real data in tests:** No mock or simulated data in tests; see "Project Philosophy: Real Data Only" above.

## Data Model Intent

- `historical_loan_rates`, `historical_savings_rates`, and `historical_term_deposit_rates` store normalized historical rows.
- `run_reports` tracks daily and backfill run lifecycle and per-lender outcome summaries.
- `global_log` stores operational log entries for diagnostics and admin troubleshooting.
- Coverage and anomaly tables (`dataset_coverage_progress`, `ingest_anomalies`, and related status tables) support integrity and progress checks.

## End-to-End Pipeline Objective

The backend process is considered healthy when this path is functioning:

1. Scheduler triggers the expected cron path.
2. Pipeline enqueues and processes work through queue consumer flow.
3. Run reports transition cleanly (`running` to `ok`/`partial`/`failed`) with meaningful diagnostics.
4. Public APIs serve recent data aligned with latest collection date expectations.

Backfill and historical pull paths are extensions of this core flow and must not regress daily scheduled reliability.

## E2E Alignment Success Criteria

E2E alignment is true only when all criteria pass:

1. **Scheduler recency:** Evidence of a recent daily scheduler execution (for example, within 25 hours).
2. **Run progress sanity:** No stale run is stuck in `running` beyond threshold (for example, 2 hours).
3. **Public data availability:** Public dataset endpoints return recent data for the target/latest collection date.

If any criterion fails, E2E is not aligned and must return a stable reason code.

## Operational Logging Contract

- Operational problems should be expressed with stable identifiers (reason/code) so raw logs can be translated into actionable guidance.
- Error and warning logs should include context identifiers where available (`run_id`, `lender_code`, and concise machine-readable context details).
- Logging must support admin dashboards that summarize issue type, frequency, latest occurrence, and recommended next action.

## Scope Boundaries

This system is not a financial-advice engine and does not provide individualized recommendations. It is a data collection, normalization, storage, and publication platform for supported Australian rate products.

## Development Alignment Rule

Any behavior change should be checked against this document before implementation is considered complete.

- If a proposed change does not align with this mission and invariants, pause and resolve alignment with the developer.
- If the mission itself needs to evolve, update this document first and confirm the new objective before broad implementation changes.
