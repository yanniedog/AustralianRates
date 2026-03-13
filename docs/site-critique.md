# AustralianRates Site Critique

<!-- markdownlint-disable MD036 -->

Structured critique of the australianrates site (frontend, API worker, archive worker) across multiple expertise dimensions. Baseline: `npm run test:api`, `test:archive`, `test:homepage`, `typecheck:api` all pass (exit 0). No code or deployment changes are implied; this is an assessment and recommendation report only.

**References:** Codebase map (site/, workers/api, workers/archive), [docs/admin-export-critique.md](admin-export-critique.md), [docs/MISSION_AND_TECHNICAL_SPEC.md](MISSION_AND_TECHNICAL_SPEC.md), [docs/USER_INTERACTION_FLOWCHART.md](USER_INTERACTION_FLOWCHART.md), AGENTS.md, .cursor/rules.

---

## 1. Front end (structure, compatibility)

**What was checked:** HTML page count and layout, JS entry points and `AR.*` namespace, script load order, section-specific config (`ar-section-config.js`, `ar-config.js`), API base resolution, vendor usage (Tabulator, Pivot, ECharts, Plotly, jQuery, SheetJS), CSP and CORS in API.

**Strengths**

- Clear separation: 16+ HTML pages (index, savings, term-deposits, about, privacy, terms, contact, admin/*) with shared shell and section-specific `data-ar-section` / `AR.sectionConfig` driving API paths (`/api/home-loan-rates`, `/api/savings-rates`, `/api/term-deposit-rates`).
- Single global namespace `window.AR` with well-defined modules (dom, state, tabs, filters, explorer, pivot, charts, refresh, export, rateChanges, executiveSummary, hero, ux, config, sectionConfig, AdminPortal, etc.) and consistent use in `app.js` and section scripts.
- API base is derived from `window.location.origin` + section `apiPath` with optional override via `?apiBase=`, allowing local override without code change (`site/ar-config.js`, `site/ar-hero.js`, `site/ar-export.js`).
- CSP in API allows only self, fonts.gstatic, and connect to api.github.com; CORS allows australianrates.com and localhost, with `Authorization` and `Cf-Access-Jwt-Assertion` allowed.

**Gaps or risks**

- Many small JS entry points (`app.js`, `ar-*.js`, `admin-portal.js`, etc.) and shared dependencies create ordering and duplication risk; no single bundle or dependency map documented.
- Frontend talks to production API by default (`window.location.origin`); doc note in AGENTS.md that “frontend talks to production API by default” is correct—local API testing requires changing API base (e.g. query param or host).
- Vendor scripts (Tabulator, Pivot, ECharts, jQuery) are loaded from site; version pinning and upgrade path are not documented in a single place.

---

## 2. UX (ease of use, clarity, flow, accessibility)

**What was checked:** USER_INTERACTION_FLOWCHART.md, skip-link and main landmark, ARIA usage, filter/table/chart flows, admin exports UX (admin-export-critique), messaging and polling.

**Strengths**

- Documented user flows: entry points, nav (public tree, legal drawer, admin sidebar), header actions (theme, help, refresh, menu), filter bar, table settings, export, chart, pivot, notes/rate changes, footer (see USER_INTERACTION_FLOWCHART.md).
- Skip link (“Skip to content”) and `#main-content` present on index, savings, about, etc.; `aria-label`, `aria-hidden`, `aria-selected`, `aria-invalid`, `aria-pressed` used in filters, tabs, mobile table nav, chart controls (`site/index.html`, `site/ar-filter-ui.js`, `site/ar-tabs.js`, `site/ar-mobile-table-nav.js`, `site/ar-public-page.js`).
- Consumer vs analyst UI mode (body classes, filter/explorer/tabs behavior) and URL-synced filter state support predictable navigation and shareable links.
- Admin export center: copy cursor, download by artifact, operational bundle fallback; polling only while jobs are pending (docs/admin-export-critique.md).

**Gaps or risks**

- Admin exports: no retry for failed jobs (P0 in admin-export-critique); delta cursor discoverability and persistence weak (P1); artifact metadata (row count, size, cursor range) not shown in UI (P1).
- No site-wide accessibility audit (focus order, keyboard-only nav, screen-reader testing); some ARIA is present but coverage is not systematically documented.
- Chart and pivot flows depend on multiple requests; no explicit “loading” or error recovery messaging is documented for all states.


---

## 3. Back end (APIs, data model, performance)

**What was checked:** API route layout (public vs admin), Hono app and middleware, public pagination/caching, admin auth, D1 usage, constants and limits.

**Strengths**

- Three API bases: home-loans, savings, term-deposits; public and admin routes clearly separated. Admin mounted under each base at `/admin` and protected by `requireAdmin()` (Bearer or CF Access JWT) (`workers/api/src/index.ts`, `workers/api/src/routes/admin.ts`, `workers/api/src/auth/admin.ts`).
- Public read paths use cache headers and cursor-based pagination (`parsePageSize`, `parseCursorOffset`, `paginateRows`); export and list endpoints enforce limits (e.g. 10k export cap, 1000 page size) (`workers/api/src/routes/public.ts`, `workers/api/src/utils/cursor-pagination.ts`).
- Data model aligns with MISSION_AND_TECHNICAL_SPEC: product_key longitudinal identity, collection_date semantics, run_source, run_reports, global_log; public API derived from D1.
- Consistent error shape: `jsonError(c, status, code, message, details?)` with `ok: false` and `error: { code, message, details? }`; 4xx/5xx used appropriately in admin (e.g. admin-downloads).

**Gaps or risks**

- Admin download API contract (list vs job vs artifact vs bundle) and error codes are not fully documented in one place (noted in admin-export-critique); validation limits (e.g. max `since_cursor`, max job_ids on DELETE) are in code but not in a single API doc.
- No D1 import or R2 restore path from admin exports; exports are JSONL without DDL—reconstruction requires migrations + import script (see admin-export-critique and MISSION_AND_TECHNICAL_SPEC).
- Public trigger-run and historical pull are feature-flagged and deprecated where applicable; gates live in `public-write-gates` and route handlers—ensure any new public write path is similarly gated.

---

## 4. Cloudflare (Workers, D1, R2, limits, config)

**What was checked:** wrangler.toml (API), wrangler.jsonc (archive), bindings (D1, R2, Queues, KV, Durable Object), crons, observability, envs.

**Strengths**

- API worker: D1, R2, ingest queue (producer + consumer with DLQ), KV (idempotency), RunLock DO; migrations tag; cron for rate check (6h) and wayback/site health (15 min); observability and invocation logs on (`workers/api/wrangler.toml`).
- Archive worker: separate D1/R2/Queue (discovery + collection); dev vs prod envs in wrangler.jsonc with distinct DB and bucket names (`workers/archive/wrangler.jsonc`).
- Test env for API has dedicated D1, R2, queue, KV, DO and test token; no production secrets in repo.

**Gaps or risks**

- Worker CPU/memory and D1 row/read limits are not documented in repo; AGENTS.md points to Cloudflare docs for limits—any new heavy endpoint (e.g. large exports or analytics) should be checked against platform limits.
- Archive worker env vars (e.g. FEATURE_ARCHIVE_* ) are set but feature behavior is not summarized in a single “Archive worker” doc; discovery/collection flow is in code only.
- KV idempotency is configured but FEATURE_QUEUE_IDEMPOTENCY_ENABLED is false in vars; if enabled later, behavior and TTL should be documented.


---

## 5. User retention and engagement

**What was checked:** Value proposition on pages, CTAs, navigation depth, shareable state, admin value.

**Strengths**

- Homepage and section pages state value clearly: daily CDR-backed rates, compare home loans/savings/term deposits, multiple lenders; schema.org Dataset/WebApplication and OG/twitter meta support discovery and sharing.
- URL-synced filters and “Copy link” support sharing exact views; analyst vs consumer mode supports different engagement levels.
- Admin dashboard, status, database, runs, logs, config, exports, and remediation routes give operators visibility and control, supporting retention of operators rather than end-consumers.

**Gaps or risks**

- No explicit “Sign up” or “Notify me” for consumers; site is informational and link-sharing driven—retention is implicit (bookmarks, return visits) rather than captured.
- Admin exports are powerful but delta cursor and retry UX can frustrate repeated use (see admin-export-critique); improving those supports operator retention.

---

## 6. Browser and device / responsive

**What was checked:** viewport meta, mobile host variant (m.australianrates.com), CSS breakpoints, mobile-host.css, public-shell and foundation.

**Strengths**

- All checked HTML pages use `<meta name="viewport" content="width=device-width, initial-scale=1">` and canonical + alternate for mobile host (`site/index.html`, `site/savings/index.html`, `site/about/index.html`).
- `site-variant.js` sets `data-ar-host-variant` (mobile/desktop) and provides desktop/mobile URL swap; mobile-host.css adjusts header padding, shell width, and terminal column for small viewports (`site/mobile-host.css`, `site/site-variant.js`).
- Foundation uses CSS variables (e.g. `--ar-header-height`, `--ar-shell-max`) and theme tokens; media queries appear in foundation, public-results, public-pivot, public-analysis, public-shell, admin layouts.

**Gaps or risks**

- Breakpoints are scattered (e.g. 760px in mobile-host and alternate link); no single “responsive breakpoints” doc—changes could be inconsistent.
- Mobile host (m.australianrates.com) is referenced in markup and site-variant; routing and deployment for m. are not described in the reviewed docs (assumed handled at DNS/Pages).

---

## 7. Usefulness

**What was checked:** Match to mission (compare rates, daily data, three datasets), public API and exports, admin diagnostics and exports.

**Strengths**

- Mission alignment: collect, normalize, store, publish comparable Australian rate data for home loans, savings, term deposits; transparent public APIs and admin control plane (MISSION_AND_TECHNICAL_SPEC).
- Public usefulness: latest rates, filters, export (CSV/Excel/JSON), charts, pivot, rate changes, executive summary; section-specific APIs and CSV export URLs in schema.org.
- Admin usefulness: status, run reports, DB views, clear data, config, runs, logs, exports (canonical/optimized/operational), remediation, CDR audit, live CDR repair—all support “verify data freshness, diagnose failures, keep historical continuity.”

**Gaps or risks**

- Exports alone do not allow full DB reconstruction without schema and import path (admin-export-critique); operators may assume otherwise.
- Public historical pull and trigger-run are disabled or deprecated via feature flags; documented so, but public “usefulness” for ad-hoc runs is intentionally limited.


---

## 8. Maintainability (DRY, file size, single responsibility)

**What was checked:** Repo rules (max 300/500 lines, 50-line functions, DRY), key file sizes, duplication patterns.

**Strengths**

- AGENTS.md and .cursor/rules enforce max file size (300 flag, 500+ refactor), max function size (50 lines), DRY (no duplicate code in 3+ places), single responsibility.
- API is modular: routes by domain (admin, public, savings, td), auth in auth/, db in db/, pipeline in pipeline/, utils in utils/; admin routes split (admin-db, admin-downloads, admin-config, etc.).
- Frontend AR.* modules are separated by concern (dom, state, filters, explorer, charts, export, etc.); app.js orchestrates without embedding large blocks.

**Gaps or risks**

- Some API route files may approach or exceed 300 lines (e.g. public.ts, admin.ts); admin.ts in particular mounts many sub-routes and contains inline helpers—worth monitoring for refactor.
- Section-specific HTML and JS share a lot of structure; any new section (e.g. a fourth product type) would need consistent updates across HTML, ar-section-config, and API bases—no single “add a section” checklist in the reviewed docs.
- Admin export UI and API logic are spread across site/admin/exports.html and workers/api (admin-downloads, admin-download-jobs); changes require touching both.


---

## 9. Marketing / value proposition

**What was checked:** Titles, meta descriptions, schema.org, OG/twitter, about and legal copy.

**Strengths**

- Clear value in titles and descriptions: “Compare Australian Home Loan / Savings / Term Deposit Rates - Daily CDR Data | AustralianRates”; meta and OG/twitter consistent; schema.org Dataset and WebApplication with license, temporal coverage, distribution (e.g. export CSV URL).
- About page: “Independent rate tracking”, “open-source public data dashboard”, “Daily CDR-backed tracking”, “General information only”; contact and methodology set expectations.
- Legal (privacy, terms) and contact complete the trust and compliance picture.

**Gaps or risks**

- No dedicated “Why AustralianRates” or comparison to alternatives; value is implicit in product and about copy.
- Schema.org and meta could be extended (e.g. more variableMeasured or FAQ) if search/product features are prioritized—optional.


---

## 10. Cost (Workers, D1, egress)

**What was checked:** Wrangler config (no cost settings in repo), D1/R2/Queue usage patterns, caching, and egress-heavy paths.

**Strengths**

- Public GET responses use cache headers (`withPublicCache`); cursor pagination and page-size limits cap response sizes; export limit (e.g. 10k rows) bounds export cost.
- Single worker for API (no redundant workers); archive is separate and scoped to discovery/collection; test env uses separate resources so prod cost is isolated.
- No obvious “unbounded” list or export in public API; admin exports are operator-triggered and stored in R2 (bounded by job design).

**Gaps or risks**

- Cost and egress are not documented in repo; D1 read units, R2 operations, and Worker invocations depend on traffic and cron—no baseline or budget note.
- Large admin exports (operational full DB) could be heavy; R2 storage and egress scale with usage—operators should be aware.


---

## 11. Data security

**What was checked:** Admin auth (Bearer + CF Access JWT), token handling, CSP/CORS, no secrets in repo, public vs admin route separation.

**Strengths**

- Admin requires Bearer token or CF Access JWT; constant-time comparison for Bearer; JWT verified via JWKS (access-jwt.ts); `requireAdmin()` applied to all admin routes (`workers/api/src/auth/admin.ts`, `workers/api/src/routes/admin.ts`).
- CSP restricts script/style to self; CORS allows specific origins; `Authorization` and `Cf-Access-Jwt-Assertion` are allowed headers.
- No ADMIN_API_TOKEN in repo; test env uses a placeholder; secrets via wrangler secret.

**Gaps or risks**

- If CF Access is used, CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set; empty in wrangler.toml—document that admin can be used with Bearer-only or with Access.
- Public API has no rate limiting in the reviewed code; abuse could increase cost or load (mitigated by cache and pagination).

---

## 12. Visual and layout / style and design

**What was checked:** foundation.css variables, theme (dark/light), typography (Space Grotesk), shell and header, admin layout.

**Strengths**

- Design system in foundation.css: spacing and radius scale (`--ar-space-*`, `--ar-radius-*`), motion (`--ar-motion-*`), font (`--ar-font-ui`), shadows, header height, sidebar width, shell max width.
- Theming: `data-theme="dark"` and `data-theme="light"` with full token sets (bg, surface, text, accent, semantic colors); theme.js likely toggles theme.
- Consistent shell (header, main, footer) and admin sidebar width; legal and public panels use same panel and legal-hero patterns.

**Gaps or risks**

- New components could introduce one-off colors or spacing; no component-level design doc (e.g. “use --ar-* only”) beyond what’s in foundation.
- Admin and public share foundation but have separate layout CSS (admin-layout.css, public-shell.css); duplication of layout patterns is possible over time.


---

## Summary and priority actions

| Priority | Action | Where / reference |
| -------- | ------ | ----------------- |
| P0 | Add admin export **retry** for failed jobs: Retry button + `POST /admin/downloads/:jobId/retry` | site/admin/exports.html, workers/api/src/routes/admin-downloads.ts; [admin-export-critique](admin-export-critique.md) |
| P1 | Improve admin **delta cursor** UX: hint, optional “Use latest”, show **artifact metadata** (row count, size, cursor range) in job cards | site/admin/exports.html; [admin-export-critique](admin-export-critique.md) |
| P1 | **Document admin API**: error codes, HTTP usage, list/job/artifact/bundle contract, query params and limits | docs/admin-api.md or AGENTS.md |
| P1 | **Reconstruction doc**: what exports contain, no DDL, need migrations + D1 import script (+ optional R2 script); differentiate from wrangler D1 export | docs/admin-export-reconstruction.md; [admin-export-critique](admin-export-critique.md) |
| P2 | **D1 import script** (and optional R2 restore script) for admin JSONL; reference from reconstruction doc | New script under scripts/ or tools/ |
| P2 | **Document**: script load order and AR.* dependencies (site); Cloudflare limits pointer; archive worker purpose and envs; admin auth options (Bearer vs CF Access) | AGENTS.md or docs/ |
| P2 | **Accessibility**: document current coverage (skip link, ARIA), gaps (keyboard, screen-reader), and loading/error states for main flows | docs or AGENTS.md |
| P2 | **Maintainability**: monitor route file sizes (public.ts, admin.ts); add “Adding a new section” checklist; document primary breakpoint and mobile-host behavior | AGENTS.md or site README |

This critique integrates the existing [admin-export-critique.md](admin-export-critique.md) for admin export UX and API, and aligns with [MISSION_AND_TECHNICAL_SPEC.md](MISSION_AND_TECHNICAL_SPEC.md) and [USER_INTERACTION_FLOWCHART.md](USER_INTERACTION_FLOWCHART.md) for product and flow context.
