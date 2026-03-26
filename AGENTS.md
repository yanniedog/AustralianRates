# Australian Rates Project Configuration

Australian Rates is a monorepo with a static frontend (Cloudflare Pages) and two Workers (API, archive).

## Hard Enforcement Rules (Must Always Be Followed)

These rules are mandatory and override any conflicting preference.

1. Before claiming any deploy-related task is complete, run from repo root:
   - `npm run test:homepage`
   - `npm run test:api`
   - `npm run test:archive`
2. If any command exits non-zero:
   - Do not mark the task complete.
   - Fix the failure, redeploy the affected subproject, and rerun the failing test(s).
   - Repeat until all commands exit `0`.
3. In the final response for deploy-related tasks, include evidence:
   - Exact commands run.
   - Exit codes.
   - Brief pass/fail summary.
4. Deploy or production-impacting changes are not complete unless all required checks pass or the user explicitly instructs to skip checks.
5. Never present assumptions as verification.
   - If a check was not run, state it was not run.

## Production and Hosting

- **Production URL**: https://www.australianrates.com
- **Hosting model**: Cloudflare Pages (frontend), Cloudflare Workers for API and archive (see docs/CLOUDFLARE_USAGE.md).

## Repo-Level Commands

| Purpose | Command | Notes |
|--------|---------|------|
| Test homepage (production URL) | `npm run test:homepage` | From repo root. Playwright. |
| Start browser-agent MCP (stdio) | `npm run browser-agent` | From repo root. Requires sibling repo `../browser-agent`. Cursor normally spawns this via `.cursor/mcp.json`; use this for manual smoke tests. |
| Test API worker | `npm run test:api` | From repo root. |
| Test archive worker | `npm run test:archive` | From repo root. |
| Typecheck API | `npm run typecheck:api` | From repo root. |
| Diagnose API (production) | `node diagnose-api.js` | From repo root. Optional base URL. |
| Deploy API | `npm run deploy:api` | Wrangler deploy for workers/api. |
| Deploy archive | `npm run deploy:archive` | Wrangler deploy for workers/archive. |

## Subproject: workers/api

- **Typecheck**: `npm run typecheck:api` from root.
- **Test**: `npm run test:api` from root.
- **Deploy**: `npm run deploy:api` from root. Requires D1, R2, Queues, Durable Object; migrations; secrets.

## Subproject: workers/archive

- **Test**: `npm run test:archive` from root.
- **Deploy**: `npm run deploy:archive` from root. Dev and prod workers per wrangler config.

## Deployment Verification Checklist

- All relevant tests pass before deploy: `npm run test:api`, `npm run test:archive`, `npm run test:homepage`.
- No console errors on production (www.australianrates.com).
- Critical flows: homepage loads, API health/endpoints respond.
- D1 migrations applied when changing API or archive schema.

## Fix-Redeploy-Retry

- If any check fails, fix the cause, redeploy the affected part, then re-run the relevant test(s).
- **Pages (frontend)**: Deploy via Cloudflare Pages (e.g. git push). No script in repo.
- **API**: `npm run deploy:api` from root.
- **Archive**: `npm run deploy:archive` from root.

## Longitudinal product identity

- **product_key** is the canonical identity for linking rates over time for the same product. It is defined as `bank_name|product_id|security_purpose|repayment_type|lvr_tier|rate_structure`. Any chart or export that shows rate over time must group or filter by `product_key` so each series is one specific product tracked longitudinally.

## Chart and pivot cache (fast loads)

- **Goal:** Charts and pivot tables load almost instantly by serving from a slim precomputed layer instead of scanning the full raw DB on every request.
- **D1 table:** `chart_pivot_cache` (migration 0030) holds one row per (section, representation) with JSON payload for the default slice (last 365 days, no filters). Refreshed every 15 min by the same cron as site health (`*/15 * * * *`).
- **API behaviour:** `GET /analytics/series` and `POST /analytics/pivot` try (1) optional KV cache by request key, (2) D1 cache when the request matches default filters, (3) live collect from analytics/canonical DB. All responses set `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`.
- **Non-stale:** Cron keeps the D1 cache updated; optional `CHART_CACHE_KV` (see types) can cache any response for 5 min. Apply migration 0030 before or after deploy so the table exists.

## Project Philosophy: Real Data Only

Tests and tooling must not use mock or simulated data. This is project philosophy and a hard rule.

- **Philosophy:** We test against real data so that passing tests indicate the system works in production. Fake rows, stubbed APIs, and in-memory fake databases validate behavior in an artificial world and can hide real-world failures.
- **Principle:** All test data must be real. Use real D1 (e.g. vitest-pool-workers with migrations), real API responses, or fixture files captured from production or real ingest runs. Pure unit tests that only use literal inputs (e.g. parsing a string) are fine; any business data in tests must come from a real source.
- **Hard rule:** No mock or simulated data in tests. Do not use makeMockD1, vi.mock with mockResolvedValue of business data, stub fetch returning fake JSON, or hand-crafted row/response objects. Tests that require real D1/Queue/API should move to integration or become `it.todo(...)` placeholders until real bindings or real-data fixtures exist; they must not be implemented with mocks.

See docs/MISSION_AND_TECHNICAL_SPEC.md (Project Philosophy: Real Data Only) and .cursor/rules/no-mock-test-data.mdc.

## Code Quality Standards

- **Max file size**: 300 lines (flag for review), 500+ lines (trigger refactor).
- **Max function size**: 50 lines.
- **DRY**: No duplicate code across 3+ locations.
- **Modularity**: Single responsibility per file/function.

## Files and Directories That Should NOT Be Refactored

- Build/config: `vite.config.*`, `tsconfig.json`, `wrangler.toml`, `vitest.config.*`.
- Generated: Database migrations, `node_modules`, build output.
- Config: `.env`, `.env.local`, `package.json`.
- Single-purpose entry points: `main.ts`, `index.ts` when they only bootstrap or re-export.

## Cursor Cloud specific instructions

### Services overview

| Service | Dev command | Port | Notes |
|---------|-----------|------|-------|
| API Worker | `npm run dev:api` (from root) | 8787 | Wrangler emulates D1/R2/Queue/DO locally |
| Archive Worker | `npm run dev:archive` (from root) | 8786 | Independent; not needed for main frontend |
| Frontend | `npx wrangler pages dev site/ --port 8788` | 8788 | Static files, no build step |

### Running locally

- The API worker dev server (`wrangler dev --test-scheduled`) creates a local D1 database file automatically on first run, but **migrations are not auto-applied**. Run `npx wrangler d1 migrations apply australianrates_api --local` from `workers/api/` before using API endpoints that touch the database (e.g. `/filters`, `/latest`, scheduled triggers). Without this, those endpoints fail with "no such table" errors.
- The frontend is plain HTML/CSS/JS in `site/` -- no bundler, no build step. Serve it with any static server or `wrangler pages dev`.
- The frontend talks to the **production** API (`https://www.australianrates.com`) by default, not localhost. To test against the local API, you would need to modify the API base URL in the frontend JS files.
- Copy `workers/api/.dev.vars.example` to `workers/api/.dev.vars` before running `npm run dev:api`. The `ADMIN_API_TOKEN` secret is required for admin endpoints but the dev server starts without it.

### Testing

- `npm run test:api` and `npm run test:archive` run vitest unit/integration tests (no network or Cloudflare account needed).
- `npm run typecheck:api` runs TypeScript type checking on the API worker.
- `npm run test:homepage` runs Playwright E2E tests against the **production** URL and requires network access.
- Playwright needs Chromium installed (`npx playwright install --with-deps chromium`).

### Browser-agent MCP (interactive UX audits)

For **agent-driven** UX (navigate/click/screenshot/trace) with the canonical tool contract, use the **browser-agent** sibling repo (local path typically `../browser-agent` next to this repo).

1. **One-time in `browser-agent`:** `npm install` and `npx playwright install` (Chromium, Firefox, WebKit if you replay cross-engine).
2. **Cursor:** Project file `.cursor/mcp.json` registers MCP alias **`browser_agent_cursor`** (stdio server). If `${workspaceFolder}/../browser-agent` is wrong on your machine, fix `cwd`/`args` to your `browser-agent` checkout. Reload MCP after changes.
3. **Policy manifest:** Repo root **`browser-agent.manifest.json`** — allowlist hosts and `projectId` **`australianrates`**. When calling `session_create`, set `manifestPath` to a path readable from the browser-agent process cwd (e.g. `../australianrates/browser-agent.manifest.json` when cwd is `browser-agent`).
4. **Tool order:** Follow [browser-agent `cursor-adapter.md`](../browser-agent/cursor-adapter.md): `session_create` → `trace_start` → actions → milestone screenshots → on failure bundle → `trace_stop` → `session_close`. Use **`/ux_cursor`** prompt pack in `../browser-agent/cursor-ux-skill.md` and shared steps in `../browser-agent/ux-browser-runbook.md`.
5. **Verification:** Prefer production-only checks per workspace rules (`npm run test:homepage`, etc.). Browser-agent complements them; it does not replace them for deploy sign-off.

### Debugging and production logfiles

When debugging code anywhere on the site (front end, API worker, archive worker, or Cloudflare), **try to access the production logfiles** to gather real errors, warnings, and context. Use the logs API with credentials from the repo root `.env`:

- **Fresh copy every run. No exceptions.** Always fetch a **fresh copy** of the logfile from the production API for each run. Never use a stale or local logfile. Never read from local files such as `errors.jsonl`, `warn.jsonl`, or `actionable.json`; if they exist, they are stale. Run `node fetch-production-logs.js` from repo root (with `ADMIN_API_TOKEN` in `.env`) or call the logs API directly every time you need logs.
- **Delete after use.** If you save fetched logs to local files (e.g. by redirecting script output), delete those files after processing and/or after issues have been fixed. Do not leave ephemeral log copies in the repo. (See `.gitignore` for `errors.jsonl`, `warn.jsonl`, `actionable.json`.)
- **Endpoint:** `GET https://www.australianrates.com/api/home-loan-rates/admin/logs/system`
- **Auth:** `Authorization: Bearer <ADMIN_API_TOKEN>` (set `ADMIN_API_TOKEN` in repo root `.env`; see `.env.example`).
- **Query params:** `format=jsonl` or `format=text`, `limit=1000` (max 10000), `level=error` or `level=warn`, `source=...`, `code=...`, `offset=...`.
- **Stats:** `GET .../admin/logs/system/stats` (same auth) for row count and latest timestamp.
- **Actionable issues:** `GET .../admin/logs/system/actionable` (same auth) for grouped operational issues.
- **Status debug bundle (E2E triage):** `GET https://www.australianrates.com/api/home-loan-rates/admin/diagnostics/status-debug-bundle` (same Bearer auth) returns one JSON document aggregating health history, problem logs (optional `since`, `log_limit`, `log_hours_before_health`), CDR audit, coverage gaps, lender universe, replay queue, probe fetch-events, diagnostics backlog, optional inlined probe payloads (`include_probe_payloads=1`, capped), and a `remediation.hints` array with suggested `POST`/`GET` paths and bodies pointing at existing admin routes (suggestions only). Narrow with `sections=health,logs,...`. From repo root: `npm run fetch-status-debug-bundle` or `node fetch-status-debug-bundle.js --out=bundle.json`. The admin **Status** page includes **Download debug bundle (JSON)** and **Copy debug bundle curl**.
- **Doctor (one-shot production prelude):** `npm run doctor` runs `diagnose-api`, then admin log **stats** + **actionable** with **`--fail-on-actionable`** (exits **1** if the actionable endpoint returns any issue groups). Then a **full** `status-debug-bundle` fetch to repo-root **`status-debug-bundle-latest.json`** (gitignored; stale file removed before fetch) plus a short console summary. Use `node doctor.js --skip-bundle` to omit the bundle fetch; use `node doctor.js --tolerate-actionable` for signal-only (exit 0 even when actionable has issues). Log **stats** `count` is total rows in the error log store, not “new failures.” After you fix and deploy: `npm run doctor:verify` runs doctor plus `test:api`, `test:archive`, and `test:homepage` against production. Cursor: **/doctor** command and `.cursor/skills/doctor/SKILL.md` instruct the agent to read the bundle file during triage and follow elite-debugger fix–verify.

Ensure `.env` contains `ADMIN_API_TOKEN` (or `ADMIN_API_TOKENS`) so that scripts and agents can fetch logs. If a variable is missing, add it (see `.env.example` for names and comments).

### Gotchas

- The archive worker uses `vitest.config.mts` with `@cloudflare/vitest-pool-workers`, while the API worker uses plain vitest with no config file (defaults).
- The archive worker's `wrangler.jsonc` has `dev` and `prod` environments; the default `npm run dev:archive` uses the dev environment.
- `npm run test:homepage` hits the **production** URL, which has Cloudflare bot challenge enabled. This test will fail from headless cloud VMs that cannot solve the challenge. It works from local developer machines with a real browser.
- **Headless console noise:** In headless Playwright (e.g. test:homepage, test:table-errors, beta-test-capture-log), the console often shows `Failed to load resource: net::ERR_NAME_NOT_RESOLVED` and `404` from Clarity/Cloudflare Insights. These are expected (telemetry scripts cannot resolve in headless) and are ignored in test assertions; do not treat them as site failures.
