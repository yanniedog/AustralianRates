# AustralianRates

Standalone Australian home loan rates project hosted on Cloudflare.

- GitHub repository: `https://github.com/yanniedog/AustralianRates`

## Production URLs

- Site: `https://www.australianrates.com` and `https://australianrates.com`
- API base: `https://www.australianrates.com/api/home-loan-rates` and `https://australianrates.com/api/home-loan-rates`
- Admin portal: `https://www.australianrates.com/admin/` (login with your admin API token; see [Admin portal](#admin-portal) below).

## Verified Production Status (2026-02-23)

- GitHub integration: Pages project `australianrates` is connected to `yanniedog/AustralianRates` (`Git Provider: Yes`).
- Custom domains: `www.australianrates.com` and `australianrates.com` are attached and verified in Pages.
- Routing split:
  - Pages serves frontend at `/` on apex + www.
  - Worker serves `/api/home-loan-rates/*` on apex + www.
- Public API checks: `/health`, `/latest`, `/latest-all`, `/timeseries`, and `/export.csv` return successful responses.

## Repository Layout

- `workers/api`: Cloudflare Worker API (Hono, D1, R2, Queue, Durable Object)
- `workers/archive`: Archive/discovery worker (D1, R2, Queue)
- `site`: Static dashboard deployed with Cloudflare Pages

## Product Features

- Daily mortgage rate ingestion for major Australian lenders (CDR-first, web fallback).
- Historical backfill ingestion from Wayback snapshots.
- RBA cash rate ingestion from the official RBA F1 data feed.
- Public tabbed UI:
  - Daily Rates
  - Historical Backfill
- Public CSV export endpoint:
  - `GET /api/home-loan-rates/export.csv`
- Public APIs:
  - `GET /api/home-loan-rates/health`
  - `GET /api/home-loan-rates/filters`
  - `GET /api/home-loan-rates/latest`
  - `GET /api/home-loan-rates/latest-all`
  - `GET /api/home-loan-rates/timeseries`
  - `GET /api/home-loan-rates/export.csv`

`/latest` remains backward-compatible. Use `/latest-all` for latest-per-product coverage across the full filtered dataset.

## Admin portal

The admin portal is a separate UI for managing database, configuration, and ingest runs.

- **URL (production):** [https://www.australianrates.com/admin/](https://www.australianrates.com/admin/)
- **Login:** There is no username/password. You log in with the **admin API token** (the same value as the API worker secret `ADMIN_API_TOKEN`).
  1. Open the admin URL above (or use the "Admin" link in the site header).
  2. On the login page, paste your admin API token into the "API token" field and submit.
  3. The token is validated against the API; if it matches, you are redirected to the dashboard (Database, Configuration, Runs).
- **Getting the token:** For production it is the secret you set with `wrangler secret put ADMIN_API_TOKEN` when deploying the API worker. For local dev it is the value in `workers/api/.dev.vars` (see `workers/api/.dev.vars.example`). Only people with access to that secret (or `.dev.vars`) can log in.

## Local Setup

1. Install dependencies:
   - `npm run install:all`
2. For API worker:
   - `cd workers/api`
   - `wrangler secret put ADMIN_API_TOKEN`
   - `npm run dev`
3. For archive worker:
   - `cd workers/archive`
   - `npm run dev`

## Cloudflare Resources

Create resources in the Cloudflare account that owns `australianrates.com`:

- API worker:
  - D1 database: `australianrates_api`
  - R2 bucket: `australianrates-raw`
  - Queue: `australianrates-ingest`
  - DLQ: `australianrates-ingest-dlq`
  - Durable Object class: `RunLockDO`
- Archive worker:
  - D1 databases: `australianrates-archive-dev`, `australianrates-archive-prod`
  - R2 buckets: `australianrates-archive-raw-dev`, `australianrates-archive-raw-prod`
  - Queues: `australianrates-collector-queue-dev`, `australianrates-collector-queue-prod`

Update IDs/names in:

- `workers/api/wrangler.toml`
- `workers/archive/wrangler.jsonc`

## Migrations

- API:
  - `cd workers/api`
  - `wrangler d1 migrations apply australianrates_api --remote`
  - `wrangler d1 migrations apply australianrates_api --remote` (includes `0002_rba_cash_rates.sql`)
- Archive:
  - `cd workers/archive`
  - `wrangler d1 migrations apply australianrates-archive-dev --env dev --remote`
  - `wrangler d1 migrations apply australianrates-archive-prod --env prod --remote`

## Test protocol

Comprehensive tests for the site and API:

- **Homepage (Playwright):** `npm run test:homepage` — page load, hero, tabs, filters, table, download (`#download-format`), Apply Filters, Pivot load, Chart draw, Check Rates Now, URL state, viewports, accessibility (skip link, tab roles). Screenshots in `test-screenshots/`.
- **API diagnostics:** `npm run diagnose:api` — health, filters, rates, latest, latest-all, timeseries, export.csv, homepage.
- **Full site:** `npm run test:site` — runs test:homepage then diagnose:api; exits with failure if either fails.

**Configuration:** `TEST_URL` (e.g. `TEST_URL=http://localhost:8788/`) for frontend and API base; `API_BASE` to override API only; `HEADLESS=0` to show browser.

See [docs/TEST_PROTOCOL.md](docs/TEST_PROTOCOL.md) for the full test protocol (rendering, interaction, content, a11y, API) and manual checklist.

## Deploy

- API worker:
  - `npm run deploy:api`
- Archive worker:
  - `npm run deploy:archive`

## Cloudflare Hosting

1. Create a Cloudflare Pages project from this repository.
2. Configure Pages build settings (mandatory):
   - Build command: `npm run build`
   - Build output directory: `site`
   - This generates `site/version.json` from `CF_PAGES_COMMIT_SHA` so the footer can show `In sync` or `Behind`. Without it, footer status shows `Unknown` and deploy version is unavailable.
3. Add custom domains `www.australianrates.com` and `australianrates.com` to the Pages project.
4. Deploy API worker and set route:
   - `www.australianrates.com/api/home-loan-rates/*`
   - `australianrates.com/api/home-loan-rates/*`
5. If needed, deploy archive worker and add a route for archive admin endpoints.

### DNS requirements for apex + www

If custom domains show `CNAME record not set`, add DNS records in the `australianrates.com` zone:

- `CNAME` `www` -> `australianrates.pages.dev` (proxied)
- `CNAME` `@` -> `australianrates.pages.dev` (proxied, if your plan/settings support apex CNAME flattening)

After DNS propagation, both:

- `https://www.australianrates.com`
- `https://australianrates.com`

should resolve to Pages, and `/api/home-loan-rates/*` should be served by the API Worker route.

## Daily operations runbook

1. Automated scheduled runs are triggered by API worker cron schedules in `workers/api/wrangler.toml` (every 6 hours).
2. Scheduled run workflow:
   - refresh CDR endpoint cache
   - ingest lender product data
   - normalize and upsert rows
   - collect and store RBA cash rate
3. Backfill runs can be triggered via admin endpoint:
   - `POST /api/home-loan-rates/admin/runs/backfill`
4. Monitor:
   - `GET /api/home-loan-rates/admin/runs`
   - D1 `run_reports` table
5. Validate public output:
   - `GET /api/home-loan-rates/latest?mode=daily`
   - `GET /api/home-loan-rates/latest?mode=historical`
   - `GET /api/home-loan-rates/latest-all?mode=daily`
   - `GET /api/home-loan-rates/export.csv?mode=daily`
