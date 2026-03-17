---
name: cloudflare-api-expert
description: Maintains .env and workers/api/.dev.vars with tokens that interface with www.australianrates.com via Cloudflare; configures Cloudflare API tokens and permissions for debugging, monitoring, troubleshooting, and downloads. Supports live visual critique by fetching production URLs and using Playwright or user screenshots. Use when setting up or fixing local debugging, log access, admin tooling, Pages build/deploy, DNS/TLS, D1 backup, when critiquing or improving the site visually against production, or when additional API keys or permissions are required.
---

# Cloudflare API Expert (Australian Rates)

Ensures the right credentials in `.env` and `workers/api/.dev.vars` so scripts, tests, and local dev can reach the site via Cloudflare. Creates or configures Cloudflare API tokens with minimal required permissions when a task needs them.

---

## Env file locations

| Location | Purpose | Do not commit |
|----------|---------|----------------|
| **Repo root `.env`** | Admin Bearer token (logs, admin API), optional Cloudflare API tokens, API base override | Yes; copy from `.env.example` |
| **workers/api/.dev.vars** | Secrets for local API worker (`npm run dev:api`); e.g. `ADMIN_API_TOKEN` | Yes; copy from `workers/api/.dev.vars.example` |

All tokens that call production (or Cloudflare APIs) should be in repo root `.env` unless they are worker-only dev secrets (`.dev.vars`).

---

## Required for core debugging and admin

1. **ADMIN_API_TOKEN** (repo root `.env`)
   - Same value as the API worker secret: `wrangler secret put ADMIN_API_TOKEN` (in `workers/api`).
   - Used for: admin portal auth, log access (`GET .../admin/logs/system` with `Authorization: Bearer <token>`), diagnose-api, admin export, and other admin tooling.
   - If missing: log access, admin tests, and scripts that call admin endpoints fail. Add it from `.env.example` and set the value to match production.

2. **workers/api/.dev.vars**
   - Must contain `ADMIN_API_TOKEN` (and optionally `ADMIN_API_TOKENS`) for local API dev. Copy from `workers/api/.dev.vars.example`.

When adding or rotating the admin token: update repo root `.env`, `workers/api/.dev.vars` (for local dev), and production via `wrangler secret put ADMIN_API_TOKEN` in `workers/api`.

---

## When to add Cloudflare API tokens

Add (or document) Cloudflare tokens in repo root `.env` when the task requires:

- **Pages**: set build config, trigger deploy, or manage Pages project → token with **Pages Edit** (and optionally Account read). Scripts look for `CLOUDFLARE_PAGES_TOKEN` or `CLOUDFLARE_API_TOKEN`.
- **DNS/TLS**: fix DNS or SSL for australianrates.com → token with **Zone (Read, Edit)**, **DNS (Edit)**, **SSL and TLS (Edit)**. Scripts use `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_FULL_ACCESS_TOKEN`; some use `CLOUDFLARE_ZONE_ID` if set.
- **D1**: remote export/backup (e.g. `wrangler d1 export ... --remote`) → token with **Workers R2 Storage (Edit)** and **D1 (Edit)** (or account-level D1). Wrangler uses the same token as dashboard; store in `.env` as `CLOUDFLARE_API_TOKEN` if scripts need it, or rely on `wrangler` reading from env.
- **Analytics / GraphQL**: query Workers metrics → token with **Account Analytics Read** (see docs/CLOUDFLARE_USAGE.md).
- **Creating more tokens**: scripted token creation → bootstrap token with **Create additional tokens** (e.g. `CLOUDFLARE_BOOTSTRAP_TOKEN` or `CLOUDFLARE_GENERAL_TOKEN`).

Scripts in this repo prefer, in order: `CLOUDFLARE_PAGES_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_GENERAL_TOKEN`, `CF_API_TOKEN`, and for some operations `CLOUDFLARE_FULL_ACCESS_TOKEN`. The lib `tools/node-scripts/src/lib/env.ts` maps `CF_API_TOKEN` → `CLOUDFLARE_API_TOKEN` and `CF_ACCOUNT_ID` → `CLOUDFLARE_ACCOUNT_ID` when loading `.env`.

---

## Configuring Cloudflare

1. **Create tokens**: https://dash.cloudflare.com/profile/api-tokens → Create Token. Use a custom token and grant only the permissions needed for the task (see [reference.md](reference.md) for a permission matrix).
2. **Store in `.env`**: Add the variable (e.g. `CLOUDFLARE_API_TOKEN=...` or `CLOUDFLARE_PAGES_TOKEN=...`). Do not commit `.env`.
3. **Optional account ID**: For Pages/D1/Workers API calls, scripts may need `CLOUDFLARE_ACCOUNT_ID` (or `CF_ACCOUNT_ID`). Find it in the dashboard URL or account overview.
4. **Verify**: Run any script that uses the token (e.g. `npm run pages:set-build`, `npm run fix:cloudflare-dns-tls`, or `node scripts/verify-env-tokens.js` if available) to confirm the token works.

When a task needs a new capability (e.g. D1 export from CI, or a new admin script that calls Cloudflare), determine the minimal Cloudflare permission set, create a token with that set, add the variable to `.env`, and document the variable and purpose in `.env.example` (with a comment; no value).

---

## .env.example maintenance

- Every variable that scripts or agents expect must be listed in `.env.example` with a short comment and no real value.
- When adding a new Cloudflare token or credential for a new task, add a commented line to `.env.example` (e.g. `# CLOUDFLARE_PAGES_TOKEN=`) and ensure the skill or AGENTS.md mentions when it is required.

---

## Common tasks

| Goal | Env / Cloudflare |
|------|------------------|
| Log access, admin API, diagnose-api | `ADMIN_API_TOKEN` in repo root `.env` (match API worker secret) |
| Local API dev with admin routes | `ADMIN_API_TOKEN` in `workers/api/.dev.vars` |
| Pages: set build, trigger deploy | `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_PAGES_TOKEN` with Pages Edit; optional `CLOUDFLARE_ACCOUNT_ID` |
| Fix DNS/TLS for australianrates.com | `CLOUDFLARE_API_TOKEN` (or `CLOUDFLARE_FULL_ACCESS_TOKEN`) with Zone + DNS + SSL/TLS Edit |
| D1 remote export/backup | Wrangler uses token from env; ensure `CLOUDFLARE_API_TOKEN` (or equivalent) has D1 + R2 (if needed) |
| Create additional tokens via script | `CLOUDFLARE_BOOTSTRAP_TOKEN` or `CLOUDFLARE_GENERAL_TOKEN` with "Create additional tokens" |

---

## Escalation

- If a script fails with "Set CLOUDFLARE_* in .env": add the appropriate token to `.env` with the permissions required by that script (see script source or [reference.md](reference.md)).
- If production admin or logs are unreachable: confirm `ADMIN_API_TOKEN` in `.env` matches the API worker secret and that the request uses `Authorization: Bearer <token>`.
- If Cloudflare API returns 403: the token is missing a required permission; create a new token with the scope listed in the script or in [reference.md](reference.md).

For a full permission-to-script mapping and token naming used by each script, see [reference.md](reference.md).

---

## Live visual critique and improvement

Use production to critique and improve the site visually:

| Action | How |
|--------|-----|
| **Production URL** | `https://www.australianrates.com` and paths `/`, `/savings/`, `/term-deposits/` |
| **Fetch pages** | GET production HTML (e.g. `mcp_web_fetch`). Inspect structure, headings, meta, copy for layout and content suggestions. Returns markup only, not pixels. |
| **Pixel-level review** | Run `npm run test:homepage` (Playwright) for key elements and flows; or use user-shared screenshots (chart, footer, mobile) for concrete visual/UX recommendations. |
| **Credentials** | None for public fetches. Use `ADMIN_API_TOKEN` for admin/logs APIs when correlating errors with visual issues. |

Combine live HTML/structure, repo CSS/JS, and (when available) screenshots to recommend clarity, hierarchy, and polish.

---

## Additional resources

- Permission matrix and script-to-env mapping: [reference.md](reference.md)
