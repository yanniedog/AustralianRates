# Australian Rates: Full Project Critique and Authoritative Changes List

<!-- markdownlint-disable MD036 MD060 -->

This document is the single consolidated project critique and authoritative list of changes for the Australian Rates monorepo. It summarizes the project state across the assessed dimensions and lists every tracked change with priority, status, and source references.

**References:** [docs/site-critique.md](site-critique.md), [docs/admin-export-critique.md](admin-export-critique.md), [docs/IMPROVE_AUSTRALIANRATES_PROMPT.md](IMPROVE_AUSTRALIANRATES_PROMPT.md), [docs/site-improvement-roadmap.md](site-improvement-roadmap.md), [docs/MISSION_AND_TECHNICAL_SPEC.md](MISSION_AND_TECHNICAL_SPEC.md), AGENTS.md, .cursor/rules (fix-commit-verify, deployment, no-mock-test-data).

---

## Executive summary

- **Mission:** Collect, normalize, store, and publish comparable Australian rate data for home loans, savings, and term deposits; provide transparent public APIs and a trusted admin control plane.
- **Repo:** Monorepo with `site/` (Cloudflare Pages), `workers/api` (Hono, D1, R2, Queue, Durable Object), `workers/archive`, `docs/`, `scripts/`, and `tools/`.
- **Strengths:** Clear public/admin split, documented user flows, stable `window.AR` namespace, cache and pagination controls, real-data-only test philosophy, and explicit code-quality rules.
- **Current gaps:** Reconstruction tooling is still incomplete (missing D1 import script and optional R2 restore script); Cloudflare limits, archive-worker purpose, and admin auth modes still need better repo-level docs; `workers/api/src/routes/admin.ts` and `workers/api/src/routes/public.ts` still require refactor; no full site-wide accessibility audit yet.
- **Already done:** Admin export retry, delta cursor guidance plus persistence, artifact metadata, clearer operational bundle progress/errors, dismissible status messaging, admin export API docs, admin export reconstruction docs, and site-level notes for script order, local API override, responsive rules, accessibility notes, vendor inventory, and design rules.
- **Verification baseline (from the last full critique run):** `npm run test:homepage` (85 tests, 100% pass), `npm run test:api` (163 passed, 13 skipped), and `npm run test:archive` (4 passed). All exited `0`.

---

## 1. Full critique by dimension

For each dimension: brief strengths, brief gaps or risks, and source reference.

| Dimension | Strengths | Gaps / risks | Source |
|-----------|-----------|--------------|--------|
| **Front end** | 16+ HTML pages, shared shell, section-specific `data-ar-section` / `AR.sectionConfig`, single `window.AR` namespace, optional `?apiBase=` override, CSP/CORS configured, and `site/README.md` now covers script order, local override, responsive rules, and vendor inventory. | Many small JS entry points still create ordering risk; there is still no single dependency graph or complete vendored upgrade procedure. | site-critique section 1 |
| **UX** | Documented flows, skip link and `#main-content`, ARIA on key controls, consumer vs analyst mode, URL-synced filters, and an admin export center with retry, latest-cursor helpers, persisted delta inputs, artifact metadata, polling, and clearer bundle feedback. | No site-wide accessibility audit; chart and pivot recovery states are present but not exhaustively documented for every failure mode. | site-critique section 2; admin-export-critique section 1 |
| **Back end** | Three API bases, public/admin separation, `requireAdmin()`, cursor pagination, cache headers, export/list limits, consistent `jsonError` shape, and data model alignment with the mission. | Admin download API is documented, but there is still no D1 import or R2 restore path from admin exports; public trigger-run and historical pull remain gated/deprecated. | site-critique section 3; admin-export-critique section 2 |
| **Cloudflare** | API uses D1, R2, Queue plus DLQ, KV, and RunLock DO; cron is configured; archive has dev/prod environments; test env is isolated. | Worker/D1 limits are still not documented in repo; archive worker purpose and envs are not summarized in one doc; KV idempotency behavior remains undocumented if enabled later. | site-critique section 4 |
| **Cost** | Public GET cache, cursor pagination, export caps, single API worker, and bounded operator-triggered exports. | Cost and egress are still not documented; no baseline or budget note; operational exports can still be heavy. | site-critique section 10 |
| **Security** | Bearer or CF Access JWT admin auth, constant-time bearer compare, JWT via JWKS, `requireAdmin()` on admin routes, CSP/CORS, and no secrets in repo. | Bearer-only vs CF Access mode still needs explicit documentation; public API still has no dedicated rate limiting beyond cache/pagination. | site-critique section 11 |
| **Maintainability** | AGENTS.md and .cursor/rules enforce 300/500-line and 50-line limits, DRY, and single responsibility; API and frontend are separated by concern. | `admin.ts` and `public.ts` exceed 500 lines; no "Adding a new section" checklist exists; admin export behavior still spans both `site/` and `workers/api`. | site-critique section 8; exploration |
| **Accessibility** | Skip link, main landmark, and ARIA coverage on key controls; `site/README.md` now documents current coverage and known async-state gaps. | No full keyboard-only or screen-reader audit; focus-order regression checks remain manual. | site-critique section 2 |
| **Marketing / value** | Clear titles and meta, schema.org Dataset/WebApplication, OG/Twitter tags, and about/legal copy that set expectations. | No dedicated "Why AustralianRates" positioning page; schema could still be extended if search/product work is prioritized. | site-critique section 9 |
| **Data integrity / usefulness** | Mission alignment, canonical `product_key`, public APIs/exports, and strong admin visibility for status, runs, logs, exports, and remediation. | Exports still do not include DDL; full reconstruction still requires migrations plus an import script and optional R2 restore script. | site-critique section 7; admin-export-critique section 3 |
| **Mission alignment** | Mission and invariants are defined in `MISSION_AND_TECHNICAL_SPEC.md`; AGENTS.md and .cursor/rules enforce real-data-only tests and deploy verification. | None. | MISSION_AND_TECHNICAL_SPEC.md; AGENTS.md |

---

## 2. Code health: file sizes

Per AGENTS.md and .cursor/rules: **300 lines** = flag for review; **500+ lines** = trigger refactor.

| File | Lines | Status |
|------|-------|--------|
| `workers/api/src/routes/admin.ts` | 571 | **Over 500 - refactor required** |
| `workers/api/src/routes/public.ts` | 511 | **Over 500 - refactor required** |
| `workers/api/src/routes/admin-download-builder.ts` | 486 | Over 300 - flag for review |
| `workers/api/src/routes/admin-live-cdr-repair.ts` | 467 | Over 300 - flag for review |
| `workers/api/src/routes/td-public.ts` | 462 | Over 300 - flag for review |
| `workers/api/src/routes/savings-public.ts` | 459 | Over 300 - flag for review |

**Required change:** Refactor `admin.ts` and `public.ts` to meet the 300-line guideline. The other listed files should be monitored and reduced as needed.

**Exploration note:** No `frequent_errors.txt` was present in the working directory. No "Adding a new section" checklist existed in the reviewed docs at the time of critique consolidation.

---

## 3. Changes required: prioritized table

Single list of tracked changes. Status: **Done** = already satisfied in codebase or docs; **Not done** = still outstanding.

| Priority | One-line description | Status | File(s) / doc(s) | Source |
|----------|----------------------|--------|------------------|--------|
| P0 | Add admin export retry for failed jobs: Retry button + `POST /admin/downloads/:jobId/retry` | **Done** | `site/admin/admin-exports.js`, `site/admin/admin-exports-view.js`, `workers/api/src/routes/admin-downloads.ts` | site-critique; admin-export-critique |
| P1 | Delta cursor UX: hint for "Delta since cursor", optional "Use latest" from the section's latest completed job `end_cursor`, plus persistence/pre-fill on load | **Done** | `site/admin/exports.html`, `site/admin/admin-exports.js`, `site/admin/admin-exports-runtime.js` | site-critique; admin-export-critique; roadmap |
| P1 | Show artifact metadata in admin export UI: row count, size, cursor range per artifact in job cards | **Done** | `site/admin/admin-exports-view.js` | site-critique; admin-export-critique; roadmap |
| P1 | Document admin download API: error codes, HTTP usage, list/job/artifact/bundle contract, query params and limits | **Done** | `docs/admin-export-api.md` | site-critique; admin-export-critique; roadmap |
| P1 | Reconstruction doc: what exports contain, no DDL, need migrations plus D1 import script (and optional R2 restore), and how this differs from Wrangler D1 export | **Done** | `docs/admin-export-reconstruction.md` | site-critique; admin-export-critique; roadmap |
| P2 | D1 import script: read admin export JSONL and apply upserts to D1; reference from reconstruction doc | Not done | New script under `scripts/` or `tools/`; `docs/admin-export-reconstruction.md` | site-critique; admin-export-critique; roadmap |
| P2 | Optional R2 restore script: read canonical payload JSONL and write bodies to R2; document in reconstruction doc | Not done | New script; `docs/admin-export-reconstruction.md` | admin-export-critique; roadmap |
| P2 | Document script load order and `AR.*` dependencies for site | **Done** | `site/README.md` | site-critique; roadmap; exploration |
| P2 | Document Cloudflare limits pointer (Workers, D1, Queues) | Not done | AGENTS.md or docs | site-critique; roadmap; exploration |
| P2 | Document archive worker: purpose (discovery + collection), envs (dev/prod), main entry points | Not done | `workers/archive/README` or docs | site-critique; roadmap; exploration |
| P2 | Document admin auth options: Bearer (`ADMIN_API_TOKEN`) vs CF Access (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`) | Not done | AGENTS.md or deployment docs | site-critique; roadmap |
| P2 | Accessibility: document current coverage, known gaps, and loading/error states for main flows | **Done** | `site/README.md` | site-critique; roadmap; IMPROVE_AUSTRALIANRATES_PROMPT |
| P2 | Refactor `admin.ts` to under 300 lines | Not done | `workers/api/src/routes/admin.ts` | site-critique; roadmap; exploration |
| P2 | Refactor `public.ts` to under 300 lines | Not done | `workers/api/src/routes/public.ts` | site-critique; roadmap; exploration |
| P2 | Add "Adding a new section" checklist (HTML shell, `ar-section-config`, API base path, route wiring) | Not done | AGENTS.md or docs | site-critique; roadmap; exploration |
| P2 | Document primary breakpoint(s) and mobile-host behavior (`m.australianrates.com`) | **Done** | `site/README.md` | site-critique; roadmap; exploration |
| P2 | Local development note: use `?apiBase=` plus local API origin to hit the local API; CORS allows localhost | **Done** | `site/README.md` | roadmap |
| P2 | Operational scope UI: explain that operational backup exports the full DB and scope is fixed to all | **Done** | `site/admin/exports.html` | admin-export-critique |
| P2 | Bundle fallback: clearer error when a part fails; progress feedback for client-side concat | **Done** | `site/admin/admin-exports.js`, `site/admin/admin-exports-runtime.js`, `site/admin/admin-exports-view.js` | admin-export-critique |
| P2 | Messaging: keep clear user-facing errors and add optional dismiss control for `#exports-msg` | **Done** | `site/admin/exports.html`, `site/admin/admin-exports-runtime.js`, `site/admin/admin-exports.css` | admin-export-critique |
| P2 | Polling: document 5s interval in code or UI and indicate auto-refresh while jobs are pending | **Done** | `site/admin/admin-exports-view.js` | admin-export-critique |
| P2 | Document max `since_cursor` if needed; document `POST`/`GET`/`DELETE` params and limits in the admin API doc | Not done | `workers/api`, `docs/admin-export-api.md`, AGENTS.md | admin-export-critique |
| P2 | Cost and limits note: point to Cloudflare pricing/limits and recommend monitoring D1 reads, R2, and Worker invocations | Not done | docs or AGENTS.md | site-critique; roadmap |
| P2 | Vendor inventory: libs and versions in one place for security/compatibility | **Done** | `site/README.md` | site-critique; roadmap |
| P2 | Public API rate limiting: consider if abuse is a concern and document the decision | Not done | `workers/api`; docs | site-critique; roadmap |
| P2 | Front-end design guideline: new UI must use foundation CSS variables and avoid hard-coded colors/spacing | **Done** | `site/README.md` | site-critique; roadmap |
| P2 | Queue idempotency: if `FEATURE_QUEUE_IDEMPOTENCY_ENABLED` is enabled later, document TTL and expectations | Not done | AGENTS.md or pipeline docs | site-critique; roadmap |
| P2 | Monitor/refactor other large files: `admin-download-builder.ts`, `td-public.ts`, `savings-public.ts`, `admin-live-cdr-repair.ts`, `ar-explorer.js`, `frame.js`, `ar-filters.js`, `ar-chart-echarts.js`, `ar-public-page.js` | Not done | `workers/api/src/routes/`; `site/` | roadmap; exploration |

---

## 4. Already done (confirmed)

- **Admin export retry:** `POST /admin/downloads/:jobId/retry` exists and the admin exports UI exposes a Retry action.
- **Admin export UX follow-up:** Delta cursor hints, latest-cursor fill, browser-local cursor persistence, artifact metadata, clearer bundle fallback/progress copy, polling indicator, and dismissible status messaging are present in the admin exports UI.
- **Admin export API documentation:** `docs/admin-export-api.md` exists.
- **Admin export reconstruction documentation:** `docs/admin-export-reconstruction.md` exists and explains that DDL is not included, so full reconstruction still requires migrations plus import tooling.
- **Site implementation notes:** `site/README.md` documents script load order, local API override, responsive rules, accessibility notes, design rules, and a vendor inventory.

---

## 5. Perspectives considered

| Dimension | Coverage in critique and table |
|-----------|--------------------------------|
| **Front end** | Structure, script order, `AR.*` namespace, API base, vendor usage, CSP/CORS |
| **UX** | Ease of use, clarity, flow, admin export center (delta cursor, retry, artifact metadata, polling, messaging) |
| **Back end** | APIs, data model, pagination, caching, admin auth, error shape, validation, reconstruction |
| **Docs / maintainability** | Admin API doc, reconstruction doc, script order, archive worker, section checklist, breakpoint, local dev |
| **Security** | Admin auth (Bearer, CF Access), CSP/CORS, rate limiting consideration |
| **Cloudflare** | Workers, D1, R2, Queues, limits, cron, envs, cost/egress |
| **Accessibility** | Skip link, ARIA, keyboard/screen-reader gaps, loading/error states |
| **Marketing / value** | Titles, meta, schema.org, about, value proposition |
| **Data integrity** | Mission alignment, `product_key`, export contents, reconstruction adequacy |
| **Cost** | Cache, pagination, export caps, operational export size |
| **Visual / design** | Foundation CSS, theme, design guideline |

---

*This document consolidates `docs/site-critique.md`, `docs/admin-export-critique.md`, `docs/IMPROVE_AUSTRALIANRATES_PROMPT.md`, `docs/site-improvement-roadmap.md`, and exploration findings. Update the status column and the "Already done" section as items are completed.*
