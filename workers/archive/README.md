# Archive Worker

The archive worker is the separate Cloudflare Worker responsible for discovery and collection support outside the main public API worker.

## Purpose

- Discover CDR register endpoints
- Persist discovery state and run reports in a dedicated D1 database
- Store raw archive payloads in a dedicated R2 bucket
- Fan out collection work through a dedicated Cloudflare Queue

## Entry Points

- `src/index.ts`
  - `fetch`: health, debug, and gated admin endpoints
  - `scheduled`: daily discovery enqueue path
  - `queue`: queue consumer for ping and discovery jobs
- `src/discovery.ts`
  - run-lock acquisition
  - discovery health reads
  - CDR register discovery workflow

## Environments

`wrangler.jsonc` defines two environments:

- `dev`
  - worker name `australianrates-archive-dev`
  - D1 `australianrates-archive-dev`
  - R2 `australianrates-archive-raw-dev`
  - Queue `australianrates-collector-queue-dev`
- `prod`
  - worker name `australianrates-archive-prod`
  - D1 `australianrates-archive-prod`
  - R2 `australianrates-archive-raw-prod`
  - Queue `australianrates-collector-queue-prod`

Current feature flags:

- `FEATURE_ARCHIVE_QUEUE_TEST_ENABLED`
- `FEATURE_ARCHIVE_ADMIN_ENABLED`
- `FEATURE_ARCHIVE_DEBUG_ENABLED`

Sensitive fetch endpoints also require the `ARCHIVE_OPERATOR_TOKEN` secret when their feature flag is enabled.
Use `Authorization: Bearer <token>` for:

- `/api/admin/*`
- `/api/debug/*`
- `/api/queue-test`
- `/api/queue-test/result`

## Commands

- Dev: `npm run dev:archive`
- Test: `npm run test:archive`
- Deploy both envs: `npm run deploy:archive`
- Deploy one env: `npm run deploy:archive -- --env dev` or `npm run deploy:archive -- --env prod`
- Regenerate types after binding changes: `npm run cf-typegen -w workers/archive`

## Cloudflare Checks

Before adding heavier archive endpoints, queue workloads, or large D1 scans, check the current platform limits:

- Workers: https://developers.cloudflare.com/workers/platform/limits/
- D1: https://developers.cloudflare.com/d1/platform/limits/
- Queues: https://developers.cloudflare.com/queues/platform/limits/
- R2: https://developers.cloudflare.com/r2/platform/limits/

Also keep `workers/archive/AGENTS.md` in mind: re-check the current Cloudflare docs before binding or platform changes.
