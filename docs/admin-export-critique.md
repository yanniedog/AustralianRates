# Admin Export System: Action-Oriented Critique

## Executive summary

The admin export center (site/admin/exports.html, workers/api admin downloads routes) provides canonical, optimized, and operational JSONL exports with delta support and operational single-bundle or client-concat fallback. Gaps include: no retry for failed jobs, delta cursor discoverability and persistence, artifact metadata hidden in the UI, no documented path from exports to full D1/R2 reconstruction, and no DDL or import tooling—so exports alone are not sufficient to reconstruct the full DB from scratch without additional schema and procedures.

---

## 1. UX & product

### 1.1 Delta cursor (discoverability, copy, persistence)

| Item | Current state | Recommended change | File/component | Priority |
|------|---------------|--------------------|----------------|----------|
| Discoverability | "Delta since cursor" is a number input with placeholder "0"; no explanation of what cursor is or where to get it. | Add short hint (e.g. "Change-feed cursor; use 0 for full delta or paste from a previous job’s end cursor.") and, if possible, a "Use latest" control that pre-fills from the section’s latest completed job end_cursor. | site/admin/exports.html (labels/hints, optional button + JS) | P1 |
| Copy | "Copy cursor" button appears only when job has end_cursor (completed jobs). Copies numeric value to clipboard; success/error via #exports-msg. | Keep; optionally add a small "Copied" confirmation near the button. | site/admin/exports.html | P2 |
| Persistence | Cursor is not persisted. User must copy from one job and paste into "Delta since cursor" for the next. | Optionally pre-fill "Delta since cursor" from latest completed job in that section (e.g. on load or when "Use latest" is clicked). | site/admin/exports.html (loadSection/latestCursor, sinceCursorEl.value) | P1 |

### 1.2 Retry (failed jobs, poll vs retry)

| Item | Current state | Recommended change | File/component | Priority |
|------|---------------|--------------------|----------------|----------|
| Failed jobs | No retry. User can only create a new job (and must re-enter scope/cursor/options). requeueAdminDownloadJob exists in DB and is used internally for operational multi-pass only. | Add "Retry" action for jobs with status failed: call new API (e.g. POST /admin/downloads/:jobId/retry) that sets status back to queued and triggers continueAdminDownloadIfPending (or equivalent). | site/admin/exports.html (button + handler), workers/api/src/routes/admin-downloads.ts (new route), workers/api/src/db/admin-download-jobs.ts (requeue already exists) | P0 |
| Poll | "Poll" refreshes job and section; message shows current status. No distinction between "poll once" and "retry". | Keep Poll as status refresh; add separate "Retry" for failed jobs so intent is clear. | site/admin/exports.html | P1 |

### 1.3 Artifact metadata (row count, size, cursor range in UI)

| Item | Current state | Recommended change | File/component | Priority |
|------|---------------|--------------------|----------------|----------|
| API | List/job responses include full artifact objects: row_count, byte_size, cursor_start, cursor_end, file_name, artifact_kind, download_path. | No change needed. | workers/api/src/routes/admin-downloads.ts (statusBody) | — |
| UI | Only file_name (or artifact_kind) and download button are shown; row count, size, and cursor range are not displayed. | Show artifact metadata in the job card: e.g. row count, size (humanized), and cursor range (when applicable) per artifact or as a short summary. | site/admin/exports.html (renderJobs, artifact list rendering) | P1 |

### 1.4 Messaging (success/error clarity, auto-hide)

| Item | Current state | Recommended change | File/component | Priority |
|------|---------------|--------------------|----------------|----------|
| Clarity | Single #exports-msg; showMsg(text, isError); success/error class; new message overwrites previous. | Keep single message; ensure all error paths pass a clear, user-facing string (already mostly so). Optionally prefix "Error: " for isError in showMsg if not already in text. | site/admin/exports.html (showMsg, catch blocks) | P2 |
| Auto-hide | Message gets .visible; after 5s setTimeout removes .visible (element stays in DOM, display:none via .admin-message). | Keep 5s auto-hide; optionally add a "Dismiss" button for accessibility. | site/admin/exports.html, site/admin/admin-layout.css | P2 |

### 1.5 Polling (interval, when it runs, UX during wait)

| Item | Current state | Recommended change | File/component | Priority |
|------|---------------|--------------------|----------------|----------|
| Interval | POLL_MS = 5000; schedulePolling runs loadAllSections after 5s when any section has queued/processing entries. | Document in code or UI that refresh is every 5s while jobs are in progress. Consider making interval configurable (e.g. 3–10s) if users report need. | site/admin/exports.html (POLL_MS, schedulePolling) | P2 |
| When | Polling runs only when hasPendingEntries is true across all sections. Stops when no queued/processing jobs. | Keep; ensures no polling when idle. | site/admin/exports.html | — |
| UX during wait | History bar shows "Refreshing..." when section.loading; no global "Polling in progress" indicator. | Optionally add a subtle indicator (e.g. "Auto-refreshing every 5s" or a small spinner) when pollTimer is set. | site/admin/exports.html (schedulePolling, loadAllSections) | P2 |

### 1.6 Operational scope UI (scope fixed to "all", single snapshot mode)

| Item | Current state | Recommended change | File/component | Priority |
|------|---------------|--------------------|----------------|----------|
| Scope | Operational section has a scope &lt;select&gt; with only "All datasets", and the select is disabled. Backend supports scope but operational builder uses listOperationalTables(db) (all user tables). | Either remove the disabled scope control and show a short note ("Operational export always includes all datasets") or keep disabled and add hint: "Operational backup exports the full database; scope is fixed to all." | site/admin/exports.html (operational card copy + hint) | P2 |
| Mode | No delta for operational; API returns 400 for operational + delta. UI only shows "Create snapshot" and "Refresh". | No change; document in UI that operational supports snapshot only. | site/admin/exports.html (hint text) | P2 |

### 1.7 Bundle fallback (client-side concat when no single download_path)

| Item | Current state | Recommended change | File/component | Priority |
|------|---------------|--------------------|----------------|----------|
| When | When job has no download_path (e.g. older worker or job not yet completed), UI uses operationalBundles[jobId].parts and fetches each artifact by download_path, then concatenates blobs client-side. | Keep as fallback; ensure error message if a part fails is clear (e.g. "Snapshot part N failed (status)."). | site/admin/exports.html (downloadOperationalBundle) | P1 |
| UX | showMsg("Preparing single-file download from N snapshot parts...", false) then triggers download. | Consider progress (e.g. "Downloading part 2 of 5...") for large N to avoid perception of hang. | site/admin/exports.html (downloadOperationalBundle loop) | P2 |

---

## 2. API & backend

### 2.1 Error shape and HTTP codes

| Item | Current state | Recommended change | Where to document |
|------|---------------|--------------------|--------------------|
| Shape | jsonError(c, status, code, message, details?) returns { ok: false, error: { code, message, details? } }. Used consistently for admin download routes. | Keep. Optionally add a short "Admin API" subsection in AGENTS.md or a dedicated docs/admin-api.md listing error codes (BAD_REQUEST, NOT_FOUND, DOWNLOAD_JOB_MISSING, DOWNLOAD_JOBS_ACTIVE, DOWNLOAD_NOT_READY, DOWNLOAD_ARTIFACT_MISSING). | AGENTS.md or docs/admin-api.md |
| HTTP codes | 400 (validation), 404 (job/artifact not found, artifact missing in R2), 409 (delete blocked, download not ready). 500 for job not persisted. | Keep. Document in the same place: 4xx for client/state errors, 5xx for server failure. | Same as above |

### 2.2 Validation (POST body, query params)

| Item | Current state | Recommended change | File/component |
|------|---------------|--------------------|----------------|
| POST /downloads | stream, scope, mode required/validated; since_cursor/sinceCursor, include_payload_bodies/includePayloadBodies optional. since_cursor coerced to non-negative integer; no upper bound. | Consider documenting or enforcing a sane max since_cursor if change_feed cursor_id can be very large (e.g. reject or cap). Optional: accept only one of since_cursor/sinceCursor and document in API doc. | workers/api/src/routes/admin-downloads.ts |
| GET /downloads | stream, scope, status optional; limit parsed 1–250, default 12. | Document query params and limits (e.g. limit max 250). | docs or AGENTS.md |
| DELETE /downloads | job_ids/jobIds array; max 100; blocked if any job queued/processing. | Document max 100 and 409 when active jobs included. | Same |

### 2.3 Response contract (list vs job vs download)

| Item | Current state | Recommended change | Where |
|------|---------------|--------------------|-------|
| List GET | { ok: true, count, jobs } where each job is statusBody (job, download_path, download_file_name, artifacts with download_path). | Document: list returns jobs array; each job includes job fields (job_id, stream, scope, mode, status, since_cursor, end_cursor, requested_at, etc.) and artifacts with row_count, byte_size, cursor_start, cursor_end. | docs/admin-export-api.md or AGENTS.md |
| Job GET | Same statusBody for one job. | Document single-job response shape. | Same |
| Artifact download GET | Binary body; Content-Type from artifact; Content-Disposition with file_name. | Document: 404 when job/artifact missing or R2 object missing. | Same |
| Bundle GET /downloads/:jobId/download | Streaming response; only for operational snapshot completed; 409 if not completed. | Document: operational snapshot only; 409 until completed. | Same |

### 2.4 Retry endpoint

| Item | Current state | Recommended change | File/component |
|------|---------------|--------------------|----------------|
| Retry | No API to retry a failed job. requeueAdminDownloadJob exists in db/admin-download-jobs.ts. | Add POST /admin/downloads/:jobId/retry: allow only when status === 'failed'; call requeueAdminDownloadJob then continueAdminDownloadIfPending; return 202 and statusBody. Reject with 400 if not failed. | workers/api/src/routes/admin-downloads.ts |

---

## 3. Reconstruction adequacy

**Question:** Is the export sufficient to reconstruct the full DB (and R2) from scratch after loss?

### What is exported

- **Canonical:** Historical tables per scope (from streamTables: e.g. home_loan_rates, savings_rates, term_deposit_rates). JSONL: manifest + upsert records (table, key, row). Optionally **payload bodies**: R2 object bodies (raw HTML/JSON etc.) as text in JSONL (record_type payload, content_hash, r2_key, body).
- **Optimized:** Events and intervals tables per scope. Same JSONL shape (manifest + upsert).
- **Operational:** All user tables (sqlite_master, excluding sqlite_*, _cf_*). Multiple artifacts per table (chunked by offset); manifest lists tables and parts (file_name, table, row_count, row_start, row_end). No DDL.

So: **D1 row data** (and optionally **R2 body content** for canonical with include_payload_bodies) is exported. **No CREATE TABLE or schema** is included in any stream.

### What is missing for full reconstruction

- **Schema:** No DDL in exports. Restore requires applying migrations (or equivalent) first to create tables.
- **Import path:** No documented or repo script that reads admin JSONL and applies it to D1 (INSERT/upsert). Ordering and key handling (e.g. conflicts) would need to be defined.
- **R2:** Canonical payload export contains body content and r2_key; to "restore" R2 you would need a script that reads payload JSONL and writes each body to RAW_BUCKET under the given r2_key. No such script is present; R2 restore is not documented.
- **Queues / Durable Objects:** Not exported; would remain empty or need separate recovery.

### What would be needed for reconstruction

| Need | Current state | Action |
|------|---------------|--------|
| Migrations source | Migrations live in repo (e.g. workers/api/migrations). | Use existing migrations to create schema before importing. Document: "Restore D1 schema from migrations first." |
| D1 import script | None. | Add a script (e.g. node or worker) that reads operational (or canonical/optimized) JSONL and applies upserts to D1 in correct order (e.g. by table dependencies). Document in docs/backup.md or docs/admin-export-reconstruction.md. |
| R2 restore script | None. | If R2 restore is required, add a script that reads canonical payload JSONL and PUTs each body to R2 at r2_key. Document. |
| Docs | backup.md describes wrangler D1 export only; integrity-repair docs reference "backup export" (wrangler D1 export). No doc for admin export center or reconstruction from admin exports. | Add docs/admin-export-reconstruction.md (or section in backup.md): what each stream contains; that admin exports are JSONL and do not include DDL; that full reconstruction requires migrations + import script + optional R2 script; differentiate from wrangler D1 export for disaster recovery. |

### Differentiation: admin JSONL vs wrangler D1 export

- **wrangler D1 export** (docs/backup.md): Full D1 database dump (SQL). Suitable for disaster recovery and exact clone; no R2; no application-level structure.
- **Admin exports (canonical/optimized/operational):** Application-level JSONL (and optional R2 body content for canonical). Useful for portability, analytics, and partial/selective restore, but **not sufficient alone** to reconstruct the full DB without schema source and import/restore procedures.

---

*Perspectives considered: UX (discoverability, retry, feedback), backend (errors, validation, retry endpoint), maintainability (docs, contracts), data security (no change to auth or exposure), Cloudflare (polling interval and R2/D1 usage are unchanged; cost/limits not modified by this critique).*
