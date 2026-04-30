---
name: elite-debugger
---

# Elite Debugger (Australian Rates)

Run as an elite production debugger: **fetch logs remotely, triage every problem, assemble the right experts, get to root cause, fix, then commit–sync–verify on AR until the site is fixed.** Do not stop until verification passes. Use other skills whenever they add capability (logging, orchestration, visual testing, Cloudflare, DB, deploy-verify).

---

## 1. Fetch production logs (mandatory, fresh every time)

- **Never use local or stale logfiles.** Per .cursor/rules/debug-use-logfiles.mdc: always fetch a **fresh** copy from the production API for each debugging run.
- **Fetch:** From repo root run `node fetch-production-logs.js` (loads `.env`; requires `ADMIN_API_TOKEN`). Or call the API directly: `GET https://www.australianrates.com/api/home-loan-rates/admin/logs/system` with `Authorization: Bearer <ADMIN_API_TOKEN>`, params: `format=jsonl`, `limit=1000` (max 10000), `level=error` or `level=warn`, optional `source`, `code`, `since`, `offset`.
- **Stats:** `GET .../admin/logs/system/stats` — row count and latest timestamp.
- **Actionable:** `GET .../admin/logs/system/actionable` — grouped operational issues (same filter as status health).
- **After use:** If you write fetched logs to a local file, delete it after processing. Do not leave ephemeral log copies in the repo.

---

## 2. Detect missing or mis-flagged logs

- **Missing logs:** If a failure is reported (e.g. by user, health, or tests) but the log stream has no corresponding entry, treat that as a bug: the code path is not emitting at the right level or at all. Use **logging-expert** to add or correct emission (level, source, code, context) so the next occurrence is visible.
- **Mis-flagged severity:** If something is clearly a failure but logged as `info` or `debug`, or something is noise but logged as `error`/`warn`, fix the call site and/or retention policy. Prefer `warn` for recoverable or degraded states and `error` for hard failures; ensure actionable codes are used where defined (see `workers/api/src/utils/log-actionable.ts`, `status-actionable-filter.ts`).

---

## 3. Triage and assemble experts

- **Triage:** From the fresh log (and optional actionable endpoint), list every distinct problem: endpoint failures, queue/run failures, parse errors, timeouts, missing data, etc. Group by root cause where obvious.
- **Assemble a team:** Use **orchestrate** (e.g. /team or explicit delegation) to assign subtasks to the right specialists:
  - **logging-expert** — emission, retention, log API, ensuring failures are logged with enough context.
  - **database-expert** — schema, migrations, D1 queries, integrity when errors point at DB.
  - **cloudflare-api-expert** — Workers, D1/R2/Queues, tokens, deploy, and production config.
  - **remote-visual-website-testing** — screenshots, visual audit, interaction traces when the bug is UI or layout on the live site.
  - **deploy-verify-loop** — run the commit–push–wait–verify loop until all tests pass.
  - **Back end / API** — when the failure is in workers/api or workers/archive (routes, handlers, ingest).
  - **explore / generalPurpose** — trace code paths, find call sites that should log or handle errors.

Hand off with clear deliverables: “root cause for entry X”, “fix and add logging for path Y”, “verify on production after deploy”.

---

## 4. Root cause and fix

- **Root cause:** For each problem, identify the underlying cause (bug, missing validation, missing log, misconfiguration, resource limit). Do not only fix symptoms; fix the cause so the issue does not recur.
- **Fix:** Apply code or config changes. Add or correct logging so the same class of failure is visible and correctly flagged next time. Respect project rules: real data only in tests, no mocks; file/function size limits; DRY.
- **Backend vs front end:** If the failure is in the API or Workers, trace in `workers/api` or `workers/archive` and fix there; use **diagnose-api.js** and health/actionable endpoints to confirm. If the failure is visual or UX on the live site, use **remote-visual-website-testing** (screenshots, audit) and fix in `site/` or the relevant worker.

---

## 5. Commit–sync–verify (mandatory)

- Per .cursor/rules/fix-commit-verify-loop.mdc: after any production-affecting fix, run the loop until the problem is **definitely** fixed. Do not ask the user to reproduce; verify yourself.
  1. **Repairs** — already done above.
  2. **Commit and push** — Default: branch + PR per **`.cursor/rules/git-pr-workflow-default.mdc`** (**`ci_result`**, wait gate, **in-thread** replies—**not** CI-only merge). **`main` hotfix** only if user ordered: **`git checkout main`**, commit, **`git push origin main`**.
  3. **Wait for deploy** — After the fix is **on `main`** (merged or hotfix push), wait for Cloudflare Pages/Workers.
  4. **Verify on production** — From repo root: `npm run test:homepage`, `npm run test:api`, `npm run test:archive`; optionally `node diagnose-api.js` for API health. Fetch key URLs if needed.
  5. **Loop** — If any check fails, fix again, commit, push, wait, re-verify. Do not stop until all pass.
- Use the **deploy-verify-loop** subagent when the task includes “deploy and verify”; pass production URL, test commands from AGENTS.md, and “do not mark complete until these checks pass.”

---

## 6. View live site and backend

- **Visual:** Use **remote-visual-website-testing** to capture screenshots (`npm run audit:visual` or Playwright), trace interactions, or fetch HTML. Use for UI bugs, layout, or to confirm fixes on the live site.
- **Backend:** Use `node diagnose-api.js` (optional base URL), health endpoint, and logs API. Inspect `workers/api` and `workers/archive` code paths that correspond to log sources and error codes.

---

## 7. Persist until fixed

- Do not consider the task done until:
  - Every identified problem has a root cause and a fix (or an explicit decision to defer with a ticket/reason).
  - All production verification steps have been run and passed (or explicitly skipped with user instruction and a note that the user should run them after deploy).
- If logs were saved locally for analysis, delete those files after processing.

---

## Key project references

| Item | Location |
|------|----------|
| Logs API, credentials | AGENTS.md (Debugging and production logfiles); .cursor/rules/debug-use-logfiles.mdc |
| Fix–commit–verify | .cursor/rules/fix-commit-verify-loop.mdc; orchestrate skill (commit–sync–verify loop) |
| Test commands | AGENTS.md: `npm run test:homepage`, `npm run test:api`, `npm run test:archive`; `node diagnose-api.js` |
| Logger, retention, actionable | logging-expert skill; workers/api/src/utils/logger.ts, log-actionable.ts, admin-logs.ts |
| Production URL | https://www.australianrates.com |

Use **orchestrate** when the work splits naturally into multiple experts (logging, DB, Cloudflare, visual, deploy-verify). Use **logging-expert** when improving or auditing log emission and retention. Use **remote-visual-website-testing** when you need to see or record the live site. Use **cloudflare-api-expert** when the issue involves Cloudflare resources or tokens. Use **database-expert** when the issue involves D1, schema, or migrations.
