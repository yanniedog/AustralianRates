# Coverage gaps and CDR audit – operational guide

How coverage-gap and CDR audits work, and how to work through recurring gaps (e.g. UBank, Bendigo, CBA).

---

## Coverage gap audit

- **What it does:** For each daily run and lender/dataset, compares expected vs actual (index fetch, detail fetches, written rows, finalized). Flags rows that fail invariants (e.g. `index_fetch_not_succeeded`, `failed_detail_fetches_present`, `detail_processing_incomplete`, `dataset_not_finalized`).
- **Where:** Admin coverage-gap report; scheduler runs it and logs `coverage_gap_audit_detected_gaps` when there are error-level gaps.
- **Relaxation:** One product short with data (e.g. expected 5, processed 4, written > 0) is treated as acceptable and does not add `detail_processing_incomplete`; severity can stay warn so it does not drive remediation.

### Remediation

- **Replay:** For each error-gap scope (lender + collection_date + datasets), remediation first tries to dispatch from the ingest replay queue (retry failed or incomplete work).
- **Reconcile:** If no replay was dispatched and the scheduled daily run is not already retrying, remediation can trigger a manual daily run for that lender/date/datasets.
- **How to run:** From admin, run coverage-gap audit then run coverage-gap remediation (or let the scheduler do it). Remediation is in `workers/api/src/pipeline/coverage-gap-remediation.ts`.

### Recurring gaps (UBank, Bendigo, CBA)

| Lender | Typical reason | What to do |
|--------|----------------|------------|
| **UBank** | `index_fetch_not_succeeded` | CDR products endpoint may be down or URL changed. Check `lenders.json` `products_endpoint` (e.g. `https://public.cdr-api.86400.com.au/cds-au/v1/banking/products`). Run remediation to retry; if it keeps failing, check CDR register or bank status. |
| **Bendigo** | `failed_detail_fetches_present` | Many product-detail fetches failed (e.g. 400/404/timeout). Remediation replays failed work. If persistent, check playbook keywords and CDR version; consider relaxing confidence or retry policy. |
| **CBA term_deposits** | `detail_processing_incomplete` (expected 5, processed 4) with data written | If written_row_count > 0 and only one product short, this is now treated as acceptable (no error). Run may still show `dataset_not_finalized` (warn) until finalization runs. Remediation or next daily run can finalize. |

---

## CDR pipeline audit

- **What it does:** Runs several checks across stages: retrieved (fetch activity, fetch–raw linkage), processed (anomalies, finalize gaps), stored (fetch_event gaps, series_key gaps), archived, tracked (presence, stale runs).
- **Where:** Admin CDR audit page; run via admin triggers `runCdrPipelineAudit`. Logs `cdr_audit_detected_gaps` when any check fails (2 errors + 1 warn = 3 failed checks in recent runs).
- **Checks:** See `workers/api/src/pipeline/cdr-audit.ts` (e.g. `runRetrievedActivityCheck`, `runProcessedFinalizeGapCheck`, `runTrackedStaleRunsCheck`). Fix in order: discovery/index → detail fetch → parse → write → lineage; then re-run audit.

---

## Retention and pruning

- **run_reports:** Pruned after 180 days (with run_seen_products, run_seen_series, lender_dataset_runs). Reduces “runs with no outputs” count over time. See `workers/api/src/db/retention-prune.ts` and `docs/database-optimization.md`.
- **raw_payloads:** Orphan rows (no matching `raw_objects`) are deleted on each retention run. Legacy backlog is cleared automatically.

---

## References

- Coverage gap: `workers/api/src/pipeline/coverage-gap-audit.ts`, `workers/api/src/db/lender-dataset-status.ts`, `workers/api/src/utils/lender-dataset-invariants.ts`
- Remediation: `workers/api/src/pipeline/coverage-gap-remediation.ts`, admin hardening routes
- CDR audit: `workers/api/src/pipeline/cdr-audit.ts`
- Retention: `workers/api/src/db/retention-prune.ts`, `docs/database-optimization.md`
