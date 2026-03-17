# Beta Test Report: Full Database Backup (Offline Restore)

## Summary

- **Target:** Full database dump feature: user-facing download of entire D1 DB as a single file capable of reinstantiating or replacing the DB if wiped or corrupted (robust offline backup).
- **Environment:** Production design and implementation; code and docs reviewed. Live UI not exercised (admin auth required; no automated admin E2E in repo).
- **Date:** 2025-03-17
- **Coverage:** API contract, dump builder, download stream, import script, restore execute, admin UI code, and docs. Not covered: live click-through of admin exports page, actual download from production, or restore against production.
- **Constraints:** Admin export center is behind Bearer token; `npm run test:homepage` targets production but does not cover admin or backup flow. Verify script `verify-admin-dump-restore.ts` runs against local wrangler dev (sandbox D1), not production.

## Coverage Map

| Item | Tested | Notes |
|------|--------|--------|
| API: POST /admin/downloads (create job) | Code only | Contract: operational + all + snapshot only |
| API: GET /admin/downloads (list jobs) | Code only | stream=operational, limit 1–250 |
| API: GET /admin/downloads/:jobId/download (single-file stream) | Code only | Concatenates R2 parts in order; 400/409/404 behavior |
| API: GET /admin/downloads/:jobId/restore/analysis | Code only | Blocks when other jobs/pipeline active |
| API: POST /admin/downloads/:jobId/restore | Code only | Drops schema, replays dump, verifies counts |
| Dump builder (header, schema, data, indexes, triggers, views, footer) | Code only | Header/footer markers match import validation |
| Import script (import-d1-backup.ts) | Code only | Validates markers; decompresses; wrangler d1 execute |
| Admin UI: exports.html, admin-exports.js, admin-exports-view.js, admin-exports-runtime.js | Code only | Create dump, Refresh, Download file, Analyze restore, Restore, Retry, Delete |
| Docs: admin-export-api.md, admin-export-reconstruction.md, backup.md | Read | Restore flow and CLI import described |
| verify-admin-dump-restore.ts (dump-create → download → import loop) | Code only | Local sandbox only; proves format, not production path |
| Live admin UI (login → Exports → Create full dump → Download) | **Not tested** | Would require authenticated browser session |
| Actual download from production (integrity, size, decompress) | **Not tested** | No checksum or post-download verification in flow |
| Restore into blank D1 (production or staging) | **Not tested** | Documented but not executed in this audit |

## Top Priorities

1. **Add integrity verification for the downloaded backup (High)**  
   The downloaded `.sql.gz` has no checksum or hash in the API or UI. A corrupted or truncated download could still decompress and pass header/footer checks if the damage is in the middle. Recommend: store a SHA-256 (or similar) when the bundle is built, return it in job/artifact metadata and in a response header for GET download; UI and docs: “Verify after download: `shasum -a 256 file.sql.gz` and compare to job checksum.”

2. **Document offline restore prerequisites (Medium)**  
   “Robust offline backup” implies the file alone is enough. In practice, restore requires Node, wrangler, `workers/api` cwd, and `node scripts/import-d1-backup.js` (or equivalent). Docs should state: “To restore from this file offline you need: Node.js, Wrangler CLI, and the australianrates repo (or at least the import script).” Optionally ship a minimal standalone restore instruction (e.g. in the dump header comment or a one-page “disaster recovery” doc).

3. **Clarify “single file” and retention (Medium)**  
   The UI says “Single-file SQL dump” and “Download file” but does not state that the file is a concatenation of multiple R2 parts. For robustness, add a short note: “The download is one .sql.gz file. Keep it in a safe place; job artifacts may be deleted from the server later.” If retention is time- or policy-limited, say so.

4. **Improve error when download fails mid-stream (Low–Medium)**  
   If the ReadableStream errors (e.g. R2 part missing), the client gets a failed fetch. The UI shows “Download failed (status).” There is no way to distinguish “job not ready” from “network/stream error” or “artifact missing.” Consider: 409 for not ready, 404 for missing artifact, and a distinct message or code for stream/network failure so the user knows whether to retry or contact support.

5. **Optional: Post-download verification in UI (Low)**  
   After blob download, the UI could decompress the first/last few KB in a worker and check for the header/footer markers, then show “Download verified” or “Download may be incomplete.” This would strengthen confidence without requiring a full checksum yet.

## Findings

### [High] No integrity checksum for downloaded backup

- **URL or location:** `GET /admin/downloads/:jobId/download`, admin export UI “Download file”, and `import-d1-backup.ts`.
- **Area:** Bug / robustness / trust
- **Evidence:** Response headers do not include Content-MD5, ETag, or custom checksum. Job/artifact metadata has no `sha256` or similar. Import script only checks for presence of two text markers in the decompressed SQL.
- **Reproduction steps:** Create dump job, wait for completed, call GET download or click Download file; inspect response headers and job JSON; run import with a truncated file (e.g. head -c 50% file.sql.gz > truncated.sql.gz) and observe that validation can still pass if header and footer are present in the truncated content (depending on truncation).
- **Observed result:** No checksum is computed or exposed; user cannot verify that the file on disk matches what was served.
- **Expected result or standard:** For a “robust offline backup,” the backup artifact should be verifiable (e.g. SHA-256) so that corruption or incomplete download can be detected before restore.
- **Impact:** User may restore a corrupted or partial backup and only discover data loss or inconsistency after restore.
- **Recommendation:** Compute SHA-256 when writing the bundle (or when writing each part and combine); store in artifact or job metadata; return in response header (e.g. `X-Backup-SHA256`) for GET download; show in UI and document “Verify after download.”

### [Medium] Offline restore depends on repo and tooling

- **URL or location:** `docs/admin-export-reconstruction.md`, `docs/backup.md`, `exports.html` (restore command in pre).
- **Area:** Content / UX / robustness
- **Evidence:** Docs say “Download the dump” and “Run the import script” with `node scripts/import-d1-backup.js --db australianrates_api --input ./australianrates-database-full.sql.gz --remote`. The script lives in the repo and uses `wrangler` from `repo/node_modules` and `cwd: workers/api`.
- **Observed result:** Restore is not “file only”; it requires Node, wrangler, and the repo (or at least the import script and knowledge of wrangler cwd).
- **Expected result or standard:** For “robust offline backup,” operators should know exactly what is needed to restore without the live site.
- **Impact:** In a disaster scenario (e.g. DB wiped, site down), someone with only the .sql.gz file may not know they need the repo and wrangler.
- **Recommendation:** Add a short “Offline restore prerequisites” section: Node.js, Wrangler CLI, and the australianrates repo (or the import script plus correct cwd). Optionally add a one-page “Disaster recovery” doc that lists steps from “I have only the .sql.gz file.”

### [Medium] Dump consistency is best-effort during live writes

- **URL or location:** `admin-download-dump-builder.ts`, `docs/admin-export-reconstruction.md`.
- **Area:** Content / trust
- **Evidence:** Docs state: “The admin worker assembles the dump through live D1 reads. For the most exact restore artifact, create the dump during a quiet period when writes are paused or minimal.”
- **Observed result:** No transactional snapshot; dump is consistent per table but not necessarily a single point-in-time across all tables.
- **Expected result or standard:** For “robust offline backup,” operators should understand that the backup is “crash-consistent” style (tables dumped in order) rather than a guaranteed transactional snapshot.
- **Impact:** Acceptable for disaster recovery, but operators might assume full transactional consistency; minor risk of cross-table inconsistency if writes are heavy during dump.
- **Recommendation:** Keep the existing doc sentence; optionally add one line: “The dump is not a single transactional snapshot; for minimal inconsistency, run during low write activity.”

### [Low] Download stream error not distinguished from “not ready”

- **URL or location:** `admin-downloads.ts` (GET .../download), `admin-exports-runtime.js` (downloadFile), `admin-exports-view.js` (Download file button).
- **Area:** UX / bug
- **Evidence:** If R2 returns null for a part, the stream throws; response may be 500 or broken body. Client shows “Download failed (status).” 409 is returned when status !== 'completed'.
- **Observed result:** User cannot tell “job still processing” (409) from “artifact missing” (500/stream error) or network failure.
- **Recommendation:** Ensure 404 with DOWNLOAD_ARTIFACT_MISSING when any part is missing; use 500 only for unexpected errors; in UI, show a short message for 409 (“Dump still preparing”), 404 (“Dump file missing; retry or contact support”), and generic for 5xx/network.

### [Low] No explicit retention or “backup lifecycle” note

- **URL or location:** Admin exports UI, `admin-export-api.md`.
- **Area:** Content / trust
- **Evidence:** UI and API do not state how long job artifacts are kept or whether they are purged automatically.
- **Observed result:** User may assume the download link is forever valid or that “completed” jobs are retained indefinitely.
- **Recommendation:** If there is a retention policy, document it in the UI (e.g. in the hint under “Restorable D1 dump”) and in the API doc. If there is none, add: “Store the downloaded file; server-side artifacts may be removed when jobs are deleted or per retention policy.”

## Improvement Opportunities

- **Navigation and IA:** Exports is reachable from Dashboard (“Exports” card) and sidebar; “Full database dump” and “Restorable D1 dump” are clear. Consider adding a one-line “Use this to create an offline backup you can restore if the DB is wiped or corrupted” on the export page.
- **Content and messaging:** Restore command in `<pre>` is correct; add a note that the path to the script is from repo root and that `--remote` is for Cloudflare D1 (not local SQLite).
- **Conversion and CTA clarity:** “Create full dump” and “Download file” are clear. “Analyze restore” and “Restore this dump” are in-place only; consider a short line: “For a new or replacement database, use Download + import script (below).”
- **Accessibility and inclusive design:** Buttons and status badges are present; ensure “Download file” and “Analyze restore” have clear aria-labels if not already. Error messages from API are shown via showMsg; ensure they are announced (aria-live already used for message region).
- **Perceived performance and responsiveness:** Polling every 5s while jobs are pending is documented in the UI; good. For large DBs, consider showing “Dump in progress (N tables)” if artifact metadata exposes progress.

## Systemic Themes

- **Single-file guarantee:** The design correctly delivers one `.sql.gz` to the user; internal multi-part assembly is hidden and order is defined (`sortDatabaseDumpArtifactsForBundle`). This supports “one file to archive” for offline backup.
- **Validation at import:** Import script validates AustralianRates header/footer; rejects wrong or truncated dumps that lack them. This is good but not sufficient for all corruption (see checksum finding).
- **Two restore paths:** In-place (Analyze restore + Restore this dump) vs. offline (Download + import script) are both documented and implemented; in-place is UI-driven, offline is CLI-driven. Clear and appropriate.

## Untested or Blocked Areas

- **Live admin UI:** Not tested. Would require logging in at production (or staging) and going through Create full dump → wait → Download file. Blocked by lack of automated admin E2E and token handling.
- **Production download and restore:** No test was run that actually downloaded a completed dump from production and ran the import script against a target D1. The verify script runs against local wrangler dev only.
- **Large DB behavior:** Timeouts, memory, or R2 limits for very large dumps were not exercised; code uses streaming and batched reads, which is appropriate but not verified under load.
- **Mobile/responsive admin exports page:** Not checked; admin is typically desktop but layout on small viewports was not reviewed.

## Final Verdict

- **What is working well:**  
  The backup function is well designed for its goal: one restorable `.sql.gz` with DDL and data, correct header/footer markers, in-place restore via API, and offline restore via documented import script. Dump builder order (header → schema → data → indexes → triggers → views → footer) and exclusion of internal tables match D1 and the import script. Retry and delete flows exist; docs (admin-export-api, admin-export-reconstruction, backup) describe both restore paths clearly.

- **What feels risky or unfinished:**  
  (1) No integrity checksum on the backup file, so “robust offline backup” is weakened by the inability to verify the download. (2) Offline restore depends on Node + wrangler + repo; this is not clearly stated as a prerequisite in one place. (3) Stream/artifact failure could be clearer in the UI (409 vs 404 vs 5xx).

- **Is the site/feature ready for broader users in its current state?**  
  For operators who already use the admin panel and have run the import script once, the feature is usable and the backup is restorable. For “robust offline backup” as a product claim, add checksum verification and explicit offline-restore prerequisites; then it is ready.

- **What should happen next:**  
  1. Implement and expose a checksum (e.g. SHA-256) for the single-file download; document and optionally show in UI.  
  2. Add a short “Offline restore prerequisites” and, if desired, a “Disaster recovery” page.  
  3. Optionally improve error handling and messages for download (409/404/5xx).  
  4. When feasible, add an automated test or script that creates a dump (e.g. in staging), downloads it, verifies markers (and checksum if added), and runs the import script against a blank D1 to close the loop in CI/staging.
