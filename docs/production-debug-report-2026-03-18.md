# Production debug report — 2026-03-18

**Skills used:** elite-debugger, remote-visual-website-testing, data-visualisation.

**Log fetch:** Fresh copy via `node fetch-production-logs.js` (stats + actionable + error/warn stream).

---

## 1. Log triage summary

| Source | Count (approx) | Severity |
|--------|-----------------|----------|
| Stats | 9241 error/warn rows; latest 2026-03-18T12:51:00Z | — |
| Actionable | 0 issues | — |

**Distinct problems:**

### A. D1: `fetch_events` has no column named `job_kind`

- **What:** Consumer errors when running historical task jobs: `D1_ERROR: table fetch_events has no column named job_kind: SQLITE_ERROR` in `persistFetchEvent` → `persistRawPayload` (historical_task_execute).
- **Root cause:** Migration **0031_fetch_events_slim_columns.sql** drops `job_kind` from `fetch_events`. The **current repo** code in `workers/api/src/db/fetch-events.ts` already **does not** insert `job_kind` (INSERT lists 11 columns, no `job_kind`). So production is running an **older Worker bundle** that still attempted to insert `job_kind`.
- **Fix:** Redeploy the API Worker so the current code (no `job_kind` in INSERT) is live: from repo root run `npm run deploy:api`. No code or migration change required.

### B. Scheduler: coverage_gap_audit_detected_gaps (coverage_slo_breach)

- **What:** Daily coverage gap audit reports 10 gaps (e.g. UBank index_fetch_not_succeeded, Bendigo failed_detail_fetches, HSBC detail_processing_incomplete).
- **Nature:** Operational / datafeed coverage; not a front-end or schema bug. Addressed via CDR/ingest playbooks and lender fixes (see cdr-bank-api-expert, coverage-gap remediation).

### C. Scheduler: Run lifecycle reconciliation stalled

- **What:** `run_lifecycle_reconciliation_stalled` — force_closed_unfinalized: 16, stale_unfinalized_scanned: 16.
- **Nature:** Run lifecycle not closing runs; can be a consequence of coverage/ingest failures (B). Resolving B and ensuring daily ingest completes helps.

---

## 2. Remote visual / site state

- **Homepage test:** `npm run test:homepage` (Playwright vs production); on failure saves screenshots to `./test-screenshots/`.
- **Full visual audit:** `npm run audit:visual` — multiple routes × viewports × states; output in `test-screenshots/visual-audit-<timestamp>/`.
- **Chart in scope:** Home Loans → Curve (variable rate over time by LVR tier, one colour per bank). After recent fixes, the chart should show multiple LVR lines per bank in the same colour and a bank legend at the bottom. Run the audit or load the Curve and “Draw Chart” to confirm.

---

## 3. Data-visualisation review (HL Curve — LVR lines)

**Section:** Home Loans. **View:** Curve (variable rate over time by LVR tier).

**One question (under 10s):**  
“How does each bank’s variable rate vary by LVR tier over this period?”

**Award-jury lens:**

- **Truthful:** One series = one (bank, LVR product) over time; product_key / longitudinal identity is respected per tier. Good.
- **Clear:** Title and subtitle (“Variable rate over time by LVR tier (one colour per bank)”) set the frame. Legend = one entry per bank; tooltip shows Bank, LVR, Date, Rate. Axis labels and units (%) should be explicit.
- **Surprise/insight:** The chart can reveal which banks keep LVR tiers close (flat band) vs spread, and who moved when. Optional: sparse annotation (e.g. RBA date) if data-driven.
- **Efficient:** Default to Curve; 8 banks × their LVR tiers can get dense — consider “see more” or rank-by-coverage if needed.
- **Accessible:** Bank accent colours (ar-chart-config.js BANK_ACCENT_COLORS) and contrast; ensure legend and tooltips are readable at mobile sizes.

**Recommendation:**  
Keep the current encoding (time on X, rate on Y, one colour per bank, one line per LVR product). Ensure Y-axis label and title state “Variable interest rate (%)” and that the legend is visible and not clipped (grid bottom / legend top). For a future “award” step: consider a single annotation layer (e.g. RBA cash rate date) or a small multiples option by bank if the number of series grows.

---

## 4. Commit–sync–verify

- **Repairs:** No code change for the job_kind error; API Worker redeploy is the fix.
- **If you deploy:** After `npm run deploy:api`, wait 5–15 s, then run from repo root:  
  `npm run test:homepage`; `npm run test:api`; `npm run test:archive`.  
  Optionally `node diagnose-api.js` for API health.
- **Loop:** If any check fails, fix and re-run until all pass.

---

## 5. References

| Item | Location |
|------|----------|
| Logs API, credentials | AGENTS.md; .cursor/rules/debug-use-logfiles.mdc |
| Fix–commit–verify | .cursor/rules/fix-commit-verify-loop.mdc |
| Chart config, bank colours | site/ar-chart-config.js (BANK_ACCENT_COLORS, bankAccentColor) |
| HL Curve model (LVR curves) | site/ar-chart-market.js (bankLvrCurves, computeConsistentLvrTiersPerBank) |
| HL Curve ECharts option | site/ar-chart-market-echarts.js (buildLineOption for bankLvrCurves) |
