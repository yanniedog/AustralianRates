# CDR Throttling Investigation Report (2026-04-28)

## Scope
- Investigate whether CDR providers are currently throttling or slowing ingestion.
- Use read-only production evidence only.
- Do not change retry/backoff/concurrency behavior in this pass.

## Evidence Collected

### 1) Fresh production logs (required fresh pull)
- Command:
  - `node fetch-production-logs.js --stats --actionable --errors --limit=300 --since=2026-04-27T00:00:00Z`
  - `node fetch-production-logs.js --warn --limit=400 --since=2026-04-27T00:00:00Z`
- Key signals observed:
  - CDR warnings include `cdr_406_no_versions_advertised` for Macquarie endpoint version negotiation.
  - `detail_fetch_failed ... status=406` appears for one Macquarie savings product.
  - No CDR `429` or CDR `5xx` entries found in the fetched CDR-related warning/error sample.
  - Non-CDR issues are present (D1 CPU limits, queue duplicate claim warnings, public analytics slow warnings).

### 2) Recent CDR fetch-event status distribution
- Endpoint queried:
  - `GET /api/home-loan-rates/admin/diagnostics/fetch-events?source_type_prefix=cdr_&limit=1000`
- Aggregated results:
  - Total CDR fetch events sampled: `1000`
  - HTTP `200`: `999`
  - HTTP `406`: `1`
  - Non-2xx: `1` total (`0.1%`)
  - Non-2xx sample:
    - `macquarie`, dataset `savings`, source `cdr_product_detail`, status `406`, product `BB001MBLTXN001`
- Interpretation:
  - The sampled window does not show broad upstream throttling behavior (no systemic 429/503/504 patterns).
  - The only notable non-2xx is a version/support mismatch (`406`), which is contract/protocol related, not rate limiting.

### 3) Cached status bundle / CDR diagnostics
- Command:
  - `node fetch-status-debug-bundle.js --sections=cdr,integrity_pulse --log-limit=200`
- Result:
  - `cdr_audit.report` is null in this response snapshot (no persisted CDR report materialized in this call).
  - No contradictory evidence indicating active provider throttling.

## Assessment
- **Conclusion:** No current evidence of widespread CDR provider throttling/slowing in the sampled production window.
- **Primary issues observed instead:**
  - Provider/version compatibility failures (`406`) for specific Macquarie paths.
  - Internal platform bottlenecks/noise (D1 CPU limit resets, queue duplicate-claim retries).
- **Confidence level:** Medium-high for the sampled period (last 1000 CDR fetch events + fresh logs since 2026-04-27T00:00:00Z).

## Recommended Next Read-Only Follow-Up
- Continue collecting the same read-only evidence over a longer rolling window before changing behavior:
  - Keep `fetch-events` status aggregation by lender and source type.
  - Track explicit `429` / `503` / `504` trendlines by lender daily.
  - Separate contract failures (`406`) from potential throttling to avoid false positives.
