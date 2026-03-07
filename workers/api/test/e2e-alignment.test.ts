import { afterEach, describe, expect, it, vi } from 'vitest'
import { runE2ECheck } from '../src/pipeline/e2e-alignment'
import type { EnvBindings, IngestMessage } from '../src/types'

function makeDb(targetDate = '2026-03-06'): D1Database {
  let lastRowId = 100
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return this
        },
        async first<T>() {
          if (sql.includes('MAX(collection_date) AS latest')) {
            return { latest: targetDate } as T
          }
          if (sql.includes("FROM run_reports") && sql.includes("run_type = 'daily'")) {
            return { latest: new Date().toISOString() } as T
          }
          if (sql.includes("FROM run_reports") && sql.includes("status = 'running'")) {
            return { n: 0 } as T
          }
          if (sql.includes('FROM raw_objects')) {
            return null
          }
          return null
        },
        async run() {
          if (sql.includes('INSERT INTO fetch_events')) {
            lastRowId += 1
            return { meta: { last_row_id: lastRowId, changes: 1 } }
          }
          return { meta: { changes: 1 } }
        },
      }
    },
  } as unknown as D1Database
}

function makeEnv(db: D1Database): EnvBindings {
  return {
    DB: db,
    RAW_BUCKET: {
      async put() {},
    } as unknown as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    MELBOURNE_TIMEZONE: 'Australia/Melbourne',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('e2e alignment API classification', () => {
  it('passes when all latest-all payloads are valid and include the target date', async () => {
    var urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url))
        return new Response(JSON.stringify({ rows: [{ collection_date: '2026-03-06' }] }), { status: 200 })
      }),
    )

    const result = await runE2ECheck(makeEnv(makeDb()), {
      origin: 'https://probe.example.com',
    })

    expect(result.reasonCode).toBe('e2e_ok')
    expect(result.aligned).toBe(true)
    expect(result.sourceMode).toBe('all')
    expect(result.datasets).toHaveLength(3)
    expect(urls.every((url) => url.includes('source_mode=all'))).toBe(true)
  })

  it('returns api_invalid_payload for 200 HTML/challenge responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/home-loan-rates/')) {
          return new Response('<html><title>Sorry, you have been blocked</title></html>', { status: 200 })
        }
        return new Response(JSON.stringify({ rows: [{ collection_date: '2026-03-06' }] }), { status: 200 })
      }),
    )

    const result = await runE2ECheck(makeEnv(makeDb()), {
      origin: 'https://probe.example.com',
    })

    expect(result.reasonCode).toBe('api_invalid_payload')
    expect(result.aligned).toBe(false)
    expect(result.reasonDetail).toContain('fetch_event_ids')
  })

  it('returns api_unreachable when latest-all returns non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/savings-rates/')) {
          return new Response('upstream error', { status: 503 })
        }
        return new Response(JSON.stringify({ rows: [{ collection_date: '2026-03-06' }] }), { status: 200 })
      }),
    )

    const result = await runE2ECheck(makeEnv(makeDb()), {
      origin: 'https://probe.example.com',
    })

    expect(result.reasonCode).toBe('api_unreachable')
    expect(result.aligned).toBe(false)
  })
})
