# Cloudflare API Expert – Reference

## Token permission matrix

| Task / script | Required Cloudflare permissions | Env variable(s) |
|---------------|----------------------------------|------------------|
| Pages: set build config | Account read; Cloudflare Pages \| Edit | `CLOUDFLARE_PAGES_TOKEN`, `CLOUDFLARE_API_TOKEN`, or `CLOUDFLARE_GENERAL_TOKEN`; optional `CLOUDFLARE_ACCOUNT_ID` |
| Pages: trigger deploy | Same as above | Same |
| Fix DNS/TLS (zone) | Zone \| Read, Edit; DNS \| Edit; SSL and TLS \| Edit | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_FULL_ACCESS_TOKEN`, or other key in script list; `CLOUDFLARE_ZONE_ID` if not inferred |
| D1 remote export/execute | D1 \| Edit (or account-level); Workers R2 Storage \| Edit if R2 involved | Wrangler reads `CLOUDFLARE_API_TOKEN` from env when running `wrangler d1 ... --remote` |
| Create additional tokens | Account \| API Tokens \| Create additional tokens | `CLOUDFLARE_BOOTSTRAP_TOKEN` or `CLOUDFLARE_GENERAL_TOKEN` |
| GraphQL Analytics (Workers metrics) | Account \| Analytics Read | Any token with Analytics Read; typically `CLOUDFLARE_API_TOKEN` |

Dashboard: https://dash.cloudflare.com/profile/api-tokens → Create Token → use custom token and add only the permissions above for the task.

## Script-to-env mapping

| Script / command | Env variables used | Notes |
|------------------|--------------------|--------|
| Admin logs API, diagnose-api, admin export | `ADMIN_API_TOKEN` (repo root `.env`) | Bearer token; must match API worker secret |
| Local API dev | `workers/api/.dev.vars`: `ADMIN_API_TOKEN` | Copy from `.dev.vars.example` |
| `npm run pages:set-build` | `CLOUDFLARE_PAGES_TOKEN` or `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_GENERAL_TOKEN` or `CF_API_TOKEN`; `CLOUDFLARE_ACCOUNT_ID` (optional) | Pages Edit |
| `npm run pages:trigger` | Same token list as trigger script | Pages Edit |
| `npm run fix:cloudflare-dns-tls` | One of: `CLOUDFLARE_FULL_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_GENERAL_TOKEN`, `CF_API_TOKEN`, etc.; `CLOUDFLARE_ZONE_ID` optional | Zone + DNS + SSL/TLS Edit |
| `npm run pages:create-full-token` | `CLOUDFLARE_BOOTSTRAP_TOKEN` or `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_GENERAL_TOKEN` or `CF_API_TOKEN` | Create additional tokens; writes `CLOUDFLARE_FULL_ACCESS_TOKEN` to `.env` |
| create-pages-token (script) | Same bootstrap list | Creates a Pages Write token; appends to `CLOUDFLARE_PAGES_TOKEN` or `CLOUDFLARE_API_TOKEN` |
| wrangler d1 export / execute --remote | Token in env (e.g. `CLOUDFLARE_API_TOKEN`) | D1 Edit; run from `workers/api` or with correct cwd |
| verify-env-tokens (if run) | All `CLOUDFLARE_*` vars in `.env` | Verifies each token via Cloudflare API |

## Token key order (pickCloudflareToken)

Scripts that use `pickCloudflareToken([...])` take the first variable that is set. Typical order in this repo:

- Pages: `CLOUDFLARE_PAGES_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_GENERAL_TOKEN`, `CF_API_TOKEN`
- DNS/TLS: `CLOUDFLARE_FULL_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_GENERAL_TOKEN`, `CF_API_TOKEN`, plus others in fix-cloudflare-dns-tls.ts
- Bootstrap (create tokens): `CLOUDFLARE_BOOTSTRAP_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_GENERAL_TOKEN`, `CF_API_TOKEN`

## .env.example variables (repo root)

- `ADMIN_API_TOKEN` – required for admin and log access
- `ADMIN_API_TOKENS` – optional, comma-separated extra Bearer tokens
- `ADMIN_TEST_TOKEN` – optional, for test:admin-portal
- `API_BASE` – optional override for API base URL
- `TEST_URL` – optional, e.g. local frontend
- `CLOUDFLARE_API_TOKEN` – optional; used by Pages, DNS/TLS, D1 wrangler when set
- `CLOUDFLARE_ACCOUNT_ID` – optional; some scripts default to a known account ID

Adding a new Cloudflare capability: add a commented line to `.env.example` and document the required permission in this reference.
