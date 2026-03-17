---
name: logging-expert
description: Methodical logging and logfile expertise for www.australianrates.com. Use when designing or implementing centralised logging; configuring retention and rollover (14d for errors/warnings, 48h for info); exposing logs to credentialed users via API; adding or improving log emission from front end, API worker, archive worker, or Cloudflare; or ensuring failures and errors produce verbose, rigorous debug output. Covers admin-portal logging control and consistent, helpful debug across all site processes.
---

# Logging Expert (Australian Rates)

Ensure errors, warnings, and failures from every part of the site (front end, API worker, archive worker, Cloudflare) are recorded with appropriate retention; informational logs stay compact and short-lived; control is centralised in the admin portal; and credentialed external users can read logs via API. All code paths must emit helpful debug by default and become **more verbose and rigorous when things go wrong**.

---

## Policy: Two log streams

| Stream | Contents | Retention / turnover | Format |
|--------|----------|----------------------|--------|
| **Errors/warnings/failures** | `level IN ('warn','error')` plus failure context | **14 days** continuous rollover | Full context, tracebacks, codes; one canonical store (e.g. `global_log` or dedicated error log). |
| **Informational** | `level IN ('debug','info')` | **48 hours** turnover | Compact, non-verbose; separate store or table so high volume does not dilute error retention. |

- **14d rollover:** Prune or rotate so that error/warn entries older than 14 days are removed (or archived). No indefinite growth.
- **48h turnover:** Prune info/debug so that entries older than 48 hours are removed. Keeps info log small and fast.

Current codebase: single `global_log` with 30d prune in `workers/api/src/db/retention-prune.ts`. Align retention to 14d for warn/error and 48h for info; if using one table, implement level-aware prune (different cutoffs by level) or split into two tables. See [references/retention-and-api.md](references/retention-and-api.md).

---

## Centralised control (admin portal)

- **Single place** for logging configuration and log access: admin portal (`site/admin/`, `workers/api` admin routes).
- Expose in admin UI:
  - View/download system log (existing: `site/admin/logs.html`, `/admin/logs/system`).
  - Retention/rollover settings (e.g. 14d / 48h) if configurable.
  - Optional: log level or verbosity for different components (e.g. more verbose in pipeline when enabled).
- Wipe, stats, and actionable-issues endpoints remain under admin auth. All log read/write/wipe goes through admin or the dedicated logs API with proper auth.

Existing: `workers/api/src/routes/admin-logs.ts`, `site/admin/logs.html`. Extend for centralised retention/verbosity control and ensure all log-related actions are gated by admin or logs-scoped auth.

---

## Exposing logs to credentialed external users (API)

- Provide an **API** so that appropriately credentialed **external** users (not only in-browser admin) can read log data.
- Auth must be strict: same as admin (Bearer token, CF Access JWT) or a dedicated read-only logs token/scoped token. No public access.
- API shape: e.g. `GET /admin/logs/system` (existing) or `GET /logs` with query params `level`, `source`, `since`, `limit`; response JSON or JSONL. Reuse `queryLogs()` in `workers/api/src/utils/logger.ts` and enforce auth on the route.
- Document the endpoint and required credentials so external integrators can consume logs safely.

---

## Emitting helpful debug everywhere

- **Front end:** Continue using in-session client log (e.g. `site/frame.js` session log) and optional `POST /debug-log` for server-side capture. Ensure errors (e.g. fetch failures, parse errors) are logged with message, status, and minimal context. On failure, add more detail (URL, status, body snippet).
- **API worker:** Use `workers/api/src/utils/logger.ts` (`log.debug`, `log.info`, `log.warn`, `log.error`) with stable `source` and, for failures, `code` and `context`. On catch blocks or error paths: include stack, request id/path, and relevant IDs (run_id, lender_code). Never swallow errors without logging.
- **Archive worker:** No D1 `global_log` today; uses console. Add structured logging (e.g. forward to API log endpoint, or separate archive log store) so failures and warnings are in the centralised view. On failure: log with full context (queue message id, lender, URL, status).
- **Cloudflare:** Workers errors and unhandled rejections should be logged via the same logger or a side-car so they appear in the 14d error stream. Consider Workers Tail or logpush if you need CF-level logs in the same pipeline.

---

## When things go wrong: more verbose and rigorous

- In **try/catch** or error handlers: log at `warn` or `error` with `code`, full `context` (request path, ids, payload shape), and `traceback` or `error` (stack). Prefer structured context over long prose.
- On **retry exhaustion**, **queue failure**, **upsert failure**, **run failure**: use existing actionable codes (see `workers/api/src/utils/log-actionable.ts`) and add enough context to reproduce (e.g. lender_code, run_id, product key, status code).
- **Front end:** On network or API errors, log level, message, status, and a short detail object; for 4xx/5xx add response body snippet (truncated) to the log.
- **Archive worker:** On fetch failure or parse failure, log URL, status, lender, and error message; for repeated failures consider a small buffer that gets sent to the central log.

---

## Codebase reference (key files)

| Area | Path |
|------|------|
| Logger (API) | `workers/api/src/utils/logger.ts` |
| Retention prune | `workers/api/src/db/retention-prune.ts` |
| Admin log routes | `workers/api/src/routes/admin-logs.ts` |
| Actionable issues | `workers/api/src/utils/log-actionable.ts` |
| Debug log (KV) | `workers/api/src/routes/debug-log.ts` |
| Admin auth | `workers/api/src/auth/admin.ts` |
| Admin logs UI | `site/admin/logs.html`, `site/admin/admin-portal.js` |
| Client session log | `site/frame.js` (session log, footer log link) |
| Health check (triggers prune) | `workers/api/src/db/health-check-runs.ts` |

When changing retention or adding a second log stream, update migrations and retention-prune logic; run retention after health checks or on a schedule so 14d/48h are enforced. When adding external log API, add a route under admin or a dedicated `/logs` with the same auth model and document it.

---

## Agents: use logfiles when debugging

Cursor and Codex agents **should try to access the production logfiles** whenever they are debugging code anywhere on the site (front end, API, archive worker, pipelines, or Cloudflare). Logs often contain the exact error, traceback, and context that explain a failure.

- **Fresh copy every run. No exceptions.** Always fetch a **fresh copy** of the logfile from the production API for each run. Never use a stale or local logfile. Never read from local files (e.g. `errors.jsonl`, `warn.jsonl`, `actionable.json`); those are in `.gitignore` and, if present, are stale. Use `node fetch-production-logs.js` from repo root or call the logs API directly every time you need logs.
- **Delete after use.** If you save fetched logs to local files (e.g. by redirecting script output), delete those files after processing and/or after issues have been fixed. Do not leave ephemeral log copies in the repo.
- **Credentials:** Use the repo root `.env` file. It must contain `ADMIN_API_TOKEN` (or a token listed in `ADMIN_API_TOKENS`) with the same value as the production API worker secret. See `.env.example` for the required variable names and comments.
- **URL (production):** `GET https://www.australianrates.com/api/home-loan-rates/admin/logs/system` with header `Authorization: Bearer <ADMIN_API_TOKEN>`.
- **Useful params:** `format=jsonl`, `limit=1000`, `level=error` or `level=warn`, `source=...`, `code=...`. For stats: `.../admin/logs/system/stats`; for actionable issues: `.../admin/logs/system/actionable`.
- **If .env is missing the token:** Remind the user to add `ADMIN_API_TOKEN` to `.env` (see `.env.example`) so that log access and other admin tooling work.
