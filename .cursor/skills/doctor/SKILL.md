---
name: doctor
description: >-
  Runs Australian Rates production triage via npm run doctor (diagnose-api, admin log stats/actionable,
  full status-debug-bundle to status-debug-bundle-latest.json plus console summary), then guides elite-debugger-style
  root-cause fixes using that file and doctor:verify. Use when
  the user invokes /doctor, asks for production health triage, status-page or admin failures, or a prelude
  before full E2E verification on https://www.australianrates.com.
---

# Doctor (Australian Rates production triage)

Orchestrates a **fresh production signal** pass, then **elite-debugger** follow-through (triage, fix, commit–sync–verify). Pair with **elite-debugger**, **logging-expert**, and **cloudflare-api-expert** when needed.

## Preconditions

- Work from **repo root** (`c:\code\australianrates` or equivalent).
- Repo root **`.env`** must include **`ADMIN_API_TOKEN`** (same value as production API worker secret) for admin log stats, actionable issues, and the full debug-bundle file. Without it, `doctor` still runs public `diagnose-api` but admin steps exit non-zero or skip the bundle file per script behavior.

## Step 1 — Run doctor (automated prelude)

Execute (agent runs the command; do not only describe it):

```bash
npm run doctor
```

This runs in order:

1. **`node diagnose-api.js`** — public production API checks and benchmarks against `https://www.australianrates.com` (or `TEST_URL` / `API_BASE` if set).
2. **`node fetch-production-logs.js --stats --actionable --fail-on-actionable`** — **fresh** stats and actionable JSON from production (no full log file written by default). **`--fail-on-actionable`** is added by doctor so the run **exits non-zero** if the actionable endpoint returns any issue groups (so “API benchmarks pass” is not mistaken for “nothing to fix”).
3. **Full status-debug-bundle** — runs **`fetch-status-debug-bundle.js`** with **`--out=status-debug-bundle-latest.json`** at repo root (file is **gitignored**). Any previous file is removed first so a failed fetch does not leave a stale bundle. The console prints a short summary (`health_run_id`, `health_checked_at`, `remediation_hint_count`, `bundle_file`). The bundle includes a top-level **`diagnostics`** object (economic coverage summary, findings sample, failed probes, E2E reason codes, failed datasets). **`npm run doctor`** prints that block before the DB integrity gate. Bundle step failures are **warnings only**; they do not change the exit code once steps 1–2 succeeded.
4. **Bundle database gate** — when the bundle file was written, doctor parses it and exits **1** if **`health.latest.integrity.ok`** is **false** (failed D1 / invariant checks) or the **CDR audit** has a **structural** check failure (fetch_event↔raw_object linkage, missing series keys, presence coverage, archived/raw consistency). Operational lag (**stale `run_reports`**, **unfinalized lender_dataset_runs**) does not fail this step; use reconciliation admin routes and cron. **`economic`** upstream noise does not set `integrity.ok`. Escape hatch: **`node doctor.js --tolerate-bundle-db`** skips this step.

**Reading the output**

- **`stats.count`** is the **total number of rows** in the production error log store (historical volume), not “new failures in this run.” It does not by itself fail doctor.
- **Exit code:** `npm run doctor` exits **1** if step 1 fails **or** step 2 reports actionable issue groups **or** step 4 fails (integrity or structural CDR checks). Use **`node doctor.js --tolerate-actionable`** only when you intentionally want the old behaviour (signal-only, always exit 0 after successful API + token checks). Use **`--tolerate-bundle-db`** only when you accept failing integrity or structural CDR checks for a given run.

Variants:

- **`node doctor.js --skip-bundle`** — omit the bundle fetch and file (faster or if the route is not yet deployed). Also skips step 4 (no bundle); a warning is printed when a token is present.
- **`node doctor.js --tolerate-actionable`** — do not pass `--fail-on-actionable` to the log fetch (exit 0 even when actionable lists issues).
- **`node doctor.js --tolerate-bundle-db`** — do not fail on integrity or CDR audit failures in the bundle.

## Step 2 — Use the bundle during triage

After Step 1, **read `./status-debug-bundle-latest.json`** (repo root) when a token was present and the bundle step ran. Use it for **health**, **logs**, **remediation.hints**, **CDR audit**, **coverage**, **replay queue**, and other sections the API returns — not only the printed summary. **Do not paste** secrets or whole files into chat if they are huge; pull **targeted sections** or keys into the conversation.

**Delete** this file after triage or fixes are done (same hygiene as other ephemeral production exports); it must not be committed.

## Step 3 — Deepen signal (optional)

- **Alternate bundle path or options:** `npm run fetch-status-debug-bundle` or `node fetch-status-debug-bundle.js --out=path.json` with `--sections`, `--since`, etc.
- **Full warn/error log stream:** `node fetch-production-logs.js` with `--errors` / `--warn` as needed; do not keep stale `errors.jsonl` / `warn.jsonl` in the repo.
- **Admin UI:** Status dashboard — **Download debug bundle (JSON)** / **Copy debug bundle curl** on `site/admin/status.html` (after deploy).

## Step 4 — Elite-debugger loop (agent accountability)

1. **Triage** using Step 1 console output, **`./status-debug-bundle-latest.json`** (when present), and optional Step 3 log exports: API benchmarks, actionable codes, remediation hints, and bundle sections.
2. **Root cause** in code or config (`workers/api`, `workers/archive`, `site/`, Cloudflare).
3. **Fix** with correct logging (see **logging-expert** and `workers/api/src/utils/log-actionable.ts`).
4. **Commit and push** (per `.cursor/rules/auto-commit-sync-after-changes.mdc` and fix-commit-verify when production-affected).
5. **Wait for deploy** (Pages + Workers as applicable).

## Step 5 — Verify

```bash
npm run doctor:verify
```

Runs **`npm run doctor`** then **`npm run test:api`**, **`npm run test:archive`**, and **`npm run test:homepage`** (production URL). Because doctor now fails on actionable issues, **`doctor:verify` stays red until production actionable is clean** (or you waive and use `node doctor.js --tolerate-actionable` for a signal-only prelude). Do not mark deploy-related work complete until these pass or the user explicitly waives checks (per AGENTS.md).

## References

| Item | Location |
|------|----------|
| Doctor script | `tools/node-scripts/src/doctor.ts`, `doctor.js`, `package.json` scripts `doctor` / `doctor:verify` (flags: `--tolerate-actionable`, `--tolerate-bundle-db`, `--skip-bundle`) |
| Doctor bundle file | `./status-debug-bundle-latest.json` (gitignored; written by `npm run doctor` when token set) |
| Debug bundle | `fetch-status-debug-bundle.js`, `workers/api` route `/admin/diagnostics/status-debug-bundle` |
| Debugging index | AGENTS.md (Debugging and production logfiles; status debug bundle; doctor) |
| Production URL | `https://www.australianrates.com` |
| Verify-only rule | `.cursor/rules/verify-on-deployed-site-only.mdc` |

## What doctor does not do

- It does **not** auto-apply fixes; the agent implements changes after triage.
- It is **not** the Cloudflare Agents SDK; it is an npm-orchestrated ops workflow for this repo.
