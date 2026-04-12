# Comprehensive Site Test Protocol

This document defines rendering, interaction, accessibility, and API checks for AustralianRates.

## Test target and configuration

- Frontend: static Pages app under `site/` with tabs, filters, table, pivot, charts, and legal pages.
- API: Workers under:
  - `/api/home-loan-rates/*`
  - `/api/savings-rates/*`
  - `/api/term-deposit-rates/*`

Covered endpoints include `health`, `filters`, `rates`, `latest`, `latest-all`, `timeseries`, `export.csv`, and async export jobs under `POST /exports` plus `GET /exports/:jobId`.

Configuration:

- `TEST_URL`: site base URL (default `https://www.australianrates.com/`)
- `API_BASE`: optional API base override for diagnostics
- `HEADLESS=0`: run Playwright in headed mode
- `ADMIN_TEST_TOKEN` or `ADMIN_API_TOKEN`: required for authenticated admin portal audit (`npm run test:admin-portal`)

## 1. Rendering and layout

| Area | What is tested | How |
|------|----------------|-----|
| Viewports | No horizontal overflow at 375, 768, 1920 widths | Playwright viewport + screenshots + `scrollWidth <= viewport` |
| Hero and summary | Eyebrow, heading, subtitle, stats, SEO summary | Assert visibility/text for hero and summary nodes |
| Mode controls | Consumer default and analyst toggle behaviour | Assert mode buttons, persistence, and tab visibility changes |
| Tabs and panels | Tab labels and active panel switching | Click tabs and assert panel `hidden`/active state |
| Filters | Filter controls and download selector are visible | Assert required selectors exist |
| Table | Tabulator renders and rows load | Wait for table and rows |
| Pivot/charts | Controls and output containers render | Assert panel controls and content containers |
| Footer | Disclaimer plus legal links visible; client-log download available; no public system-log download | Assert disclaimer text, legal links, and footer log popup actions |
| Admin isolation | No discoverable public admin links/shortcuts | Assert no admin links in public headers/footers/disclaimers |
| Legal pages | Each legal page is reachable and distinct | Visit `/about/`, `/privacy/`, `/terms/`, `/contact/` and check title/content |
| No-JS fallback | Noscript helper blocks exist in HTML | Fetch raw HTML and assert noscript + API link presence |

Scripts:

- `npm run verify:prod -- --scope=site --depth=smoke`
- `npm run verify:prod -- --scope=site --depth=full`
- `npm run check:public-assets`

## 2. Interaction checks

| Action | Expected result | Assertion |
|--------|-----------------|-----------|
| Skip link | Focus moves to `#main-content` | Activate skip link and verify focus |
| Apply Filters | Table reloads without breaking state | Click apply and verify table still responds |
| Load Pivot | Pivot output populates | Click load and assert output content |
| Draw Chart | Chart output populates | Click draw and assert chart container content |
| Download | Export request is triggered | Select CSV and detect export request/flow |
| Public trigger removal | No public manual-run trigger controls | Assert `#trigger-run` is absent on all public sections |
| URL state | Tab/filter params persist in URL | Change tab/filter and verify URL + restore |
| Footer links per section | Legal links visible on home/savings/term | Assert links on each section page |
| Home-loan disclosure | Comparison-rate caveat is visible | Assert `$150,000` + `25 year` disclosure text is present |

Scripts:

- `npm run test:homepage` for the default homepage smoke
- `npm run test:homepage:pivot` for pivot-only coverage
- `npm run test:homepage:mobile` for mobile-only coverage
- `npm run test:homepage:full` for the broader browser suite

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

Scripts:

- `npm run diagnose:api:smoke`
- `npm run diagnose:api`

## 4. Accessibility baseline

| Check | Implementation |
|-------|----------------|
| Skip link | Present and usable |
| Tab semantics | `role=tablist/tab/tabpanel` and `aria-*` wiring |
| Labels | Inputs/selects are labeled |
| Keyboard | Tabs, filters, and buttons are keyboard reachable |

Automated checks are in `test-homepage.js`. Manual screen reader checks remain recommended.

## 5. Admin portal (read-only) audit

`npm run test:admin-portal` runs production-safe checks and must not invoke mutating admin actions.

Coverage:

- Auth contract: unauthenticated admin API probes return `401 UNAUTHORIZED`, invalid token login shows error, valid token login succeeds.
- Guard contract: direct navigation to `/admin/{page}` without session redirects to `/admin/`.
- Non-mutating UI checks: dashboard nav, status refresh, database row selection enables edit/delete controls, clear-page scope toggles, config/env render, runs realtime refresh, logs downloads, logout.
- Runtime safety: no console errors/page errors and no `4xx/5xx` responses on authenticated admin API requests during read-only flow.

Explicitly out of scope in this audit command:

- Triggering runs (`/runs/daily`, `/runs/backfill`, `/historical/pull`, health run).
- Data mutation (`/db/clear`, DB add/edit/delete rows).
- Config mutation (`PUT/DELETE /admin/config`).
- Log wipe (`POST /admin/logs/system/wipe`).

## One-page checklist

1. Run `npm run verify:prod -- --scope=auto --depth=smoke`.
2. Run `npm run test:admin-portal` with `ADMIN_TEST_TOKEN` or `ADMIN_API_TOKEN` set.
3. Run `npm run verify:prod -- --scope=full --depth=full` when you changed shared/tooling/workflow/verification code or want full sign-off.
4. Run `npm run diagnose:api` or `npm run doctor` only when you need deeper production triage.
5. Optionally run `npm run test:site`.
6. Review screenshots under `test-screenshots/`.
7. Validate keyboard navigation and visible focus.

## Commands summary

| Command | Description |
|---------|-------------|
| `npm run verify:prod -- --scope=auto --depth=smoke` | Default targeted production verification for the current change set. |
| `npm run verify:prod -- --scope=full --depth=full` | Full production verification for shared/tooling/workflow or explicit full sign-off. |
| `npm run test:homepage` | Fast Playwright smoke for the homepage shell, explorer, chart, and runtime health. |
| `npm run test:homepage:pivot` | Dedicated pivot browser suite. |
| `npm run test:homepage:mobile` | Dedicated mobile browser suite. |
| `npm run test:homepage:full` | Smoke + pivot + mobile + extra public section browser coverage. |
| `npm run test:admin-portal` | Playwright admin read-only audit (auth, redirects, non-mutating page/component checks, runtime/network error checks). |
| `npm run diagnose:api:smoke` | Fast production API smoke checks for deploy sign-off. |
| `npm run diagnose:api` | Deep API diagnostics and performance checks across all datasets. |
| `npm run verify:prod-hosting` | DNS, TLS, homepage, and API health verification for both apex and `www` production hosts. |
| `npm run check:public-assets` | Fails if public section pages include disallowed external script/style URLs or miss required vendored assets. |
| `npm run test:site` | Runs homepage then API diagnostics. |
