# australianrates

Standalone Australian home loan rates project migrated from `orderskew`, hosted on Cloudflare.

## Production URLs

- Site: `https://www.australianrates.com`
- API base: `https://www.australianrates.com/api/home-loan-rates`

## Repository Layout

- `workers/api`: Cloudflare Worker API (Hono, D1, R2, Queue, Durable Object)
- `workers/archive`: Archive/discovery worker (D1, R2, Queue)
- `site`: Static dashboard deployed with Cloudflare Pages

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
2. Add custom domain `www.australianrates.com` to the Pages project.
3. Deploy API worker and set route:
   - `www.australianrates.com/api/home-loan-rates/*`
4. If needed, deploy archive worker and add a route for archive admin endpoints.
