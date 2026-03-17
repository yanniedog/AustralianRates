# Beta Test Report: Charts not loading

## Summary

- **Target:** Chart loading on https://www.australianrates.com (Home Loans, Savings, Term Deposits).
- **Environment:** Production; codebase analysis and API/data flow review. No live browser run in this session.
- **Date:** 2026-03-17
- **Coverage:** Chart init flow (app.js, ar-charts.js, ar-chart-data.js), /analytics/series API (workers/api), request/response shape, server-side row volume. Not covered: live click-through on production, mobile viewport, or accessibility of chart controls.
- **Constraints:** Production /analytics/series fetch timed out when probed externally; analysis is code-based plus one failed fetch.

## Coverage Map

| Item | Tested | Notes |
|------|--------|--------|
| Chart trigger (drawChart on app init) | Code | setTimeout 150ms after filters load; requires ar-public and #chart-output |
| Chart data source (fetchAllRateRows) | Code | Calls apiBase + /analytics/series with filter params |
| requestJson response handling | Code | Returns result.data; fetchAllRateRows expects .rows, .total, .representation |
| API /analytics/series (HL, Savings, TD) | Code + 1 fetch | Route exists; production GET timed out (no limit, full dataset) |
| Server-side row volume | Code | collectByOffset / collectAllPages fetched all rows; no cap |
| #chart-output in DOM | Code | Injected by ar-public-page.js render(); ar-dom.js captures it after |
| Chart error handling | Code | clearOutput('Error loading chart'), setStatus, clientLog on failure |

## Top Priorities

1. **Server-side cap for /analytics/series (High – implemented)**  
   The API collected all rows (tens of thousands+) for each request, causing slow or timing-out responses. Charts then failed to load or showed "Error loading chart" / "Chart history could not be loaded." **Fix applied:** Cap at 20,000 rows in workers/api (collectByOffset + capRows in resolveRepresentationRows) so the response returns in reasonable time.

2. **Client debug log row count (Low – implemented)**  
   Success debug log used `result.rows` instead of `result.data.rows` (requestJson returns { data, response, text }). **Fix applied:** Log now uses result.data.rows for correct row count in debug payloads.

3. **Verify charts on production after deploy (High)**  
   After deploying the API cap, run test:homepage (which includes chart draw and "Chart load completed") and manually open /, /savings/, /term-deposits/ and confirm the chart loads (Curve or Leaders) and status moves from "Load chart when ready" to a summary line.

## Findings

### [High] /analytics/series returns unbounded rows and can time out

- **URL or location:** GET /api/home-loan-rates/analytics/series (and savings, term-deposits equivalents).
- **Area:** Performance / bug
- **Evidence:** Production request to .../analytics/series?representation=day&sort=collection_date&dir=asc timed out. Code: collectByOffset and collectAllPages fetch all pages with no max total; client requestJson timeout 40s.
- **Reproduction steps:** Open a rate section, wait for chart to load; or call GET .../analytics/series with no limit. With large datasets the request can exceed 40s or Worker limits.
- **Observed result:** Chart stays on "LOAD..." or shows "Error loading chart" / "Chart history could not be loaded."
- **Expected result or standard:** Chart loads within a few seconds with a bounded payload.
- **Impact:** Charts appear not to load for users; core visualisation is broken or unreliable.
- **Recommendation:** Cap server response at 20,000 rows (implemented in analytics-data.ts: CHART_SERIES_MAX_ROWS, collectByOffset maxRows, capRows in resolveRepresentationRows). Optionally add a query param limit for future tuning.

### [Low] Debug log row count used wrong result shape

- **URL or location:** site/ar-chart-data.js fetchAnalyticsRows success handler.
- **Area:** Analytics / other
- **Evidence:** sendDebugLog used result.rows; requestJson returns { data, response, text }, so result.rows is undefined. result.data is the API body and has .rows.
- **Reproduction steps:** Load chart; inspect debug-log payload or client log; row count in success log was wrong/undefined.
- **Observed result:** Debug payload rowCount incorrect or undefined.
- **Expected result or standard:** Log should reflect actual row count from API body.
- **Impact:** Misleading diagnostics only; no user-facing impact.
- **Recommendation:** Use result.data && result.data.rows for row count (implemented).

## Improvement Opportunities

- **Perceived performance:** After first chart load, consider caching or "stale while revalidate" so switching views/filters feels faster.
- **Chart controls visibility:** Chart controls live in a <details> (terminal-chart-fold) closed by default; some users may not expand it. Consider leaving the chart surface always visible and only collapsing the control strip on mobile.
- **Error message:** "Chart history could not be loaded" could add a short hint: "Try narrowing filters or try again in a moment" when the failure is timeout or server error.

## Systemic Themes

- **Chart depends on /analytics/series:** All chart views (Curve, Leaders, Compare, Movement, Distribution) get data via fetchAllRateRows -> /analytics/series. A slow or failing series endpoint affects every chart.
- **Fallback path:** API falls back to "day" representation when analytics projection is not ready or when change-query fails; response shape is the same, so client behaviour is consistent.

## Untested or Blocked Areas

- Live production click-through (charts not visually verified in browser this run).
- Mobile viewport and touch on chart controls.
- Savings and Term Deposits /analytics/series under load (same cap now applied).

## Final Verdict

- **What is working well:** Chart code path is coherent (init, drawChart, fetchAllRateRows, renderFromCache). API route exists and returns correct JSON shape. Fallback to day representation when projection is unavailable is in place.
- **What feels risky or unfinished:** Unbounded row volume made /analytics/series slow or timing out, so charts often did not load. This was the primary cause of "charts not loading."
- **Is the site ready for broader users in its current state?** After deploying the 20k row cap and re-running tests, charts should load reliably. Verify with test:homepage and a quick manual check.
- **What should happen next:** Deploy API with analytics cap; run npm run test:homepage; if pass, confirm charts load on /, /savings/, /term-deposits/ in a real browser.
