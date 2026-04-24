# Refactor Backlog

Tracks oversized files that still breach the ≤1000 LOC hard ceiling defined in
`.cursor/rules/multiagent-modularity.mdc`. Pick one at a time; split along the
natural seams listed; open a dedicated PR per file so CI stays focused and
easy to bisect if a visual regression appears.

## Method

1. Read the target file end-to-end; list its top-level functions and closures.
2. Identify natural seams (pure helpers vs. closure-dependent logic; per-view
   kind; per-section; per-payload-mode).
3. Extract the pure/independent parts into new sibling files that expose their
   API on a narrow `window.AR.<name>` namespace. Keep the original public
   entrypoint exported from the same location it was before.
4. Update every `<script src>` that already loads the original — load the new
   dependency files **before** the original.
5. Run `npm run stamp:site-assets` (or `npm run build`) so `?v=` stamps pick
   up the new modules.
6. Verify: `npm run test:policy`, `npm run test:api`, `npm run test:homepage`
   (prod), `npm run test:chart-ux` where relevant.
7. After merge + Cloudflare deploy: `npm run verify:prod -- --scope=auto --depth=smoke`.

## Files still over the ceiling

| File | LOC | Notes / suggested seams |
|---|---|---|
| `site/ar-chart-report-plot-shared.js` | 1843 | Partially split in this PR (utilities / extents / series-builders / moves-pane / hierarchy-panel extracted). The large remaining `render()` closure (lines ~75–1740) still needs internal decomposition — break out the bands-mode branch, the moves-mode branch, the ribbon-interaction handlers, and the disposer. Each consumes the same shared state, so consider extracting a `createRibbonState(options)` factory that returns the shared mutable state plus hooks. |
| `site/public-analysis.css` | 1874 | CSS. Split by section: ribbon panel styles, chart side-panel, filter pads, report toolbars, mobile overrides. Load all new files in the same `<link>` order. |
| `site/public-shell.css` | 1232 | CSS. Separate layout shell (grid / main / bg) from header+footer+nav. |
| `site/ar-chart-echarts.js` | 1420 | Likely splits into: option builder, tooltip, zoom/range, event wiring. |
| `site/ar-chart-market-echarts.js` | 1221 | Same pattern as above; extract bank-color + series-building helpers first. |
| `site/ar-chart-data.js` | 1130 | Split request/snapshot helpers from model builders. The new report snapshot product-history path is a natural seam: extract `buildChartModelFromReportProductHistory`, request-policy helpers, and snapshot bundle reads into sibling modules loaded before the main chart-data entrypoint. |
| `site/ar-charts.js` | 1092 | Split report-view lifecycle from generic chart orchestration. The report snapshot bootstrap / lightweight render path (`buildReportPreviewModel`, `renderReportPreview`, `refreshReportRangePreview`, report draw branch) can move into a dedicated report-controller module. |
| `site/ar-explorer.js` | 1299 | Split by explorer subsystem (filters, sort, URL sync, DOM wiring). |
| `site/admin/status-page.js` | 1213 | Split by section card: coverage-gaps, logs, replay-queue, remediation-hints. |
| `site/economic-data.js` | 995 | Existing large economic dashboard entrypoint; this PR split signal summary/chart, axis helpers, and legend-stack rendering into sibling modules. Split catalog controls and ECharts raw/indexed rendering next. |
| `site/frame.js` | 1045 | Split chrome bootstrap from runtime re-render / resize handlers. |
| `tools/node-scripts/src/test-homepage.ts` | 1490 | Split by suite: smoke, pivot, mobile, sections. |
| `tools/node-scripts/src/integrity/repair-presence-prod.ts` | 1359 | Split by repair stage (detect / plan / apply / verify). |
| `tools/node-scripts/src/integrity/data-integrity-audit-prod.ts` | 1340 | Split by audit dimension (CDR coverage, presence, duplicates, timestamps). |
| `workers/api/src/db/integrity-checks.ts` | 945 | Below 1000 but trending up — plan a split when next touched. |
| `workers/api/src/db/chart-cache.ts` | 594 | Below 1000 but above the refactor trigger and touched by cost-control work. Split gzip/KV helpers, scope resolution, and D1 cache read/write operations into sibling modules before the next cache behavior change. |
| `workers/api/src/routes/snapshot-public.ts` | 321 | Over the review threshold. Split public package request handling from package construction when replacing the current snapshot shape with the v2 `meta`/`dict`/`hierarchy`/`ribbon` package. |
| `workers/api/src/pipeline/scheduler-dispatch.ts` | 323 | Over the review threshold after adding public package refresh. Split task routing from task execution if more scheduled job logic is added. |

## Exempt (do not split for size)

- `workers/api/test/fixtures/historical-quality/production-slice-20260318-20260401.fixture.ts`
  — real-data fixture captured from production. Per `.cursor/rules/no-mock-test-data.mdc`
  we keep real fixtures intact; rewriting them would violate the real-data rule.
- `workers/archive/worker-configuration.d.ts` — generated by Wrangler.
- Migrations, lockfiles, `wrangler.*`, `tsconfig*`, `vite.config.*`,
  `vitest.config.*`.

## Recently completed

- **PR #XX (this PR):** `ar-chart-report-plot-shared.js` 2604 → 1843 LOC; five
  new modules (`ar-chart-report-plot-utils.js`,
  `ar-chart-report-plot-extent.js`,
  `ar-chart-report-plot-series-builders.js`,
  `ar-chart-report-plot-moves-pane.js`,
  `ar-chart-report-plot-hierarchy-panel.js`). Also removed orphaned
  `site/ar-export.js`, eight tracked `tmp-*` / scratch files, and the
  `workers/api/null/` accidental Wrangler build output.
