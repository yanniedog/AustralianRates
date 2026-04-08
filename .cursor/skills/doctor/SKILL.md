---
name: doctor
description: >-
  Runs Australian Rates production triage via npm run doctor (diagnose-api, diagnose-pages HTML smoke,
  admin log stats/actionable, optional verify:prod-hosting, optional archive health, full status-debug-bundle,
  compact scorecard, DB/CDR gate), then guides elite-debugger-style root-cause fixes using the bundle file
  and doctor:verify. Use when the user invokes /doctor, asks for production health triage, status-page or
  admin failures, or a prelude before full E2E verification on https://www.australianrates.com.
---

# Doctor (Australian Rates production triage)

Orchestrates a **fresh production signal** pass, then **elite-debugger** follow-through (triage, fix, commit–sync–verify). Pair with **elite-debugger**, **logging-expert**, and **cloudflare-api-expert** when needed.

## Preconditions

- Work from **repo root** (`c:\code\australianrates` or equivalent).
- Repo root **`.env`** must include **`ADMIN_API_TOKEN`** (same value as production API worker secret) for admin log stats, actionable issues, and the full debug-bundle file. Without it, **`diagnose-api`** and **`diagnose-pages`** still run; **`fetch-production-logs`** exits non‑zero (doctor scorecard shows logs FAIL).

## Step 1 — Run doctor (automated prelude)

Execute (agent runs the command; do not only describe it):

```bash
npm run doctor
```

Order:

1. **`node diagnose-api.js`** — public API checks and benchmarks (`https://www.australianrates.com` or `TEST_URL` / `API_BASE`). Includes **`/analytics/series`** per dataset and home-loan **`site-ui`**, **`cpi/history`**, **`rba/history`**. Parallelized fetches where safe. **`--quick`** or **`DOCTOR_QUICK=1`**: shorter benchmarks (forwarded when you run `node doctor.js --quick`).
2. **`node diagnose-pages.js`** — HTML smoke (main sections + legal pages): status, HTML content-type, title/body markers, optional slow-TTFB warnings (`DIAG_PAGES_TTFB_WARN_MS`).
3. **`node fetch-production-logs.js --stats --actionable --fail-on-actionable`** — fresh stats and actionable; doctor fails if actionable lists issue groups (unless **`--tolerate-actionable`**).
4. **Optional `npm run verify:prod-hosting`** — only with **`--with-hosting`** or **`npm run doctor:holistic`** (DNS/TLS/Playwright fetch; slower).
5. **Optional archive** — if **`ARCHIVE_ORIGIN`** is set, **`GET {ORIGIN}/api/health`** (warn-only; fails the run only with **`--strict-archive`**).
6. **Full status-debug-bundle** — **`fetch-status-debug-bundle.js`** → **`status-debug-bundle-latest.json`** (gitignored; stale file removed first). Default: **no** huge JSON dump to the console.
7. **Doctor scorecard** — one screen: PASS/FAIL per step, bundle **`health_run_id`**, **`remediation_hints`**, **`replay_queue_count`**, **`coverage_gaps.report`**, **`logs.total`**, bundle gate line.
8. **Bundle database gate** — when the bundle file was written and not **`--tolerate-bundle-db`**, doctor exits **1** if **`health.latest.integrity.ok`** is **false**, stored **`integrity_audit.latest`** is failed (**`red`** / **`overall_ok`** false), or **CDR** has a **structural** check failure (same IDs as before). Escape: **`--tolerate-bundle-db`**.

**Verbose bundle JSON (old behaviour):** **`node doctor.js --dump-bundle-diagnostics`** prints **`status_page_diagnostics`**, **`diagnostics`**, **`integrity_audit`** before the gate.

**Reading the output**

- Log **stats** **`count`** (from the stats endpoint) is total rows in the error log store, not “new failures this run.”
- **Exit code:** **`1`** if **any** of: diagnose-api, diagnose-pages, logs (with strict actionable), verify:prod-hosting (when run), archive (when **`--strict-archive`** and **`ARCHIVE_ORIGIN`** set), or bundle DB/CDR gate fails.

Variants:

- **`node doctor.js --skip-bundle`** — no bundle file or gate.
- **`node doctor.js --tolerate-actionable`** — omit **`--fail-on-actionable`** on log fetch.
- **`node doctor.js --tolerate-bundle-db`** — ignore integrity / structural CDR failures in the bundle.
- **`node doctor.js --quick`** — shorter **`diagnose-api`** benchmarks.
- **`node doctor.js --with-hosting`** — run **`verify:prod-hosting`**.
- **`npm run doctor:holistic`** — alias for **`doctor --with-hosting`**.

## Step 2 — Use the bundle during triage

After Step 1, **read `./status-debug-bundle-latest.json`** when a token was present and the bundle step ran. Use **health**, **logs**, **remediation.hints**, **CDR audit**, **coverage**, **replay queue**, and other sections — not only the scorecard. **Do not paste** secrets or whole files if huge; pull **targeted** keys.

**Delete** this file after triage; do not commit it.

## Step 3 — Deepen signal (optional)

- **Bundle options:** `npm run fetch-status-debug-bundle` or `node fetch-status-debug-bundle.js --out=path.json` with `--sections`, `--since`, etc.
- **Logs stream:** `node fetch-production-logs.js` with `--errors` / `--warn`; delete ephemeral exports after use.
- **Admin UI:** Status — **Download debug bundle** on `site/admin/status.html`.

## Step 4 — Elite-debugger loop (agent accountability)

1. **Triage** using console output, **`./status-debug-bundle-latest.json`**, optional log exports.
2. **Root cause** in `workers/api`, `workers/archive`, `site/`, Cloudflare.
3. **Fix** with correct logging (**logging-expert**, `workers/api/src/utils/log-actionable.ts`).
4. **Commit and push** (per project rules when production-affected).
5. **Wait for deploy**.

## Step 5 — Verify

```bash
npm run doctor:verify
```

Runs **`npm run doctor`** then **`npm run test:api`**, **`npm run test:archive`**, **`npm run test:homepage`**. Do not mark deploy-related work complete until these pass or the user waives checks (per AGENTS.md).

## References

| Item | Location |
|------|----------|
| Doctor script | `tools/node-scripts/src/doctor.ts`, `doctor.js`; `package.json`: **`doctor`**, **`doctor:verify`**, **`doctor:holistic`** |
| Pages smoke | `tools/node-scripts/src/diagnose-pages.ts`, `diagnose-pages.js`; **`diagnose:pages`** |
| API diagnostics | `tools/node-scripts/src/diagnose-api.ts`, `diagnose-api.js` |
| Doctor bundle file | `./status-debug-bundle-latest.json` (gitignored) |
| Debug bundle | `fetch-status-debug-bundle.js`, workers route `/admin/diagnostics/status-debug-bundle` |
| Production URL | `https://www.australianrates.com` |

## What doctor does not do

- It does **not** auto-apply fixes; the agent implements changes after triage.
- It is **not** the Cloudflare Agents SDK; it is an npm-orchestrated ops workflow for this repo.
