# AustralianRates Site Improvement Roadmap

<!-- markdownlint-disable MD060 -->

## Executive summary

This roadmap is a prioritized, phased plan to improve the australianrates site (frontend, API worker, archive worker) using only items from the site critique, admin-export critique, and the codebase exploration. Main themes: **operator UX** (admin export retry, delta cursor, artifact metadata), **docs and maintainability** (admin API, reconstruction, script order, archive worker, section checklist), **code health** (refactor of oversized route and frontend files), **reconstruction/backup** (reconstruction doc, D1 import script, optional R2 script), and **optional enhancements** (accessibility doc, cost/limits, engagement polish).

---

## Phases

### Phase 1: Critical operator UX and API

| Item | One-line description | Source |
| ---- | ------------------- | ------ |
| Retry for failed jobs | Add "Retry" button in admin exports UI and `POST /admin/downloads/:jobId/retry` that requeues and continues failed jobs. | site-critique P0; admin-export P0 |
| Delta cursor UX | Add hint text for "Delta since cursor" and optional "Use latest" that pre-fills from the section's latest completed job end_cursor. | site-critique P1; admin-export P1 |
| Artifact metadata in UI | Show row count, size (humanized), and cursor range per artifact in job cards on admin exports. | site-critique P1; admin-export P1 |
| Admin API documentation | Document admin download API: error codes, HTTP usage, list/job/artifact/bundle response shapes, GET/DELETE query params and limits (e.g. docs/admin-api.md or AGENTS.md). | site-critique P1; admin-export P1 |
| Reconstruction doc | Add docs/admin-export-reconstruction.md: what each export stream contains, that DDL is not included, and that full reconstruction requires migrations + D1 import script + optional R2 script; differentiate from wrangler D1 export. | site-critique P1; admin-export P1 |

### Phase 2: Docs and reconstruction tooling

| Item | One-line description | Source |
| ---- | ------------------- | ------ |
| D1 import script | Add a script (e.g. under scripts/ or tools/) that applies operational (or canonical/optimized) JSONL to an existing D1 schema; reference from reconstruction doc. | site-critique P2; admin-export 4.4 |
| Optional R2 restore script | If R2 restore is required, add a script that reads canonical payload JSONL and writes bodies to R2; document in reconstruction doc. | admin-export 4.4 |
| Script load order and AR.* dependencies | Document script load order and AR.* module dependencies in site/ (README or AGENTS.md) so new pages and scripts stay consistent. | site-critique P2; exploration |
| Cloudflare limits note | Add a short "Cloudflare limits" note to AGENTS.md or docs pointing to Workers/D1/Queues limit pages; recommend checking before heavy batch/export endpoints. | site-critique P2; exploration |
| Archive worker doc | Document archive worker: purpose (discovery + collection), envs (dev/prod), main entry points (e.g. workers/archive/README or docs). | site-critique P2; exploration |
| Admin auth options | Document admin auth: Bearer (ADMIN_API_TOKEN) and/or CF Access (CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD) in AGENTS.md or deployment docs. | site-critique P2 (security) |
| Breakpoint and mobile-host | Document primary breakpoint(s) (e.g. 760px) and mobile-host behavior; note how m.australianrates.com is served if applicable. | site-critique P2; exploration |
| Local development note | Add short note: to hit local API use e.g. `?apiBase=http://localhost:8787/...` and ensure CORS allows it. | site-critique (front end) |

### Phase 3: Code health and refactor

| Item | One-line description | Source |
| ---- | ------------------- | ------ |
| Refactor public.ts | Reduce workers/api/src/routes/public.ts (reported ~550 lines); extract helpers or sub-routes to meet 300-line guideline. | site-critique P2; exploration |
| Refactor admin.ts | Reduce workers/api/src/routes/admin.ts (reported ~618 lines); extract helpers or sub-routes to meet 300-line guideline. | site-critique P2; exploration |
| Refactor ar-explorer.js | Reduce site/ar-explorer.js (reported ~1224 lines); split by concern or extract modules to improve maintainability. | exploration |
| Other large frontend files | Periodically check and refactor as needed: frame.js, ar-filters.js, ar-chart-echarts.js, ar-public-page.js, admin-download-builder.ts, admin-live-cdr-repair.ts, etc. | exploration |
| "Adding a new section" checklist | Add a short checklist: HTML shell, ar-section-config, API base path, wrangler route, public routes registration. | site-critique P2 |

### Phase 4: Optional enhancements

| Item | One-line description | Source |
| ---- | ------------------- | ------ |
| Accessibility subsection | Add docs (or AGENTS.md): what's done (skip link, ARIA on key controls) and what's not (full keyboard nav, screen-reader testing); ensure loading/error states for main flows are documented. | site-critique P2 |
| Cost and limits note | Add short "Cost and limits" note: point to Cloudflare pricing/limits; recommend monitoring D1 reads, R2, Worker invocations; mention operational export size in reconstruction doc. | site-critique P2; exploration |
| Vendor inventory | Consider a simple inventory of vendor libs and versions (e.g. in docs or package.json) for security and compatibility. | site-critique (front end); exploration |
| Public API rate limiting | If abuse becomes a concern, consider rate limiting or additional caching at edge; document in security or ops docs. | site-critique (security); exploration |
| Admin export UX polish | Optional: operational scope hint or remove disabled control; clearer errors or progress for client-side bundle concat; optional "Dismiss" for message; optional "Auto-refreshing" polling indicator. | admin-export P2 |
| Front-end design guideline | State in AGENTS.md or short doc that new UI should use foundation CSS variables and avoid hard-coded colors/spacing. | site-critique (visual) |
| Queue idempotency | If queue idempotency is enabled later, document TTL and expectations in AGENTS.md or pipeline docs. | site-critique (Cloudflare) |

---

## Dependencies

- **Admin API doc** should be written before or with the retry endpoint so the retry contract (POST /admin/downloads/:jobId/retry, 202, statusBody, 400 when not failed) is documented in one place.
- **Reconstruction doc** should be in place before or with the D1 import script so the script is referenced and its role (apply JSONL to existing schema) is clear.
- Refactor work (Phase 3) does not block Phase 1 or 2; it can proceed in parallel once priorities are clear.

---

## Perspectives considered

| Dimension | Roadmap mapping |
| --------- | ---------------- |
| **UX** | Phase 1: retry, delta cursor, artifact metadata. Phase 4: optional export UX polish. |
| **Backend** | Phase 1: retry API, admin API doc. Phase 3: public.ts, admin.ts refactor. |
| **Docs / maintainability** | Phase 1: admin API doc, reconstruction doc. Phase 2: script order, archive worker, auth, breakpoint, local dev. Phase 3: "Adding a section" checklist. |
| **Security** | Phase 2: admin auth options doc. Phase 4: optional public API rate-limiting note. |
| **Cloudflare** | Phase 2: Cloudflare limits note. Phase 4: queue idempotency doc if enabled. |
| **Front end** | Phase 2: script load order, breakpoint/mobile-host, local dev. Phase 3: ar-explorer.js and other large site JS. Phase 4: foundation/design guideline. |
| **Cost** | Phase 4: cost/limits note, operational export size in reconstruction context. |
| **Visual / design** | Phase 4: foundation CSS and design guideline. |

All items trace to docs/site-critique.md, docs/admin-export-critique.md, or the exploration report; no new feature ideas were added.
