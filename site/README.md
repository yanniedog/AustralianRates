# Site Notes

The frontend is plain HTML, CSS, and browser JS under `site/`. There is no bundler. New pages should follow the existing script order and reuse the `window.AR` modules instead of creating alternate boot paths.

`site-variant.js` is also the required bootstrap for public-page Clarity analytics. `npm run build` and `npm run check:clarity` fail if that integration or its privacy disclosure is removed.

## Public Page Load Order

Public section pages (`/`, `/savings/`, `/term-deposits/`) use this dependency chain:

1. Vendor libraries first: Tabulator, jQuery, jQuery UI, PivotTable, Plotly, ECharts, SheetJS.
2. Core namespace and shared helpers: `ar-utils.js`, `ar-bank-brand.js`, `ui-icons.js`, `ar-time.js`, `ar-section-config.js`, `ar-config.js`, `ar-public-page.js`, `ar-public-intro.js`, `ar-dom.js`.
3. State and interaction modules: `ar-layout-resize.js`, `ar-ui-scale.js`, `ar-state.js`, `ar-tabs.js`, `ar-filter-ui.js`, `ar-filters.js`, `ar-hero.js`, `ar-explorer.js`, `ar-pivot.js`.
4. Chart stack: `ar-chart-config.js`, `ar-chart-data.js`, `ar-chart-echarts-helpers.js`, `ar-chart-echarts.js`, `ar-chart-ui.js`, `ar-chart-summary.js`, `ar-charts.js`.
5. Final orchestration: `ar-refresh.js`, `ar-export.js`, `ar-rate-changes.js`, `ar-executive-summary.js` where present, `ar-mobile-table-nav.js`, `ar-ux.js`, `app.js`, `frame.js`, `site-variant-ui.js`.

Admin pages must load `admin-portal.js` before page-specific admin scripts so the auth guard and `fetchAdmin()` helper are available.

## Local API Override

The public pages default to the current host's API path, but they also accept an explicit `apiBase` query param.

Examples:

- Home loans: `http://localhost:8788/?apiBase=http://localhost:8787/api/home-loan-rates`
- Savings: `http://localhost:8788/savings/?apiBase=http://localhost:8787/api/savings-rates`
- Term deposits: `http://localhost:8788/term-deposits/?apiBase=http://localhost:8787/api/term-deposit-rates`

Local API testing still depends on the API worker allowing the origin in CORS.

## Responsive Rules

- `760px` is the primary breakpoint used by the admin layout and public responsive styles.
- The public site is responsive on the primary host. Do not add `m.australianrates.com` alternates or host-switch UI unless that host is actually deployed again.
- `site-variant.js` still preserves desktop/mobile counterpart behavior when a page is already being served from an `m.` host.

## Accessibility and Async States

Current coverage:

- Public pages include the skip link and `#main-content` landmark.
- Filters, tabs, chart controls, and mobile table navigation already use ARIA attributes.
- Major async flows expose visible loading/error feedback in the UI: hero, table explorer, chart area, pivot, exports, and admin download jobs.

Known gaps:

- Full keyboard-only and screen-reader audits are still pending.
- Focus-order regression checks are still manual.

## Design Rules

- Use the existing `--ar-*` CSS variables from `foundation.css` for color, spacing, radius, and typography.
- Avoid hard-coded colors or spacing when a design token already exists.
- Reuse existing shell/panel patterns before adding new one-off layout containers.

## Vendor Inventory

| Library | Local asset | Version note |
| --- | --- | --- |
| jQuery | `site/vendor/jquery/jquery.min.js` | v3.7.1 |
| jQuery UI | `site/vendor/jquery-ui/jquery-ui.min.js` | v1.13.2 |
| Tabulator | `site/vendor/tabulator/tabulator.min.js` | v6.3.0 |
| PivotTable.js | `site/vendor/pivottable/pivot.min.js` | vendored, header retained |
| Plotly | `site/vendor/plotly/plotly-basic-2.35.2.min.js` | v2.35.2 from filename |
| Plotly renderers | `site/vendor/pivottable/plotly_renderers.min.js` | vendored bridge for PivotTable.js |
| SheetJS | `site/vendor/sheetjs/xlsx.full.min.js` | bundled codepage header shows `1.15.0` |
| ECharts | `site/vendor/echarts/echarts.min.js` | vendored, confirm header before upgrades |
