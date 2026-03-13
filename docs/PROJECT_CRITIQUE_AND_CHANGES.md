# Australian Rates: Full Project Critique and Authoritative Changes List

<!-- markdownlint-disable MD036 MD060 -->

This document is the **single consolidated project critique** and **authoritative list of changes** for the Australian Rates monorepo. It summarizes the project state across all assessed dimensions and lists every change that needs to be made (or has been completed), with priority, status, and source references.

**References:** [docs/site-critique.md](site-critique.md), [docs/admin-export-critique.md](admin-export-critique.md), [docs/IMPROVE_AUSTRALIANRATES_PROMPT.md](IMPROVE_AUSTRALIANRATES_PROMPT.md), [docs/site-improvement-roadmap.md](site-improvement-roadmap.md), [docs/MISSION_AND_TECHNICAL_SPEC.md](MISSION_AND_TECHNICAL_SPEC.md), AGENTS.md, .cursor/rules (fix-commit-verify, deployment, no-mock-test-data).

---

## Executive summary

- **Mission:** Collect, normalize, store, and publish comparable Australian rate data for home loans, savings, and term deposits; transparent public APIs and admin control plane (MISSION_AND_TECHNICAL_SPEC).
- **Repo:** Monorepo with `site/` (Cloudflare Pages), `workers/api` (Hono, D1, R2, Queue, Durable Object), `workers/archive`, `docs/`, `scripts/`, `tools/`.
- **Strengths:** Clear separation of public vs admin APIs, documented user flows, AR.* namespace, cache and pagination, admin auth (Bearer + CF Access JWT), real-data-only test philosophy, code quality rules (300/500-line limits, DRY).
- **Gaps:** Admin export delta cursor UX and artifact metadata in UI; documentation (script order, Cloudflare limits, archive worker, admin auth options, accessibility); reconstruction tooling (D1 import script, optional R2 script); code health (admin.ts and public.ts exceed 500 lines and require refactor).
- **Already done:** Admin export retry (API `POST /admin/downloads/:jobId/retry` + Retry button in admin exports UI); docs/admin-export-api.md and docs/admin-export-reconstruction.md exist.
- **Verification baseline (as of last full critique run):** `npm run test:homepage` (85 tests, 100% pass), `npm run test:api` (163 passed, 13 skipped), `npm run test:archive` (4 passed). All exit 0.

---

## 1. Full critique by dimension

For each dimension: brief strengths, brief gaps/risks, and source critique reference.

| Dimension | Strengths | Gaps / risks | Source |
|-----------|------------|--------------|--------|
| **Front end** | 16+ HTML pages, shared shell, section-specific `data-ar-section` / `AR.sectionConfig`; single `window.AR` namespace; API base from origin + optional `?apiBase=`; CSP/CORS configured. | Many small JS entry points, no single bundle/dependency map; frontend talks to production API by default; vendor version pinning/upgrade path not documented in one place. | site-critique §1 |
| **UX** | Documented flows (USER_INTERACTION_FLOWCHART); skip link and `#main-content`; ARIA on filters, tabs, mobile nav; consumer vs analyst mode; URL-synced filters; admin export center with polling while pending. | Delta cursor discoverability and persistence weak; artifact metadata (row count, size, cursor range) not shown in UI; no site-wide accessibility audit; chart/pivot loading/error recovery not fully documented. | site-critique §2; admin-export-critique §1 |
| **Back end** | Three API bases (home-loans, savings, term-deposits); public vs admin separation; admin `requireAdmin()`; cursor pagination, cache headers, export/list limits; consistent `jsonError` shape; data model aligned with mission. | Admin download API contract and error codes not fully documented in one place; validation limits in code but not single API doc; no D1 import or R2 restore path from admin exports; public trigger-run/historical pull gated/deprecated. | site-critique §3; admin-export-critique §2 |
| **Cloudflare** | API: D1, R2, ingest queue + DLQ, KV, RunLock DO; cron (rate check 6h, wayback/health 15 min); archive dev vs prod envs; test env isolated. | Worker/D1 limits not documented in repo; archive worker purpose and envs not summarized in one doc; KV idempotency (when enabled) TTL/behavior not documented. | site-critique §4 |
| **Cost** | Public GET cache; cursor pagination and page-size limits; 10k export cap; single API worker; admin exports operator-triggered, R2 bounded by job design. | Cost/egress not documented; no baseline or budget note; large operational exports can be heavy. | site-critique §10 |
| **Security** | Admin: Bearer or CF Access JWT; constant-time Bearer compare; JWT via JWKS; `requireAdmin()` on all admin routes; CSP/CORS; no secrets in repo. | CF Access (CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD) empty in wrangler—document Bearer-only vs Access; public API has no rate limiting (mitigated by cache/pagination). | site-critique §11 |
| **Maintainability** | AGENTS.md and .cursor/rules enforce 300/500-line and 50-line function limits, DRY, single responsibility; API modular (routes by domain, auth/, db/, pipeline/, utils/); frontend AR.* by concern. | admin.ts and public.ts exceed 500 lines (refactor required); no "Adding a new section" checklist; section-specific HTML/JS share structure—new section needs consistent updates; admin export logic spread across site and workers/api. | site-critique §8; exploration |
| **Accessibility** | Skip link, main landmark; ARIA (aria-label, aria-hidden, aria-selected, aria-invalid, aria-pressed) on key controls. | No site-wide audit (focus order, keyboard-only, screen-reader); coverage not systematically documented; loading/error states for main flows not fully documented. | site-critique §2 |
| **Marketing / value** | Clear titles and meta; schema.org Dataset/WebApplication; OG/twitter; about and legal copy set expectations. | No dedicated "Why AustralianRates" or comparison to alternatives; schema could be extended (e.g. variableMeasured, FAQ) if prioritized. | site-critique §9 |
| **Data integrity / usefulness** | Mission alignment; product_key longitudinal identity; public APIs and exports; admin status, runs, logs, exports, remediation, CDR audit, live CDR repair. | Exports do not include DDL; full reconstruction requires migrations + import script (and optional R2 script)—documented in admin-export-reconstruction.md; public historical pull/trigger-run intentionally limited. | site-critique §7; admin-export-critique §3 |
| **Mission alignment** | Mission and invariants (product_key, collection_date, run_source, public API from D1, real data in tests) defined in MISSION_AND_TECHNICAL_SPEC; AGENTS.md and .cursor/rules enforce real-data-only and deploy verification. | None; development alignment rule is clear. | MISSION_AND_TECHNICAL_SPEC; AGENTS.md |

---

## 2. Code health: file sizes

Per AGENTS.md and .cursor/rules: **300 lines** = flag for review; **500+ lines** = trigger refactor.

| File | Lines | Status |
|------|-------|--------|
| workers/api/src/routes/admin.ts | 571 | **Over 500 — refactor required** |
| workers/api/src/routes/public.ts | 511 | **Over 500 — refactor required** |
| workers/api/src/routes/admin-download-builder.ts | 486 | Over 300 — flag for review |
| workers/api/src/routes/admin-live-cdr-repair.ts | 467 | Over 300 — flag for review |
| workers/api/src/routes/td-public.ts | 462 | Over 300 — flag for review |
| workers/api/src/routes/savings-public.ts | 459 | Over 300 — flag for review |

**Required change:** Refactor `admin.ts` and `public.ts` (extract helpers or sub-routes) to meet the 300-line guideline. Other listed files should be monitored and refactored as needed.

**Exploration note:** No `frequent_errors.txt` in the working directory. No "Adding a new section" checklist exists yet in the reviewed docs.

---

## 3. Changes required: prioritized table

Single list of every change. Status: **Done** = already satisfied in codebase or docs; **Not done** = outstanding.

| Priority | One-line description | Status | File(s) / doc(s) | Source |
|----------|------------------------|--------|-------------------|--------|
| P0 | Add admin export retry for failed jobs: Retry button + POST /admin/downloads/:jobId/retry | **Done** | site/admin (admin-exports.js, admin-exports-view.js), workers/api/src/routes/admin-downloads.ts | site-critique; admin-export-critique |
| P1 | Delta cursor UX: hint for "Delta since cursor", optional "Use latest" from section's latest completed job end_cursor; optionally persist/pre-fill on load | Not done | site/admin/exports.html (labels/hints, JS) | site-critique; admin-export-critique; roadmap |
| P1 | Show artifact metadata in admin export UI: row count, size (humanized), cursor range per artifact in job cards | Not done | site/admin/exports.html (renderJobs, artifact list) | site-critique; admin-export-critique; roadmap |
| P1 | Document admin download API: error codes, HTTP usage, list/job/artifact/bundle contract, query params and limits | **Done** | docs/admin-export-api.md (exists) | site-critique; admin-export-critique; roadmap |
| P1 | Reconstruction doc: what exports contain, no DDL, need migrations + D1 import script (+ optional R2); differentiate from wrangler D1 export | **Done** | docs/admin-export-reconstruction.md (exists) | site-critique; admin-export-critique; roadmap |
| P2 | D1 import script: read admin export JSONL (operational or canonical/optimized) and apply upserts to D1; reference from reconstruction doc | Not done | New script under scripts/ or tools/; docs/admin-export-reconstruction.md | site-critique; admin-export-critique; roadmap |
| P2 | Optional R2 restore script: read canonical payload JSONL, write bodies to R2; document in reconstruction doc | Not done | New script; docs/admin-export-reconstruction.md | admin-export-critique; roadmap |
| P2 | Document script load order and AR.* dependencies for site | Not done | AGENTS.md or docs/ or site README | site-critique; roadmap; exploration |
| P2 | Document Cloudflare limits pointer (Workers, D1, Queues) | Not done | AGENTS.md or docs/ | site-critique; roadmap; exploration |
| P2 | Document archive worker: purpose (discovery + collection), envs (dev/prod), main entry points | Not done | workers/archive README or docs/ | site-critique; roadmap; exploration |
| P2 | Document admin auth options: Bearer (ADMIN_API_TOKEN) vs CF Access (CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD) | Not done | AGENTS.md or deployment docs | site-critique; roadmap |
| P2 | Accessibility: document current coverage (skip link, ARIA), gaps (keyboard, screen-reader), loading/error states for main flows | Not done | docs/ or AGENTS.md | site-critique; roadmap; IMPROVE_AUSTRALIANRATES_PROMPT |
| P2 | Refactor admin.ts: reduce to &lt;300 lines (extract helpers or sub-routes) | Not done | workers/api/src/routes/admin.ts | site-critique; roadmap; exploration |
| P2 | Refactor public.ts: reduce to &lt;300 lines (extract helpers or sub-routes) | Not done | workers/api/src/routes/public.ts | site-critique; roadmap; exploration |
| P2 | Add "Adding a new section" checklist (HTML shell, ar-section-config, API base path, wrangler route, public routes) | Not done | AGENTS.md or docs/ | site-critique; roadmap; exploration |
| P2 | Document primary breakpoint(s) (e.g. 760px) and mobile-host behavior (`m.australianrates.com`) | Not done | AGENTS.md or site README | site-critique; roadmap; exploration |
| P2 | Local development note: use `?apiBase=` and local API origin (e.g. localhost:8787) to hit local API; CORS allows localhost | Not done | AGENTS.md or docs/ (AGENTS.md already notes frontend talks to production by default) | roadmap |
| P2 | Operational scope UI: hint or remove disabled scope control; note "Operational backup exports full DB; scope fixed to all" | Not done | site/admin/exports.html | admin-export-critique |
| P2 | Bundle fallback: clearer error when a part fails; optional progress ("Downloading part 2 of N...") for client concat | Not done | site/admin/exports.html (downloadOperationalBundle) | admin-export-critique |
| P2 | Messaging: ensure error paths use clear user-facing strings; optional "Dismiss" for #exports-msg | Not done | site/admin/exports.html | admin-export-critique |
| P2 | Polling: document 5s interval in code or UI; optional "Auto-refreshing every 5s" indicator when pollTimer set | Not done | site/admin/exports.html | admin-export-critique |
| P2 | Document max since_cursor if needed; document POST/GET/DELETE params and limits in admin API doc | Not done | workers/api (validation); docs/admin-export-api.md or AGENTS.md | admin-export-critique |
| P2 | Cost and limits note: point to Cloudflare pricing/limits; recommend monitoring D1 reads, R2, Worker invocations | Not done | docs/ or AGENTS.md | site-critique; roadmap |
| P2 | Vendor inventory: libs and versions in one place (docs or package.json) for security/compatibility | Not done | docs/ or package.json | site-critique; roadmap |
| P2 | Public API rate limiting: consider if abuse is a concern; document in security/ops docs | Not done | workers/api; docs/ | site-critique; roadmap |
| P2 | Front-end design guideline: new UI must use foundation CSS variables; avoid hard-coded colors/spacing | Not done | AGENTS.md or short doc | site-critique; roadmap |
| P2 | Queue idempotency: if FEATURE_QUEUE_IDEMPOTENCY_ENABLED enabled later, document TTL and expectations | Not done | AGENTS.md or pipeline docs | site-critique; roadmap |
| P2 | Monitor/refactor other large files: admin-download-builder.ts, td-public.ts, savings-public.ts, admin-live-cdr-repair.ts, ar-explorer.js, frame.js, ar-filters.js, ar-chart-echarts.js, ar-public-page.js | Not done | workers/api/src/routes/; site/ | roadmap; exploration |

---

## 4. Already done (confirmed)

- **Admin export retry:** API endpoint `POST /admin/downloads/:jobId/retry` (workers/api/src/routes/admin-downloads.ts) and Retry button in admin exports UI (site/admin/admin-exports.js, admin-exports-view.js). Requeue and continue flow implemented.
- **Admin export API documentation:** docs/admin-export-api.md exists.
- **Admin export reconstruction documentation:** docs/admin-export-reconstruction.md exists; describes what each stream contains, that DDL is not included, and that full reconstruction requires migrations + D1 import script + optional R2 script; differentiates from wrangler D1 export.

---

## 5. Perspectives considered

The full critique and this changes list were derived from the following expertise dimensions:

| Dimension | Coverage in critique and table |
|-----------|---------------------------------|
| **Front end** | Structure, script order, AR.* namespace, API base, vendor usage, CSP/CORS |
| **UX** | Ease of use, clarity, flow, admin export center (delta cursor, retry, artifact metadata, polling, messaging) |
| **Back end** | APIs, data model, pagination, caching, admin auth, error shape, validation, reconstruction |
| **Docs / maintainability** | Admin API doc, reconstruction doc, script order, archive worker, section checklist, breakpoint, local dev |
| **Security** | Admin auth (Bearer, CF Access), CSP/CORS, rate limiting consideration |
| **Cloudflare** | Workers, D1, R2, Queues, limits, cron, envs, cost/egress |
| **Accessibility** | Skip link, ARIA, keyboard/screen-reader gaps, loading/error states |
| **Marketing / value** | Titles, meta, schema.org, about, value proposition |
| **Data integrity** | Mission alignment, product_key, export contents, reconstruction adequacy |
| **Cost** | Cache, pagination, export caps, operational export size |
| **Visual / design** | Foundation CSS, theme, design guideline |

---

*This document consolidates docs/site-critique.md, docs/admin-export-critique.md, docs/IMPROVE_AUSTRALIANRATES_PROMPT.md, docs/site-improvement-roadmap.md, and exploration findings. Update the "Status" column and "Already done" section as items are completed.*
