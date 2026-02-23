# Comprehensive Site Test Protocol

This document describes the test protocol for the AustralianRates site: rendering, interaction, content discovery, expected responses, accessibility, and API integration.

## Test target and configuration

- **Frontend:** Single page at `site/index.html` (Cloudflare Pages): tabs (Rate Explorer, Pivot Table, Chart Builder), filter bar, Tabulator table, PivotTable, Plotly charts, optional Admin panel (`?admin=true`).
- **API:** Worker at `/api/home-loan-rates/*`: health, filters, rates, export, latest, timeseries, export.csv; admin routes behind token.

**Configuration:**

- `TEST_URL` – Base URL for the site (default: `https://www.australianrates.com/`). Use for local or preview, e.g. `TEST_URL=http://localhost:8788/`.
- `API_BASE` – Override API base for diagnostics (optional; otherwise derived from `TEST_URL`).
- `HEADLESS` – Set to `0` to run Playwright with browser visible; otherwise headless.

## 1. Readability and screen rendering

| Area | What is tested | How |
|------|----------------|-----|
| Viewports | Layout and no horizontal overflow at 375px, 768px, 1920px | Playwright viewport + full-page screenshots; overflow check via `document.documentElement.scrollWidth <= viewport.width`. |
| Hero and SEO | Eyebrow, h1, subtitle, hero stats, SEO summary visible | Assert text and visibility of `.eyebrow`, `.hero h1`, `.subtitle`, `#hero-stats`, `.seo-summary`. |
| Tabs and panels | Tab labels; one panel visible; correct active state | Tab text; `#panel-explorer`, `#panel-pivot`, `#panel-charts` visibility and `hidden`/`active` after tab clicks. |
| Filter bar | All filter controls and Download select visible | Presence/visibility of `#filter-bank` … `#filter-feature`, `#apply-filters`, `#download-format`, `#refresh-interval`. |
| Rate Explorer | Tabulator present; header; at least one data row when API has data | Wait for `#rate-table .tabulator` and `#rate-table .tabulator-row`; assert row count when applicable. |
| Pivot / Chart panels | Load Data for Pivot and Draw Chart visible; pivot/chart containers | After switching tab: `#load-pivot`, `#pivot-output`, `#draw-chart`, `#chart-output`, `#chart-status`. |
| Footer | Disclaimer visible and full text | `.disclaimer` contains “This site provides general information only”. |

**Script:** `node test-homepage.js` (or `npm run test:homepage`). Screenshots in `test-screenshots/`.

## 2. Clicking and discovery of content

| Action | Expected result | Assertion |
|--------|-----------------|-----------|
| Skip link | Focus moves to `#main-content` | Click “Skip to content”; assert focus within `#main-content`. |
| Tab: Rate Explorer | Explorer panel and table visible | Click `#tab-explorer`; assert `#panel-explorer` visible, `#rate-table .tabulator` visible. |
| Tab: Pivot Table | Pivot panel; Load Data and pivot output present | Click `#tab-pivot`; assert `#panel-pivot` not hidden, `#load-pivot`, `#pivot-output` visible. |
| Tab: Chart Builder | Chart panel; axis/group/type and Draw Chart present | Click `#tab-charts`; assert `#panel-charts` visible, `#draw-chart`, `#chart-output` visible. |
| Apply Filters | Table reloads; request to rates API with params | Click Apply; wait for network/table update; table still has data or expected empty state. |
| Load Data for Pivot | Pivot data loads; `#pivot-output` gets content | In Pivot tab, click `#load-pivot`; wait for request and content in `#pivot-output`. |
| Draw Chart | Chart request; `#chart-output` gets Plotly graph | In Chart tab, click `#draw-chart`; wait for fetch and chart content. |
| Download (Export) | Selecting CSV/XLS/JSON triggers export or request | Select from `#download-format`; assert export request or download. |
| Check Rates Now | POST to `/trigger-run`; trigger status updates | Click `#trigger-run`; assert POST; assert `#trigger-status` text change. |
| URL state | Tab and filters sync to URL; reload restores | After tab/filter change, URL contains `tab=` and filter params; reload restores tab (e.g. `?tab=pivot`). |

**Script:** `node test-homepage.js` (same as above).

## 3. Content and expected response

| Source | What is checked | How |
|------|-----------------|-----|
| Page title and meta | Title and meta description match SEO intent | `document.title` and `<meta name="description">` content. |
| Hero stats | “Last updated”, “RBA Cash Rate”, “Records” populated (not “…”) | Wait for `#stat-updated`, `#stat-cash-rate`, `#stat-records` to not contain “…”. |
| Filter options | Bank (and others) dropdowns populated from API | After load, `#filter-bank option` count > 1. |
| Table data | First row has expected fields (date, bank, rate) | First row cell text; optional match to API rates response. |
| API responses | Health, filters, rates, export return 200 and valid structure | `diagnose-api.js` or Playwright API for health, filters, rates, export.csv; assert status and shape. |
| Export formats | CSV has header row; JSON parseable | Trigger download or fetch export URL; assert CSV header; JSON parse and structure. |

**Scripts:** `node test-homepage.js` (hero, filters, table); `node diagnose-api.js` (API and export).

## 4. Accessibility (a11y)

| Check | Implementation |
|-------|----------------|
| Skip link | Present; target `#main-content`; focus moves on click. |
| Tab semantics | `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls` on tabs; `role="tabpanel"` on panels. |
| Labels | Filter controls have `<label>` or `aria-label` (e.g. `#download-format` has `aria-label`). |
| Keyboard | Tab key reaches tabs, filters, buttons; Enter/Space activates tabs. |

**Automated:** Skip link and tab roles are asserted in `test-homepage.js`. Optional: add `@axe-core/playwright` and run axe on the page; fail on critical/serious.

**Manual checklist:** Tab order; screen reader (e.g. NVDA/JAWS) for tabs and filters; focus visible on skip link and tabs.

## 5. API and integration

| Test | Scope |
|------|--------|
| Public API | GET health, filters, rates (paginated), latest, timeseries, export.csv — status 200 and expected body shape. |
| Export endpoint | GET export.csv (and optionally /export with query params); response CSV/JSON/XLS and content-type. |
| Frontend–API | Page load triggers fetch to filters and rates; no 4xx/5xx for those on load. |

**Script:** `node diagnose-api.js`. Covers health, filters, rates, latest, timeseries, export.csv, homepage. Use `TEST_URL` or `API_BASE` to point at staging or local.

## 6. Known selector and behaviour notes

- **Download control:** The deployed site uses **`#download-format`** (a select with CSV, XLS, JSON options), not `#download-csv`. Tests assert `#download-format` and its options.

## One-page checklist (manual run)

1. Run `npm run test:homepage` (or `node test-homepage.js`). Fix any failures.
2. Run `npm run diagnose:api` (or `node diagnose-api.js`). All endpoints should succeed.
3. Optionally run `npm run test:site` to run both.
4. Review screenshots in `test-screenshots/` for layout and overflow.
5. Optional: run axe (or other a11y tool) and fix critical/serious issues.
6. Manual: keyboard tab through tabs and filters; test with screen reader if available.

## Commands summary

| Command | Description |
|---------|-------------|
| `npm run test:homepage` | Playwright UI tests (load, hero, tabs, filters, table, export, trigger, URL state, viewports, a11y). |
| `npm run diagnose:api` | API diagnostics: health, filters, rates, latest, timeseries, export.csv, homepage. |
| `npm run test:site` | Runs test:homepage then diagnose:api; exits with failure if either fails. |

Example for local/preview:

```bash
TEST_URL=http://localhost:8788/ node test-homepage.js
TEST_URL=http://localhost:8788/ node diagnose-api.js
```
