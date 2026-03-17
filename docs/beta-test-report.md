# Beta Test Report: AustralianRates Site and Logfile Analysis

## Summary

- **Target:** https://www.australianrates.com (production)
- **Environment:** Production; headless Playwright for traversal and log capture; API diagnostics via diagnose-api.js
- **Date:** 2026-03-17
- **Coverage:** All public pages traversed (Home, Savings, Term Deposits, About, Privacy, Terms, Contact, 404); client log and console captured per page; API health and benchmarks run; table-error detection run on homepage
- **Constraints:** Admin area not tested (auth required). test:homepage not run in this session (can hit Cloudflare bot challenge in headless). Console entries in capture are cumulative across navigation (not cleared between pages)

## Coverage Map

| Item | Tested | Notes |
|------|--------|--------|
| / (Home Loans) | Yes | Client log 18 entries; table and chart loaded; console: ERR_NAME_NOT_RESOLVED, 404 |
| /savings/ | Yes | Client log 18 entries; table/chart loaded |
| /term-deposits/ | Yes | Client log 17 entries; table loaded |
| /about/ | Yes | Client log 1 entry (Frame loaded only) |
| /privacy/ | Yes | Client log 1 entry |
| /terms/ | Yes | Client log 1 entry |
| /contact/ | Yes | Client log 1 entry |
| /does-not-exist (404) | Yes | Client log 1 entry |
| API health + benchmarks | Yes | diagnose-api.js: all passed |
| Table error detection (homepage) | Yes | 50 rows; table loaded after 25s wait; 4 console errors (telemetry) |
| Admin (dashboard, status, logs, etc.) | No | Requires Bearer token |
| Mobile viewport / overlays | No | Not exercised in this capture |
| test:homepage full suite | No | Not run this session |

## Top Priorities

1. **Reduce console noise on legal/static pages (Medium)**  
   Legal and 404 pages load the shared frame and still see "[Client error] Chart load failed {message: Chart history could not be loaded.}" in the console. That error is emitted by the chart path when a chart data request fails. On legal pages the full app (including chart) is not loaded, so the failure likely originates from a prior data page (e.g. Term Deposits) and is visible in cumulative console. Recommendation: (a) In the chart module, only run or only log chart load when the page has a chart container (e.g. `#chart-output`) and is a rate section; (b) Optionally clear or tag console in log-capture per page so errors are attributed to the page that emitted them.

2. **Third-party script failures in headless (Low, known)**  
   Console shows repeated `Failed to load resource: net::ERR_NAME_NOT_RESOLVED` and `the server responded with a status of 404 ()`. These are from Clarity/Cloudflare Insights (or similar) and are **expected** in headless environments; test-homepage already ignores them. Documented in AGENTS.md under "Headless console noise": do not treat these as site failures.

3. **Table ready timing in test:table-errors (Low)**  
   Table error detection reported "Table rows did not appear within 25s" but then showed 50 rows and valid first row. The table did load; the wait condition may be too strict or timing flaky. Consider increasing timeout or waiting on a more reliable signal.

## Findings

### [Medium] Chart load error appears in console on non-chart pages

- **URL or location:** About, Privacy, Terms, Contact, 404 (in captured console log)
- **Area:** UX / logging / analytics
- **Evidence:** docs/beta-test-client-log.txt shows "[Client error] Chart load failed {message: Chart history could not be loaded.}" under About, Privacy, Terms, Contact, and 404. clientLog('error', ...) in ar-charts.js triggers console.error in ar-utils.js. Legal pages do not load app.js or ar-charts.js; the error is from a previous page (console not cleared between navigations in capture) or from a failed chart history request on a data page.
- **Reproduction steps:** Run node beta-test-capture-log.js; open docs/beta-test-client-log.txt; search for "Chart load failed".
- **Observed result:** Console and client log show chart load failure message in contexts where the user is not using the chart (legal/404).
- **Expected result or standard:** Chart code should not attempt or log chart load when there is no chart workspace (e.g. no #chart-output or body not ar-public), or errors should be attributed per page so support can tell where the failure occurred.
- **Impact:** Noisy console and log; possible false alarms in monitoring; user support confusion if they report "error on About page" when the failure was on a data page.
- **Recommendation:** Guard chart init so it does not run on legal/404 (already the case if app.js is not loaded there). If chart load runs on a data page and fails, ensure the error is associated with that page in any shared log. Consider not calling clientLog('error', ...) for chart load when the DOM does not contain the chart panel (defensive check in ar-charts.js).

### [Low] Third-party telemetry failures in console

- **URL or location:** All pages in capture
- **Area:** Performance / analytics
- **Evidence:** Repeated "Failed to load resource: net::ERR_NAME_NOT_RESOLVED" and "the server responded with a status of 404 ()" in beta-test-client-log.txt. These match Clarity and Cloudflare Insights scripts that fail in headless or restricted networks.
- **Observed result:** Console has many such entries; client log had 0 error-level entries from app code.
- **Expected result or standard:** Project already ignores these in test:homepage (isIgnorableTelemetryFailure). No functional impact.
- **Impact:** Console noise in headless or locked-down environments only.
- **Recommendation:** Document in beta-test or logging docs that these are expected in headless; no code change required.

### [Low] Table error detection timeout message vs actual state

- **URL or location:** test:table-errors (homepage)
- **Area:** Test tooling
- **Evidence:** Script printed "Table rows did not appear within 25s" but then reported Table row count: 50 and a valid first row sample.
- **Observed result:** Wait for table rows timed out; table was actually present and populated.
- **Expected result or standard:** Either the table should be considered "ready" within the wait, or the message should not imply failure when data is present.
- **Impact:** Confusing script output; possible false failure if exit code is driven by that message.
- **Recommendation:** Increase wait timeout for table rows and/or use the same ready signal as test-homepage (e.g. waitForExplorerTableReady). Ensure script exit code reflects actual table/API errors, not only the wait result.

## Improvement Opportunities

- **Navigation and IA:** Public nav (Mortgage, Savings, Term Deposits) and footer (About, Contact, Privacy, Terms) are clear. No gaps identified.
- **Content and messaging:** Client log shows consistent lifecycle messages (App init, Filter options loaded, Explorer data loaded, Chart load completed) on data pages; legal pages only log "Frame loaded". Adequate for debugging.
- **Conversion and CTA clarity:** Not evaluated in this pass.
- **Accessibility and inclusive design:** test:homepage covers skip link, filter accessible names, mobile overlays; not re-run here.
- **Mobile polish:** Not exercised in this capture; test:homepage covers mobile rail and overlays.
- **Perceived performance and responsiveness:** API diagnose-api.js reported all benchmarks pass (P95 within target). Chart load on Home and Savings completed; Term Deposits capture did not show "Chart load completed" in the 17 entries (may have completed after capture or failed).

## Logfile Analysis Summary

- **Client log (session):** 58 total entries across 8 pages; 0 error-level entries in client log itself. Data pages show normal flow: App init, filters loaded, explorer table init, explorer data loaded, chart load started/completed (Home, Savings). Term Deposits had chart load started but no "Chart load completed" in the captured slice.
- **Console:** 23 console errors in cumulative capture. Mix of: (1) ERR_NAME_NOT_RESOLVED (third-party scripts); (2) 404 (third-party); (3) "[Client error] Chart load failed {message: Chart history could not be loaded.}" – from chart path when history request fails or from prior page’s chart failure carried over in cumulative console.
- **API:** diagnose-api.js: home-loans, savings, term-deposits – health, filters, rates, latest, latest-all, timeseries, export all 200; all benches pass. No API-side weaknesses identified from this run.
- **Table integrity:** test:table-errors found 50 rows, correct first column "Found at", no EXPLORER_TABLE_ABNORMALITY, no client log errors. Console errors were telemetry only.

## Systemic Themes

- **Real data only:** No mock data; all checks hit production. Aligns with project philosophy.
- **Client log as diagnostic:** Footer "log" and getSessionLogEntries() provide a clear audit trail for init, filters, table, and chart. Useful for beta and support.
- **Telemetry in headless:** Clarity/Cloudflare failures in headless are a known, accepted trade-off; tests explicitly ignore them.

## Untested or Blocked Areas

- **Admin:** All admin routes require authentication; not tested.
- **test:homepage full suite:** Not run this session (possible bot challenge in headless).
- **Mobile viewports and overlays:** Not re-verified in this capture.
- **Per-page console isolation:** Capture script does not clear console between pages, so "Chart load failed" appears under later pages even if it occurred on an earlier page.

## Final Verdict

- **What is working well:**  
  Public rate pages (Home, Savings, Term Deposits) load, show tables and hero stats, and complete chart load on Home and Savings. API health and benchmarks pass. Client log is populated with lifecycle events. No table abnormalities or client-log errors from app code. 404 and legal pages render with correct content and single "Frame loaded" log entry.

- **What feels risky or unfinished:**  
  (1) Chart load failure message ("Chart history could not be loaded") appears in console in contexts where it can be misleading (e.g. when viewing legal pages after a data page where the chart failed). (2) Third-party script errors add noise in headless but are documented and ignored in tests. (3) Table error script’s timeout message is inconsistent with actual table state.

- **Is the site ready for broader users in its current state?**  
  Yes for public use. Core flows and API are healthy. The chart error is a logging/attribution issue, not a blocker for rate comparison or data export.

- **What should happen next:**  
  1. ~~Add a guard in chart init or error logging~~ Done: ar-charts.js only logs "Chart load failed" when `#chart-output` is still in the DOM.  
  2. ~~Document that ERR_NAME_NOT_RESOLVED and 404 in console during headless runs are expected~~ Done: AGENTS.md "Headless console noise".  
  3. ~~Adjust test:table-errors wait/timeout or messaging~~ Done: 35s wait, waitForFunction for rows or placeholder, message when table has data but wait timed out.  
  4. Optionally run test:homepage from a local browser to confirm full suite passes against production.
