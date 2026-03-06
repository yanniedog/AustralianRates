import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { adminRoutes } from '../src/routes/admin'
import type { AppContext, EnvBindings, IngestMessage } from '../src/types'

function makeApp() {
  const app = new Hono<AppContext>()
  app.route('/admin', adminRoutes)
  return app
}

function makeEnv(input?: { row?: Record<string, unknown> | null; payloadText?: string | null }) {
  const row = input?.row ?? null
  const payloadText = input?.payloadText ?? null
  const env: EnvBindings = {
    DB: {
      prepare() {
        return {
          bind() {
            return this
          },
          async first() {
            return row
          },
          async all() {
            return { results: [] }
          },
        }
      },
    } as unknown as D1Database,
    RAW_BUCKET: {
      async get() {
        if (payloadText == null) return null
        return {
          async text() {
            return payloadText
          },
        }
      },
    } as unknown as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    ADMIN_API_TOKEN: 'test-admin-token',
  }
  return env
}

describe('admin diagnostics fetch-event payload endpoint', () => {
  it('returns payload body for an existing fetch event id', async () => {
    const app = makeApp()
    const env = makeEnv({
      row: {
        id: 321,
        run_id: 'run:1',
        lender_code: 'ubank',
        dataset_kind: 'home_loans',
        job_kind: 'daily_lender_fetch',
        source_type: 'probe_e2e_alignment_latest_all',
        source_url: 'https://www.australianrates.com/api/home-loan-rates/latest-all?limit=1',
        collection_date: '2026-03-06',
        fetched_at: '2026-03-06T00:00:00.000Z',
        http_status: 200,
        content_hash: 'hash-1',
        body_bytes: 32,
        response_headers_json: '{}',
        duration_ms: 12,
        product_id: null,
        raw_object_created: 1,
        notes: 'probe_capture reason=api_invalid_payload',
        r2_key: 'probe/object.json',
        content_type: 'application/json; charset=utf-8',
      },
      payloadText: '{"rows":[]}',
    })

    const response = await app.request(
      'https://example.test/admin/diagnostics/fetch-events/321/payload',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-admin-token',
        },
      },
      env,
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      event: { id: number }
      payload: { body: string }
    }
    expect(body.ok).toBe(true)
    expect(body.event.id).toBe(321)
    expect(body.payload.body).toBe('{"rows":[]}')
  })

  it('returns 404 when payload object is missing from storage', async () => {
    const app = makeApp()
    const env = makeEnv({
      row: {
        id: 654,
        run_id: 'run:2',
        lender_code: 'ubank',
        dataset_kind: 'home_loans',
        job_kind: 'daily_lender_fetch',
        source_type: 'probe_site_health_dataset_latest_all',
        source_url: 'https://www.australianrates.com/api/home-loan-rates/latest-all?limit=1',
        collection_date: '2026-03-06',
        fetched_at: '2026-03-06T00:00:00.000Z',
        http_status: 200,
        content_hash: 'hash-2',
        body_bytes: 64,
        response_headers_json: '{}',
        duration_ms: 10,
        product_id: null,
        raw_object_created: 1,
        notes: 'probe_capture reason=api_invalid_payload',
        r2_key: 'probe/missing.json',
        content_type: 'application/json; charset=utf-8',
      },
      payloadText: null,
    })

    const response = await app.request(
      'https://example.test/admin/diagnostics/fetch-events/654/payload',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-admin-token',
        },
      },
      env,
    )

    expect(response.status).toBe(404)
    const body = (await response.json()) as {
      ok: boolean
      error: { code: string }
    }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('PAYLOAD_NOT_FOUND')
  })
})
