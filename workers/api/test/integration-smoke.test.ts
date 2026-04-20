import { describe, expect, it } from 'vitest'
import worker from '../src/index'
import type { EnvBindings, IngestMessage } from '../src/types'

function makeExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext
}

function makeEnv(overrides?: Partial<EnvBindings>): EnvBindings {
  return {
    DB: {} as D1Database,
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    ...overrides,
  }
}

async function fetchResponse(pathname: string, envOverrides?: Partial<EnvBindings>) {
  const fetchHandler = worker.fetch?.bind(worker)
  if (!fetchHandler) throw new Error('worker fetch handler is missing')
  const request = new Request(`https://example.com${pathname}`) as unknown as Request<
    unknown,
    IncomingRequestCfProperties<unknown>
  >
  return fetchHandler(
    request,
    makeEnv(envOverrides),
    makeExecutionContext(),
  )
}

async function fetchJson(pathname: string, envOverrides?: Partial<EnvBindings>) {
  const response = await fetchResponse(pathname, envOverrides)
  const json = (await response.json()) as {
    ok?: boolean
    error?: { code?: string }
  }
  return { status: response.status, json }
}

describe('api route integration smoke', () => {
  it('serves health endpoint contract', async () => {
    const { status, json } = await fetchJson('/api/home-loan-rates/health')
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('serves economic health endpoint contract', async () => {
    const { status, json } = await fetchJson('/api/economic-data/health')
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('disables public system log routes with stable 403 payload', async () => {
    for (const endpoint of ['/api/home-loan-rates/logs', '/api/home-loan-rates/logs/stats']) {
      const { status, json } = await fetchJson(endpoint)
      expect(status).toBe(403)
      expect(json.ok).toBe(false)
      expect(json.error?.code).toBe('PUBLIC_LOGS_DISABLED')
    }
  })

  it('requires authentication for admin endpoints', async () => {
    for (const endpoint of [
      '/api/home-loan-rates/admin/runs',
      '/api/home-loan-rates/admin/downloads',
      '/api/home-loan-rates/admin/downloads/test-job/download',
      '/api/home-loan-rates/admin/downloads/test-job/restore/analysis',
      '/api/home-loan-rates/admin/analytics/projections/diagnostics',
      '/api/home-loan-rates/admin/diagnostics/status-debug-bundle',
    ]) {
      const { status, json } = await fetchJson(endpoint)
      expect(status).toBe(401)
      expect(json.ok).toBe(false)
      expect(json.error?.code).toBe('UNAUTHORIZED')
    }
  })

  it('requires authentication for admin CDR audit endpoints', async () => {
    for (const endpoint of [
      '/api/home-loan-rates/admin/cdr-audit',
      '/api/home-loan-rates/admin/cdr-audit/run',
      '/api/home-loan-rates/admin/repairs/known-cdr-anomalies',
    ]) {
      const method = endpoint.endsWith('/run') ? 'POST' : 'GET'
      const requestMethod = endpoint.endsWith('/known-cdr-anomalies') ? 'POST' : method
      const fetchHandler = worker.fetch?.bind(worker)
      if (!fetchHandler) throw new Error('worker fetch handler is missing')
      const request = new Request(`https://example.com${endpoint}`, { method: requestMethod }) as unknown as Request<
        unknown,
        IncomingRequestCfProperties<unknown>
      >
      const response = await fetchHandler(request, makeEnv(), makeExecutionContext())
      const json = (await response.json()) as { ok?: boolean; error?: { code?: string } }
      expect(response.status).toBe(401)
      expect(json.ok).toBe(false)
      expect(json.error?.code).toBe('UNAUTHORIZED')
    }
  })

  it('requires authentication for admin chart cache refresh', async () => {
    const fetchHandler = worker.fetch?.bind(worker)
    if (!fetchHandler) throw new Error('worker fetch handler is missing')
    const request = new Request('https://example.com/api/home-loan-rates/admin/chart-cache/refresh', {
      method: 'POST',
    }) as unknown as Request<unknown, IncomingRequestCfProperties<unknown>>
    const response = await fetchHandler(request, makeEnv(), makeExecutionContext())
    const json = (await response.json()) as { ok?: boolean; error?: { code?: string } }
    expect(response.status).toBe(401)
    expect(json.ok).toBe(false)
    expect(json.error?.code).toBe('UNAUTHORIZED')
  })

  it('requires authentication for admin stale UBank lender-dataset repair', async () => {
    const fetchHandler = worker.fetch?.bind(worker)
    if (!fetchHandler) throw new Error('worker fetch handler is missing')
    const request = new Request(
      'https://example.com/api/home-loan-rates/admin/repairs/stale-ubank-zero-expected-lender-datasets',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: true }),
      },
    ) as unknown as Request<unknown, IncomingRequestCfProperties<unknown>>
    const response = await fetchHandler(request, makeEnv(), makeExecutionContext())
    const json = (await response.json()) as { ok?: boolean; error?: { code?: string } }
    expect(response.status).toBe(401)
    expect(json.ok).toBe(false)
    expect(json.error?.code).toBe('UNAUTHORIZED')
  })

  it('requires authentication for admin download creation endpoints', async () => {
    const fetchHandler = worker.fetch?.bind(worker)
    if (!fetchHandler) throw new Error('worker fetch handler is missing')
    const request = new Request('https://example.com/api/home-loan-rates/admin/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream: 'canonical', scope: 'all', mode: 'snapshot' }),
    }) as unknown as Request<unknown, IncomingRequestCfProperties<unknown>>
    const response = await fetchHandler(request, makeEnv(), makeExecutionContext())
    const json = (await response.json()) as { ok?: boolean; error?: { code?: string } }
    expect(response.status).toBe(401)
    expect(json.ok).toBe(false)
    expect(json.error?.code).toBe('UNAUTHORIZED')
  })

  it('requires authentication for admin download deletion endpoints', async () => {
    const fetchHandler = worker.fetch?.bind(worker)
    if (!fetchHandler) throw new Error('worker fetch handler is missing')
    const request = new Request('https://example.com/api/home-loan-rates/admin/downloads', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_ids: ['job-1'] }),
    }) as unknown as Request<unknown, IncomingRequestCfProperties<unknown>>
    const response = await fetchHandler(request, makeEnv(), makeExecutionContext())
    const json = (await response.json()) as { ok?: boolean; error?: { code?: string } }
    expect(response.status).toBe(401)
    expect(json.ok).toBe(false)
    expect(json.error?.code).toBe('UNAUTHORIZED')
  })

  it('requires authentication for admin download retry endpoints', async () => {
    const fetchHandler = worker.fetch?.bind(worker)
    if (!fetchHandler) throw new Error('worker fetch handler is missing')
    const request = new Request('https://example.com/api/home-loan-rates/admin/downloads/test-job/retry', {
      method: 'POST',
    }) as unknown as Request<unknown, IncomingRequestCfProperties<unknown>>
    const response = await fetchHandler(request, makeEnv(), makeExecutionContext())
    const json = (await response.json()) as { ok?: boolean; error?: { code?: string } }
    expect(response.status).toBe(401)
    expect(json.ok).toBe(false)
    expect(json.error?.code).toBe('UNAUTHORIZED')
  })

  it('requires authentication for admin download restore endpoints', async () => {
    const fetchHandler = worker.fetch?.bind(worker)
    if (!fetchHandler) throw new Error('worker fetch handler is missing')
    for (const request of [
      new Request('https://example.com/api/home-loan-rates/admin/downloads/test-job/restore/analysis'),
      new Request('https://example.com/api/home-loan-rates/admin/downloads/test-job/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      }),
    ]) {
      const response = await fetchHandler(request as unknown as Request<unknown, IncomingRequestCfProperties<unknown>>, makeEnv(), makeExecutionContext())
      const json = (await response.json()) as { ok?: boolean; error?: { code?: string } }
      expect(response.status).toBe(401)
      expect(json.ok).toBe(false)
      expect(json.error?.code).toBe('UNAUTHORIZED')
    }
  })
})
