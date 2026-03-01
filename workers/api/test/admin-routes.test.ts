/**
 * Admin config and admin DB route tests. Require real D1 and env (run with vitest-pool-workers or integration).
 * No mock or simulated data; these tests are skipped until run with real bindings.
 */
import { describe, it } from 'vitest'

describe('admin routes (requires real D1/integration)', () => {
  it.skip('returns 401 for GET /admin/config without auth')
  it.skip('returns 200 for GET /admin/config with Bearer token')
  it.skip('returns 401 with admin_token_not_configured when ADMIN_API_TOKEN is missing and Bearer sent')
  it.skip('returns 200 for GET /admin/env with Bearer token')
  it.skip('returns 200 for GET /admin/runs/realtime with Bearer token')
  it.skip('returns 401 for GET /admin/runs/realtime without auth')
  it.skip('returns 200 for GET /admin/runs/realtime with CF-Access header when AUD is set')
  it.skip('returns 401 for GET /admin/runs/realtime with wrong CF-Access JWT')
  it.skip('returns 200 for GET /admin/logs/system with Bearer token')
  it.skip('returns 503 CODE_FILTER_UNSUPPORTED when code filter is used and DB has no code column')
  it.skip('returns 410 for POST /admin/historical/pull/tasks/claim (deprecation)')
})
