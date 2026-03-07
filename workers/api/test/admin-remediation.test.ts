import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { adminRoutes } from '../src/routes/admin'
import type { AppContext, EnvBindings, IngestMessage } from '../src/types'

function makeApp() {
  const app = new Hono<AppContext>()
  app.route('/admin', adminRoutes)
  return app
}

function makeEnv(): EnvBindings {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind(..._args: unknown[]) {
            return this
          },
          async first() {
            if (sql.includes('FROM historical_loan_rates rates')) {
              return {
                total_rows: 12,
                missing_fetch_event_rows: 3,
                missing_hash_rows: 1,
              }
            }
            return null
          },
          async all() {
            if (sql.includes('FROM historical_loan_rates rates')) {
              return {
                results: [
                  {
                    bank_name: 'ING',
                    product_id: 'prod-1',
                    collection_date: '2026-03-07',
                    run_id: 'daily:2026-03-07:2026-03-06T13:05:59.000Z',
                    source_url: 'https://example.test/products/prod-1',
                    cdr_product_detail_hash: 'hash-1',
                  },
                ],
              }
            }
            if (sql.includes('FROM fetch_events')) {
              return {
                results: [
                  { source_type: 'cdr_products', count: 7 },
                  { source_type: 'cdr_product_detail', count: 3 },
                ],
              }
            }
            return { results: [] }
          },
        }
      },
    } as unknown as D1Database,
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    ADMIN_API_TOKEN: 'test-admin-token',
  }
}

describe('admin remediation lineage diagnostics', () => {
  it('returns filtered fetch-event and missing-lineage summaries', async () => {
    const app = makeApp()
    const response = await app.request(
      'https://example.test/admin/diagnostics/lineage?run_id=run-1&lender_code=ing&dataset=home_loans',
      {
        headers: {
          Authorization: 'Bearer test-admin-token',
        },
      },
      makeEnv(),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      filters: { run_id: string; lender_code: string; dataset: string }
      fetch_events: Array<{ source_type: string; count: number }>
      datasets: Array<{ dataset: string; missing_fetch_event_rows: number; sample: Array<Record<string, unknown>> }>
    }

    expect(body.ok).toBe(true)
    expect(body.filters).toEqual({
      run_id: 'run-1',
      lender_code: 'ing',
      dataset: 'home_loans',
    })
    expect(body.fetch_events[0]).toEqual({ source_type: 'cdr_products', count: 7 })
    expect(body.datasets[0].dataset).toBe('home_loans')
    expect(body.datasets[0].missing_fetch_event_rows).toBe(3)
    expect(body.datasets[0].sample[0].product_id).toBe('prod-1')
  })
})
