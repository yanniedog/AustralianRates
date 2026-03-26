---
name: doctor
description: >-
  Runs Australian Rates production triage via npm run doctor (diagnose-api, admin log stats/actionable,
  slim status-debug-bundle), then guides elite-debugger-style root-cause fixes and doctor:verify. Use when
  the user invokes /doctor, asks for production health triage, status-page or admin failures, or a prelude
  before full E2E verification on https://www.australianrates.com.
---

# Doctor (Australian Rates production triage)

Orchestrates a **fresh production signal** pass, then **elite-debugger** follow-through (triage, fix, commit–sync–verify). Pair with **elite-debugger**, **logging-expert**, and **cloudflare-api-expert** when needed.

## Preconditions

- Work from **repo root** (`c:\code\australianrates` or equivalent).
- Repo root **`.env`** must include **`ADMIN_API_TOKEN`** (same value as production API worker secret) for admin log stats, actionable issues, and the slim debug-bundle slice. Without it, `doctor` still runs public `diagnose-api` but admin steps exit non-zero or skip bundle per script behavior.

## Step 1 — Run doctor (automated prelude)

Execute (agent runs the command; do not only describe it):

```bash
npm run doctor
```

This runs in order:

1. **`node diagnose-api.js`** — public production API checks and benchmarks against `https://www.australianrates.com` (or `TEST_URL` / `API_BASE` if set).
2. **`node fetch-production-logs.js --stats --actionable`** — **fresh** stats and actionable JSON from production (no full log file written by default).
3. **`GET .../admin/diagnostics/status-debug-bundle?sections=meta,remediation`** — prints `health_run_id`, `health_checked_at`, and `remediation_hint_count` only.

Variants:

- **`node doctor.js --skip-bundle`** — omit the bundle HTTP call (faster or if the route is not yet deployed).

## Step 2 — Deepen signal (when triage needs more)

- **Full E2E JSON bundle (one file):** `npm run fetch-status-debug-bundle` or `node fetch-status-debug-bundle.js --out=path.json` — **delete** the file after analysis per project rules; do not commit captured bundles.
- **Full warn/error log stream:** `node fetch-production-logs.js` with `--errors` / `--warn` as needed; do not keep stale `errors.jsonl` / `warn.jsonl` in the repo.
- **Admin UI:** Status dashboard — **Download debug bundle (JSON)** / **Copy debug bundle curl** on `site/admin/status.html` (after deploy).

## Step 3 — Elite-debugger loop (agent accountability)

1. **Triage** every failure from Step 1–2: API benchmarks, actionable codes, remediation hints, bundle sections.
2. **Root cause** in code or config (`workers/api`, `workers/archive`, `site/`, Cloudflare).
3. **Fix** with correct logging (see **logging-expert** and `workers/api/src/utils/log-actionable.ts`).
4. **Commit and push** (per `.cursor/rules/auto-commit-sync-after-changes.mdc` and fix-commit-verify when production-affected).
5. **Wait for deploy** (Pages + Workers as applicable).

## Step 4 — Verify

```bash
npm run doctor:verify
```

Runs **`npm run doctor`** then **`npm run test:api`**, **`npm run test:archive`**, and **`npm run test:homepage`** (production URL). Do not mark deploy-related work complete until these pass or the user explicitly waives checks (per AGENTS.md).

## References

| Item | Location |
|------|----------|
| Doctor script | `tools/node-scripts/src/doctor.ts`, `doctor.js`, `package.json` scripts `doctor` / `doctor:verify` |
| Debug bundle | `fetch-status-debug-bundle.js`, `workers/api` route `/admin/diagnostics/status-debug-bundle` |
| Debugging index | AGENTS.md (Debugging and production logfiles; status debug bundle; doctor) |
| Production URL | `https://www.australianrates.com` |
| Verify-only rule | `.cursor/rules/verify-on-deployed-site-only.mdc` |

## What doctor does not do

- It does **not** auto-apply fixes; the agent implements changes after triage.
- It is **not** the Cloudflare Agents SDK; it is an npm-orchestrated ops workflow for this repo.
