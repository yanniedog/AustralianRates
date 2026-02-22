# AustralianRates

Standalone Australian home loan rates project hosted on Cloudflare.

- GitHub repository: `https://github.com/yanniedog/AustralianRates`

## Production URLs

- Site: `https://www.australianrates.com` and `https://australianrates.com`
- API base: `https://www.australianrates.com/api/home-loan-rates` and `https://australianrates.com/api/home-loan-rates`

## Verified Production Status (2026-02-23)

- GitHub integration: Pages project `australianrates` is connected to `yanniedog/AustralianRates` (`Git Provider: Yes`).
- Custom domains: `www.australianrates.com` and `australianrates.com` are attached and verified in Pages.
- Routing split:
  - Pages serves frontend at `/` on apex + www.
  - Worker serves `/api/home-loan-rates/*` on apex + www.
- Public API checks: `/health`, `/latest` (daily + historical), `/timeseries`, and `/export.csv` return successful responses.

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
  - `GET /api/home-loan-rates/timeseries`
  - `GET /api/home-loan-rates/export.csv`

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

## Deploy

- API worker:
  - `npm run deploy:api`
- Archive worker:
  - `npm run deploy:archive`

## Cloudflare Hosting

1. Create a Cloudflare Pages project from this repository and set publish directory to `site`.
2. Add custom domains `www.australianrates.com` and `australianrates.com` to the Pages project.
3. Deploy API worker and set route:
   - `www.australianrates.com/api/home-loan-rates/*`
   - `australianrates.com/api/home-loan-rates/*`
4. If needed, deploy archive worker and add a route for archive admin endpoints.

### DNS requirements for apex + www

If custom domains show `CNAME record not set`, add DNS records in the `australianrates.com` zone:

- `CNAME` `www` -> `australianrates.pages.dev` (proxied)
- `CNAME` `@` -> `australianrates.pages.dev` (proxied, if your plan/settings support apex CNAME flattening)

After DNS propagation, both:

- `https://www.australianrates.com`
- `https://australianrates.com`

should resolve to Pages, and `/api/home-loan-rates/*` should be served by the API Worker route.

## Daily operations runbook

1. Automated daily runs are triggered by API worker cron schedules in `workers/api/wrangler.toml`.
2. Daily run workflow:
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
   - `GET /api/home-loan-rates/export.csv?mode=daily`
