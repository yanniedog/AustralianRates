import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { adminRoutes } from '../src/routes/admin'
import type { AppContext, EnvBindings, IngestMessage } from '../src/types'

function makeApp() {
  const app = new Hono<AppContext>()
  app.route('/admin', adminRoutes)
  return app
}

function makeEnv() {
  const env: EnvBindings = {
    DB: {
      prepare(sql: string) {
        return {
          bind(..._args: unknown[]) {
            return this
          },
          async all() {
            if (sql.includes('FROM lender_dataset_runs') && sql.includes('GROUP BY dataset_kind, lender_code, bank_name')) {
              return {
                results: [
                  { dataset_kind: 'home_loans', lender_code: 'anz', bank_name: 'ANZ', count: 3, oldest_updated_at: '2026-03-06T00:00:00.000Z', newest_updated_at: '2026-03-07T00:00:00.000Z' },
                  { dataset_kind: 'savings', lender_code: 'ubank', bank_name: 'ubank', count: 1, oldest_updated_at: '2026-03-06T01:00:00.000Z', newest_updated_at: '2026-03-07T01:00:00.000Z' },
                ],
              }
            }
            if (sql.includes('JOIN run_reports rr')) {
              return {
                results: [
                  { dataset_kind: 'home_loans', lender_code: 'anz', bank_name: 'ANZ', count: 2, oldest_updated_at: '2026-03-05T00:00:00.000Z', newest_updated_at: '2026-03-06T00:00:00.000Z' },
                ],
              }
            }
            if (sql.includes('missing_fetch_event_lineage') || sql.includes('historical_loan_rates')) {
              return {
                results: [
                  { dataset_kind: 'term_deposits', lender_code: null, bank_name: 'ING', count: 7, oldest_collection_date: '2026-02-01', newest_collection_date: '2026-03-07' },
                ],
              }
            }
            return { results: [] }
          },
          async first() {
            return null
          },
        }
      },
    } as unknown as D1Database,
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    ADMIN_API_TOKEN: 'test-admin-token',
  }
  return env
}

describe('admin diagnostics backlog endpoint', () => {
  it('returns grouped backlog counts for reconcile and lineage work', async () => {
    const app = makeApp()
    const response = await app.request(
      'https://example.test/admin/diagnostics/backlog?lookback_days=365',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-admin-token',
        },
      },
      makeEnv(),
    )

    expect(response.status).toBe(200)
    const body = await response.json() as {
      ok: boolean
      backlog: {
        ready_finalizations: { total: number; rows: Array<Record<string, unknown>> }
        stale_running_runs: { total: number; rows: Array<Record<string, unknown>> }
        missing_fetch_event_lineage: { total: number; lookback_days: number; rows: Array<Record<string, unknown>> }
      }
    }

    expect(body.ok).toBe(true)
    expect(body.backlog.ready_finalizations.total).toBe(4)
    expect(body.backlog.stale_running_runs.total).toBe(2)
    expect(body.backlog.missing_fetch_event_lineage.total).toBe(7)
    expect(body.backlog.missing_fetch_event_lineage.lookback_days).toBe(365)
    expect(body.backlog.ready_finalizations.rows[0].lender_code).toBe('anz')
  })
})
