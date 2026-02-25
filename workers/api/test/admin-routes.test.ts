/**
 * Admin config and admin DB route tests. Uses mock D1 and env; validates auth and allowlist.
 */
import { describe, expect, it } from 'vitest'
import worker from '../src/index'
import type { EnvBindings } from '../src/types'

function makeMockD1(): D1Database {
  const noop = async () => ({ results: [], meta: { changes: 0, last_row_id: 0 } })
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => null as unknown,
        all: async () => ({ results: [], meta: { duration: 0 } }),
        run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
      }),
      first: async () => null as unknown,
      all: noop,
      run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
    }),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database
}

function makeEnv(overrides: Partial<EnvBindings> = {}): EnvBindings {
  return {
    DB: makeMockD1(),
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    ADMIN_API_TOKEN: 'test-admin-token',
    ...overrides,
  }
}

const API_BASE = '/api/home-loan-rates'

describe('admin config routes', () => {
  it('returns 401 for GET /admin/config without auth', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/config`, { method: 'GET' })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(401)
  })

  it('returns 200 for GET /admin/config with Bearer token', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/config`, {
      method: 'GET',
      headers: { Authorization: 'Bearer test-admin-token' },
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; config: unknown[] }
    expect(data.ok).toBe(true)
    expect(Array.isArray(data.config)).toBe(true)
  })

  it('returns 401 with admin_token_not_configured when ADMIN_API_TOKEN is missing and Bearer sent', async () => {
    const env = makeEnv({ ADMIN_API_TOKEN: undefined })
    const req = new Request(`https://x${API_BASE}/admin/config`, {
      method: 'GET',
      headers: { Authorization: 'Bearer any-token' },
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(401)
    const data = await res.json() as { error?: { details?: { reason?: string } } }
    expect(data.error?.details?.reason).toBe('admin_token_not_configured')
  })

  it('returns 200 for GET /admin/env with Bearer token', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/env`, {
      method: 'GET',
      headers: { Authorization: 'Bearer test-admin-token' },
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; env: Record<string, string> }
    expect(data.ok).toBe(true)
    expect(typeof data.env).toBe('object')
    expect(data.env.ADMIN_API_TOKEN).toBeUndefined()
  })

  it('returns 200 for GET /admin/runs/realtime with Bearer token', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/runs/realtime?limit=15`, {
      method: 'GET',
      headers: { Authorization: 'Bearer test-admin-token' },
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(200)
    const data = await res.json() as {
      ok: boolean
      runs: { active: unknown[]; recent: unknown[] }
      historical: { summary: Record<string, unknown>; rows: unknown[] }
      scheduler: Record<string, unknown>
      server_time: string
    }
    expect(data.ok).toBe(true)
    expect(Array.isArray(data.runs.active)).toBe(true)
    expect(Array.isArray(data.runs.recent)).toBe(true)
    expect(Array.isArray(data.historical.rows)).toBe(true)
    expect(typeof data.historical.summary).toBe('object')
    expect(typeof data.scheduler).toBe('object')
    expect(typeof data.server_time).toBe('string')
  })

  it('returns 401 for GET /admin/runs/realtime without auth', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/runs/realtime?limit=15`, { method: 'GET' })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(401)
  })

  it('clamps rate_check_interval_minutes to 360 on PUT /admin/config', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/config`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'rate_check_interval_minutes', value: '15' }),
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; row?: { value?: string } }
    expect(data.ok).toBe(true)
    expect(data.row?.value).toBe('360')
  })

  it('returns 400 for invalid rate_check_interval_minutes on PUT /admin/config', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/config`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'rate_check_interval_minutes', value: 'abc' }),
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(400)
  })
})

describe('admin db routes', () => {
  it('returns 401 for GET /admin/db/tables without auth', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/db/tables`, { method: 'GET' })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(401)
  })

  it('returns 200 and table list for GET /admin/db/tables with auth', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/db/tables`, {
      method: 'GET',
      headers: { Authorization: 'Bearer test-admin-token' },
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; tables: { name: string }[] }
    expect(data.ok).toBe(true)
    expect(data.tables.some((t) => t.name === 'historical_loan_rates')).toBe(true)
    expect(data.tables.some((t) => t.name === 'client_historical_runs')).toBe(true)
    expect(data.tables.some((t) => t.name === 'client_historical_tasks')).toBe(true)
    expect(data.tables.some((t) => t.name === 'client_historical_batches')).toBe(true)
    expect(data.tables.some((t) => t.name === 'app_config')).toBe(false)
  })

  it('returns 400 for GET /admin/db/tables/invalid_table/schema', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/db/tables/invalid_table/schema`, {
      method: 'GET',
      headers: { Authorization: 'Bearer test-admin-token' },
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(400)
  })
})

describe('admin clear routes', () => {
  it('returns 401 for GET /admin/db/clear/options without auth', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/db/clear/options`, { method: 'GET' })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(401)
  })

  it('returns 200 and options for GET /admin/db/clear/options with auth', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/db/clear/options`, {
      method: 'GET',
      headers: { Authorization: 'Bearer test-admin-token' },
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; product_types: unknown[]; scopes: unknown[] }
    expect(data.ok).toBe(true)
    expect(Array.isArray(data.product_types)).toBe(true)
    expect(Array.isArray(data.scopes)).toBe(true)
  })

  it('returns 401 for POST /admin/db/clear without auth', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/db/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_type: 'mortgages', scope: 'entire' }),
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(401)
  })

  it('returns 200 and results for POST /admin/db/clear scope entire with auth', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/db/clear`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_type: 'mortgages', scope: 'entire' }),
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; scope: string; results: { table: string; deleted: number }[] }
    expect(data.ok).toBe(true)
    expect(data.scope).toBe('entire')
    expect(data.results).toHaveLength(1)
    expect(data.results[0].table).toBe('historical_loan_rates')
  })

  it('returns 400 for POST /admin/db/clear product_type all scope individual', async () => {
    const env = makeEnv()
    const req = new Request(`https://x${API_BASE}/admin/db/clear`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_type: 'all', scope: 'individual', key: {} }),
    })
    const res = await (worker as { fetch: (r: Request, e: EnvBindings) => Promise<Response> }).fetch(req, env)
    expect(res.status).toBe(400)
  })
})
