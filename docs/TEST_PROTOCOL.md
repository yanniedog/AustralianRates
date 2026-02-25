# Comprehensive Site Test Protocol

This document defines rendering, interaction, accessibility, and API checks for AustralianRates.

## Test target and configuration

- Frontend: static Pages app under `site/` with tabs, filters, table, pivot, charts, legal pages, and calculator.
- API: Workers under:
  - `/api/home-loan-rates/*`
  - `/api/savings-rates/*`
  - `/api/term-deposit-rates/*`

Covered endpoints include `health`, `filters`, `rates`, `latest`, `latest-all`, `timeseries`, and `export.csv`.

Configuration:

- `TEST_URL`: site base URL (default `https://www.australianrates.com/`)
- `API_BASE`: optional API base override for diagnostics
- `HEADLESS=0`: run Playwright in headed mode

## 1. Rendering and layout

| Area | What is tested | How |
|------|----------------|-----|
| Viewports | No horizontal overflow at 375, 768, 1920 widths | Playwright viewport + screenshots + `scrollWidth <= viewport` |
| Hero and summary | Eyebrow, heading, subtitle, stats, SEO summary | Assert visibility/text for hero and summary nodes |
| Tabs and panels | Tab labels and active panel switching | Click tabs and assert panel `hidden`/active state |
| Filters | Filter controls and download selector are visible | Assert required selectors exist |
| Table | Tabulator renders and rows load | Wait for table and rows |
| Pivot/charts | Controls and output containers render | Assert panel controls and content containers |
| Footer | Disclaimer plus legal links visible | Assert disclaimer text and `About/Privacy/Terms/Contact` links |
| Legal pages | Each legal page is reachable and distinct | Visit `/about/`, `/privacy/`, `/terms/`, `/contact/` and check title/content |
| No-JS fallback | Noscript helper blocks exist in HTML | Fetch raw HTML and assert noscript + API link presence |
| Calculator | Home-loan repayment estimator works | Fill known inputs and verify deterministic output |

Script: `npm run test:homepage`

## 2. Interaction checks

| Action | Expected result | Assertion |
|--------|-----------------|-----------|
| Skip link | Focus moves to `#main-content` | Activate skip link and verify focus |
| Apply Filters | Table reloads without breaking state | Click apply and verify table still responds |
| Load Pivot | Pivot output populates | Click load and assert output content |
| Draw Chart | Chart output populates | Click draw and assert chart container content |
| Download | Export request is triggered | Select CSV and detect export request/flow |
| Check Rates Now | POST to `trigger-run` and status update | Assert request and status text |
| URL state | Tab/filter params persist in URL | Change tab/filter and verify URL + restore |
| Footer links per section | Legal links visible on home/savings/term | Assert links on each section page |

Script: `npm run test:homepage`

## 3. API response checks

| Scope | Endpoints |
|-------|-----------|
| Home loans | `/health`, `/filters`, `/rates`, `/latest`, `/latest-all`, `/timeseries`, `/export.csv` |
| Savings | `/health`, `/filters`, `/rates`, `/latest`, `/latest-all`, `/timeseries`, `/export.csv` |
| Term deposits | `/health`, `/filters`, `/rates`, `/latest`, `/latest-all`, `/timeseries`, `/export.csv` |

Checks:

- HTTP 200 on core endpoints
- Expected response envelope and row arrays where applicable
- `latest-all` returns `ok`, `count`, `rows`, `meta`
- Benchmark p95 threshold and non-200 failures reported

Script: `npm run diagnose:api`

## 4. Accessibility baseline

| Check | Implementation |
|-------|----------------|
| Skip link | Present and usable |
| Tab semantics | `role=tablist/tab/tabpanel` and `aria-*` wiring |
| Labels | Inputs/selects are labeled |
| Keyboard | Tabs, filters, and buttons are keyboard reachable |

Automated checks are in `test-homepage.js`. Manual screen reader checks remain recommended.

## One-page checklist

1. Run `npm run test:homepage`.
2. Run `npm run diagnose:api`.
3. Optionally run `npm run test:site`.
4. Review screenshots under `test-screenshots/`.
5. Validate keyboard navigation and visible focus.

## Commands summary

| Command | Description |
|---------|-------------|
| `npm run test:homepage` | Playwright UI checks (layout, interactions, legal links, calculator, noscript presence checks). |
| `npm run diagnose:api` | API diagnostics and performance checks across all datasets, including `latest-all`. |
| `npm run test:site` | Runs homepage then API diagnostics. |