# Australian Rates Project Configuration

Australian Rates is a monorepo with a static frontend (Cloudflare Pages) and two Workers (API, archive).

## Hard Enforcement Rules (Must Always Be Followed)

These rules are mandatory and override any conflicting preference.

1. Before claiming any deploy-related task is complete, run from repo root:
   - `npm run test:homepage`
   - `npm run test:api`
   - `npm run test:archive`
2. If any command exits non-zero:
   - Do not mark the task complete.
   - Fix the failure, redeploy the affected subproject, and rerun the failing test(s).
   - Repeat until all commands exit `0`.
3. In the final response for deploy-related tasks, include evidence:
   - Exact commands run.
   - Exit codes.
   - Brief pass/fail summary.
4. Deploy or production-impacting changes are not complete unless all required checks pass or the user explicitly instructs to skip checks.
5. Never present assumptions as verification.
   - If a check was not run, state it was not run.

## Production and Hosting

- **Production URL**: https://www.australianrates.com
- **Hosting model**: Cloudflare Pages (frontend), Cloudflare Workers for API and archive (see docs/CLOUDFLARE_USAGE.md).

## Repo-Level Commands

| Purpose | Command | Notes |
|--------|---------|------|
| Test homepage (production URL) | `npm run test:homepage` | From repo root. Playwright. |
| Test API worker | `npm run test:api` | From repo root. |
| Test archive worker | `npm run test:archive` | From repo root. |
| Typecheck API | `npm run typecheck:api` | From repo root. |
| Diagnose API (production) | `node diagnose-api.js` | From repo root. Optional base URL. |
| Deploy API | `npm run deploy:api` | Wrangler deploy for workers/api. |
| Deploy archive | `npm run deploy:archive` | Wrangler deploy for workers/archive. |

## Subproject: workers/api

- **Typecheck**: `npm run typecheck:api` from root.
- **Test**: `npm run test:api` from root.
- **Deploy**: `npm run deploy:api` from root. Requires D1, R2, Queues, Durable Object; migrations; secrets.

## Subproject: workers/archive

- **Test**: `npm run test:archive` from root.
- **Deploy**: `npm run deploy:archive` from root. Dev and prod workers per wrangler config.

## Deployment Verification Checklist

- All relevant tests pass before deploy: `npm run test:api`, `npm run test:archive`, `npm run test:homepage`.
- No console errors on production (www.australianrates.com).
- Critical flows: homepage loads, API health/endpoints respond.
- D1 migrations applied when changing API or archive schema.

## Fix-Redeploy-Retry

- If any check fails, fix the cause, redeploy the affected part, then re-run the relevant test(s).
- **Pages (frontend)**: Deploy via Cloudflare Pages (e.g. git push). No script in repo.
- **API**: `npm run deploy:api` from root.
- **Archive**: `npm run deploy:archive` from root.

## Code Quality Standards

- **Max file size**: 300 lines (flag for review), 500+ lines (trigger refactor).
- **Max function size**: 50 lines.
- **DRY**: No duplicate code across 3+ locations.
- **Modularity**: Single responsibility per file/function.

## Files and Directories That Should NOT Be Refactored

- Build/config: `vite.config.*`, `tsconfig.json`, `wrangler.toml`, `vitest.config.*`.
- Generated: Database migrations, `node_modules`, build output.
- Config: `.env`, `.env.local`, `package.json`.
- Single-purpose entry points: `main.ts`, `index.ts` when they only bootstrap or re-export.
