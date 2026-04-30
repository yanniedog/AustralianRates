# Australian Rates Project Configuration

Australian Rates is a monorepo with a static frontend (Cloudflare Pages) and two Workers (API, archive).

## Ship bar (do not say “done” until every step)

**Green `ci_result` / green CI alone must never be described as merge-ready, shipped, safe for users, or “production updated.”** Passing required checks does not authorize merge, auto-merge enablement, or task completion language.

When this repository changes and the goal is to land work on production, complete **all** of the following **in order** unless the user **explicitly waives** a step in writing:

1. **Branch** — Fresh branch from `origin/main` (see below); no direct pushes to `main` unless the user explicitly requests a `main` hotfix.
2. **Commit and push** — Changes stay on that branch; push to `origin`.
3. **Pull request** — Open (or update) a PR into `main`.
4. **CI** — Required checks green (`ci_result`); fix forward on the branch until green.
5. **Wait gate** — After CI is green: late-review sweep **and** ~10–15 minute wait/re-poll (unless waived); automated reviewers often arrive **after** Actions finish.
6. **Threaded closure** — Reply **in-thread** on GitHub for every substantive bot and human review thread (implemented / deferred / declined with reason).
7. **Merge** — Squash-merge (or merge per repo policy) **only after** steps 5–6; **do not** enable squash auto-merge until the wait gate and threaded replies are complete so CI cannot merge early.
8. **Deploy confirmation** — Confirm Cloudflare Pages and/or Workers deploys **finished** for whatever changed; a successful `git push` or landing on `main` is **not** proof.
9. **Production verify** — Run the repo verification commands (default: `npm run verify:prod -- --scope=auto --depth=smoke`; broader scope when required) against **https://www.australianrates.com**; the final assistant message must state **exact commands, exit codes, and pass/fail**—or that verification was waived or blocked.

If the current environment cannot run a step (auth, permissions, time, blocked runners), **say so plainly** and list **remaining** steps—do **not** imply the ship bar is cleared.

Detail and pointers: **Hard Enforcement Rules** below; **`.cursor/rules/git-pr-workflow-default.mdc`** (Bot feedback wait gate); **`docs/CONCURRENT_AGENT_WORKFLOW.md`** (CI vs PR review bots).

## Hard Enforcement Rules (Must Always Be Followed)

These rules are mandatory and override any conflicting preference.

### Mandatory closeout (every chat with repo changes)

**MUST ALWAYS** (any assistant, any chat about this repo): after making changes, **commit and push**; **confirm deployment and CI completed successfully** and fix any failures until green; then **confirm the intended result on https://www.australianrates.com** using the commands below—not push alone. Applies to **every** conversation unless the user explicitly waives commit, push, deploy, or production verification. Cursor rule: `.cursor/rules/every-chat-commit-deploy-verify-production.mdc`.

### Multiagent workflow and modular code

This repo has multiple concurrent agents working in parallel. Every agent MUST:

- **Always branch off fresh `origin/main`** with a **distinctive slug** (include the session topic plus a short nonce like `-kj1` if the topic is generic) — never reuse another agent's in-flight branch, and if collision is detected, move work to `agent/<slug>-v2` and reapply.
- **Check for clashes** with other active `agent/*` / `feat/*` / `fix/*` branches before pushing and before merging; rebase/merge `origin/main` and resolve conflicts deliberately.
- **Watch CI feedback** (`gh pr checks <num> --watch`) and respond to every failure and review comment on the same branch until green. **`ci_result` green alone is not merge permission:** run the **Bot feedback wait gate** (late-review sweep **and ~10–15 minute** wait/re-poll for Gemini/Copilot/Codex/etc. unless **explicitly waived**), then **reply on the PR** to each substantive bot comment before squash-merge to **`main`**—see `.cursor/rules/git-pr-workflow-default.mdc` (**Bot feedback wait gate**, “PR review bots”) and `docs/CONCURRENT_AGENT_WORKFLOW.md` (**CI vs PR review bots**).
- **Keep every file under ~800 LOC (hard ceiling 1000 LOC).** When a change would push a file past the soft target, split it along natural seams in the same PR or file a follow-up in `docs/REFACTOR_BACKLOG.md`. Exempt generated files, configs (`wrangler.*`, `tsconfig*`, `vite.config.*`, `vitest.config.*`), migrations, lockfiles, real-data test fixtures, and `node_modules`.

Cursor rule: `.cursor/rules/multiagent-modularity.mdc`.

### Default git workflow (Cursor, Codex, Claude)

**Default:** land work via a **feature branch** and **PR into `main`** (not by pushing straight to `main`). Sync `main`, branch (`agent/` …), commit, push, open PR (`gh pr create --base main`).

**Merge readiness:** **`ci_result`** green is **necessary but not sufficient.** Complete the **Bot feedback wait gate** in **`.cursor/rules/git-pr-workflow-default.mdc`** (late-review sweep after green CI **and** **~10–15 minute** wait/re-poll unless the human waived bot closeout—Gemini/Copilot/Codex often land **after** Actions). Then **`ci_result`** **and** every **PR review bot** thread must have an **in-thread GitHub reply** (plus code fixes where applicable) **before** squash-merge—see **`docs/CONCURRENT_AGENT_WORKFLOW.md`** (**CI vs PR review bots**) and **`.cursor/rules/git-pr-workflow-default.mdc`**.

For **`agent/*`** / **`feat/*`** / **`fix/*`**, **`pr-auto-merge.yml`** can squash-merge when **`ci_result`** passes; **enable auto-merge only after** the wait gate **and** threaded replies are complete so CI does not merge early. **`stale-branch-cleanup.yml`** plus **`npm run git:graph-hygiene`** after merges keep refs tidy (`docs/CONCURRENT_AGENT_WORKFLOW.md`).

The **production verification** steps below apply **after** the change is on **`main`** and hosting deploys have finished (merged PR or rare explicit `main` hotfix). A green PR alone is not the same as an updated **www.australianrates.com** until merge + deploy.

**Exception:** the user **explicitly** requests a **direct `main` hotfix**—then push to `main` and still complete deployment confirmation and the checks below.

1. Before claiming any deploy-related task is complete, run from repo root:
   - `npm run verify:prod -- --scope=auto --depth=smoke`
   - For shared/tooling/workflow/verification changes or explicit full sign-off: `npm run verify:prod -- --scope=full --depth=full`
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
6. Reinforces the mandatory closeout above: commit and push; confirm deployment completed successfully; fix any CI/deployment issues; confirm the intended result on https://www.australianrates.com before claiming the task is complete.
   - Applies to every chat about this project unless the user explicitly instructs the assistant not to commit, push, deploy, or verify production.
   - If deployment is triggered by Cloudflare Pages on git push, confirm the Pages deployment completed rather than treating the push itself as proof.
   - If the API or archive Worker is affected, deploy the affected Worker with the repo deployment command and verify the production endpoint/result.

## Production and Hosting

- **Production URL**: https://www.australianrates.com
- **Hosting model**: Cloudflare Pages (frontend), Cloudflare Workers for API and archive (see docs/CLOUDFLARE_USAGE.md).

## Repo-Level Commands

| Purpose | Command | Notes |
|--------|---------|------|
| Verify production (targeted default) | `npm run verify:prod -- --scope=auto --depth=smoke` | From repo root. Auto-selects site/API/archive smoke checks from current changes or last commit. |
| Verify production (full) | `npm run verify:prod -- --scope=full --depth=full` | From repo root. Runs the broad verification set. |
| Test homepage smoke (production URL) | `npm run test:homepage` | From repo root. Playwright smoke for `/` only. |
| Test homepage pivot | `npm run test:homepage:pivot` | From repo root. Dedicated pivot browser suite. |
| Test homepage mobile | `npm run test:homepage:mobile` | From repo root. Dedicated mobile browser suite. |
| Test homepage full | `npm run test:homepage:full` | From repo root. Smoke + pivot + mobile + extra public sections. |
| Start browser-agent MCP (stdio) | `npm run browser-agent` | From repo root. Requires sibling repo `../browser-agent`. Cursor normally spawns this via `.cursor/mcp.json`; use this for manual smoke tests. |
| Test API worker | `npm run test:api` | From repo root. |
| Test archive worker | `npm run test:archive` | From repo root. |
| Typecheck API | `npm run typecheck:api` | From repo root. |
| Diagnose API smoke (production) | `npm run diagnose:api:smoke` | From repo root. Fast deploy-signoff API checks. |
| Diagnose API deep (production) | `node diagnose-api.js` | From repo root. Deeper triage and benchmark command. |
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

- Default deploy sign-off uses `npm run verify:prod -- --scope=auto --depth=smoke`.
- Use `npm run verify:prod -- --scope=full --depth=full` for shared/tooling/workflow/verification changes or explicit full sign-off.
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
- **D1 table:** `chart_pivot_cache` (migration 0030) holds one row per (section, representation) with JSON payload for the default slice (last 365 days, no filters). Refreshed hourly by the maintenance cron (`0 * * * *` UTC) alongside Wayback backfill and same-day RBA cash; site health stays on `*/15 * * * *`.
- **Scheduled full ingest:** Default twice per Melbourne day (06:00 and 18:00 local); cron `0 7,8,19,20 * * *` UTC with handler gating. Override hours with `MELBOURNE_DAILY_INGEST_HOURS` (comma-separated) or adjust `MELBOURNE_TARGET_HOUR` / `MELBOURNE_SECOND_INGEST_HOUR`.
- **API behaviour:** `GET /analytics/series` and `POST /analytics/pivot` try (1) optional KV cache by request key, (2) D1 cache when the request matches default filters, (3) live collect from analytics/canonical DB. All responses set `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`.
- **Non-stale:** Cron keeps the D1 cache updated; optional `CHART_CACHE_KV` (see types) can cache any response for 5 min. Apply migration 0030 before or after deploy so the table exists.

## Project Philosophy: Real Data Only

Tests and tooling must not use mock or simulated data. This is project philosophy and a hard rule.

- **Philosophy:** We test against real data so that passing tests indicate the system works in production. Fake rows, stubbed APIs, and in-memory fake databases validate behavior in an artificial world and can hide real-world failures.
- **Principle:** All test data must be real. Use real D1 (e.g. vitest-pool-workers with migrations), real API responses, or fixture files captured from production or real ingest runs. Pure unit tests that only use literal inputs (e.g. parsing a string) are fine; any business data in tests must come from a real source.
- **Hard rule:** No mock or simulated data in tests. Do not use makeMockD1, vi.mock with mockResolvedValue of business data, stub fetch returning fake JSON, or hand-crafted row/response objects. Tests that require real D1/Queue/API should move to integration or become `it.todo(...)` placeholders until real bindings or real-data fixtures exist; they must not be implemented with mocks.

See docs/MISSION_AND_TECHNICAL_SPEC.md (Project Philosophy: Real Data Only) and .cursor/rules/no-mock-test-data.mdc.

## Presentation Rule: Data First

This project is data-first. That is a hard presentation rule.

- Prefer dense tables, compact controls, terse labels, and direct values.
- Default to one-line rows and linear parameter layouts when presenting operational or analytical data.
- Do not add descriptive paragraphs, marketing copy, explanatory subtitles, embellished helper text, or discursive sentences unless the user explicitly asks for them.
- When in doubt, remove words and surface the underlying data instead.
- Any new admin or public UI should optimize for scan speed, compactness, and factual display over narrative explanation.

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
- `npm run test:homepage` runs the fast Playwright smoke suite against the **production** URL and requires network access.
- `npm run test:homepage:full` runs the broader browser coverage and is intended for explicit full verification, not default deploy sign-off.
- `npm run diagnose:api:smoke` runs the fast production API smoke suite; `npm run diagnose:api` is the deeper manual/incident command.
- Playwright needs Chromium installed (`npx playwright install --with-deps chromium`).

### Browser-agent MCP (interactive UX audits)

For **agent-driven** UX (navigate/click/screenshot/trace) with the canonical tool contract, use the **browser-agent** sibling repo (local path typically `../browser-agent` next to this repo).

1. **One-time in `browser-agent`:** `npm install` and `npx playwright install` (Chromium, Firefox, WebKit if you replay cross-engine).
2. **Cursor:** Project file `.cursor/mcp.json` registers MCP alias **`browser_agent_cursor`** (stdio server). If `${workspaceFolder}/../browser-agent` is wrong on your machine, fix `cwd`/`args` to your `browser-agent` checkout. Reload MCP after changes.
3. **Policy manifest:** Repo root **`browser-agent.manifest.json`** — allowlist hosts and `projectId` **`australianrates`**. When calling `session_create`, set `manifestPath` to a path readable from the browser-agent process cwd (e.g. `../australianrates/browser-agent.manifest.json` when cwd is `browser-agent`).
4. **Tool order:** Follow [browser-agent `cursor-adapter.md`](../browser-agent/cursor-adapter.md): `session_create` → `trace_start` → actions → milestone screenshots → on failure bundle → `trace_stop` → `session_close`. Use **`/ux_cursor`** prompt pack in `../browser-agent/cursor-ux-skill.md` and shared steps in `../browser-agent/ux-browser-runbook.md`.
5. **Verification:** Prefer production-only checks per workspace rules (`npm run verify:prod -- --scope=auto --depth=smoke`, etc.). Browser-agent complements them; it does not replace them for deploy sign-off.

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
- **Doctor (one-shot production prelude):** `npm run doctor` remains the deeper production triage path: **`diagnose-api`** (all three rate APIs, benchmarks, **`/analytics/series`** per dataset, home-loan **`site-ui`**, **`cpi/history`**, **`rba/history`**), **`diagnose-pages`**, admin log **stats** + **actionable**, full **`status-debug-bundle`**, and the bundle **DB / structural CDR gate**. Use it for incidents or explicit holistic verification, not as the default deploy sign-off command. **`npm run doctor:verify`** now runs `doctor`, then `test:api`, `test:archive`, and `test:homepage:full`.

Ensure `.env` contains `ADMIN_API_TOKEN` (or `ADMIN_API_TOKENS`) so that scripts and agents can fetch logs. If a variable is missing, add it (see `.env.example` for names and comments).

### Gotchas

- The archive worker uses `vitest.config.mts` with `@cloudflare/vitest-pool-workers`, while the API worker uses plain vitest with no config file (defaults).
- The archive worker's `wrangler.jsonc` has `dev` and `prod` environments; the default `npm run dev:archive` uses the dev environment.
- `npm run test:homepage` hits the **production** URL, which has Cloudflare bot challenge enabled. This test will fail from headless cloud VMs that cannot solve the challenge. It works from local developer machines with a real browser.
- **Headless console noise:** In headless Playwright (e.g. test:homepage, test:table-errors, beta-test-capture-log), the console often shows `Failed to load resource: net::ERR_NAME_NOT_RESOLVED` and `404` from Clarity/Cloudflare Insights. These are expected (telemetry scripts cannot resolve in headless) and are ignored in test assertions; do not treat them as site failures.
