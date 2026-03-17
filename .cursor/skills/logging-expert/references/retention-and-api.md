# Retention, rollover, and log API (implementation detail)

## Retention policy summary

| Stream | Levels | Retention | Implementation options |
|--------|--------|-----------|------------------------|
| Error/warn | warn, error | 14 days | Prune `global_log` where `level IN ('warn','error')` and `ts < now - 14d`; or separate `error_log` table with 14d prune. |
| Info | debug, info | 48 hours | Prune `global_log` where `level IN ('debug','info')` and `ts < now - 48h`; or separate `info_log` table with 48h prune. |

Current: `workers/api/src/db/retention-prune.ts` has `GLOBAL_LOG_RETENTION_DAYS = 30` and a single `DELETE FROM global_log WHERE ts < ...`. To meet policy:

1. **Option A (one table):** Two prune steps: (1) delete `level IN ('debug','info')` older than 48h; (2) delete `level IN ('warn','error')` older than 14d. Constants: `GLOBAL_LOG_INFO_RETENTION_DAYS = 2`, `GLOBAL_LOG_ERROR_RETENTION_DAYS = 14`.
2. **Option B (two tables):** e.g. `global_log` for warn/error only (14d) and `info_log` for debug/info (48h). Logger writes to both or routes by level. Requires migration and logger changes.

Indexes: keep `idx_global_log_ts` and `idx_global_log_level` (or equivalent) so level+ts deletes are efficient.

## Where retention runs

- `runRetentionPrunes(db)` is called from `workers/api/src/db/health-check-runs.ts` after persisting a health check run. No separate cron is required if health checks run at least daily.
- If adding a separate info log table, add its prune to `runRetentionPrunes` and keep a single entry point for all retention.

## External API for credentialed users

- **Auth:** Reuse admin auth: `requireAdmin()` (Bearer token or CF Access JWT). Alternatively, a dedicated `LOGS_READ_TOKEN` with read-only access to log endpoints only.
- **Endpoints (existing):**  
  - `GET /admin/logs/system` – query params: `level`, `source`, `code`, `format=text|jsonl`, `limit`, `offset`. Returns system log. Already admin-only.
- **For “external” users:** Same endpoints; external clients call with `Authorization: Bearer <ADMIN_API_TOKEN>` or `ADMIN_API_TOKENS`. No new route required unless you want a dedicated `/logs` path that accepts a scoped token (e.g. logs-read-only). If adding `/logs`, implement the same `queryLogs()`-based response and protect with admin or a logs-specific token check.
- **Documentation:** In AGENTS.md or a runbook, document: “Log access: GET https://www.australianrates.com/api/home-loan-rates/admin/logs/system?format=jsonl&limit=1000 with Authorization: Bearer <token>. Token from ADMIN_API_TOKEN or ADMIN_API_TOKENS.”

## Admin portal centralised control

- **Current:** `site/admin/logs.html` – download system log (text/JSONL), wipe, stats; client log download/wipe.
- **Centralised control additions:**  
  - Display or edit retention constants (14d / 48h) if they become configurable (e.g. stored in `app_config` or env).  
  - Optional: toggle “verbose pipeline logging” so that on failure, pipeline steps emit extra debug.  
  - Single entry point: all log-related actions (download, wipe, stats, actionable, retention settings) remain under `/admin` and require admin auth.

## Compact info log

- To keep info “compact and non-verbose”: cap message length for debug/info (e.g. 500 chars) and avoid logging large payloads; store only identifiers and short summaries. Error/warn can keep larger context (existing `MAX_CONTEXT_CHARS` in logger).
