import { describe, expect, it } from 'vitest'
import { buildChartCacheKey, getCachedOrCompute } from '../src/db/chart-cache'

class MemoryKv {
  readonly values = new Map<string, string>()
  putCalls = 0

  async get(key: string): Promise<string | null> {
    return this.values.has(key) ? this.values.get(key) ?? null : null
  }

  async put(key: string, value: string): Promise<void> {
    this.putCalls += 1
    this.values.set(key, value)
  }
}

describe('chart cache KV freshness', () => {
  function emptyDb(): D1Database {
    return {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
        }),
      }),
    } as unknown as D1Database
  }

  it('rejects stale KV chart payload without metadata and falls through to compute', async () => {
    const kv = new MemoryKv()
    const key = buildChartCacheKey('home_loans', 'day', { __kvDay: '2026-06-07' })
    kv.values.set(
      key,
      JSON.stringify({
        rows: [{ collection_date: '2026-06-05', interest_rate: 5.99 }],
        representation: 'day',
        fallbackReason: null,
      }),
    )

    let computed = false
    const result = await getCachedOrCompute(
      { DB: emptyDb(), CHART_CACHE_KV: kv as unknown as KVNamespace },
      'home_loans',
      'day',
      { __kvDay: '2026-06-07' },
      async () => {
        computed = true
        return {
          rows: [{ collection_date: '2026-06-07', interest_rate: 5.49 }],
          representation: 'day' as const,
          fallbackReason: null,
        }
      },
      {
        latestAvailableCollectionDate: '2026-06-07',
      },
    )

    expect(computed).toBe(true)
    expect(result.fromCache).toBe('live')
    expect(result.rows[0]?.collection_date).toBe('2026-06-07')
  })

  it('does not write bounded-stale D1 chart cache into KV', async () => {
    const kv = new MemoryKv()
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            payload_json: JSON.stringify({
              v: 2,
              builtAt: '2026-06-05T08:00:00.000Z',
              filtersResolved: { startDate: '2026-04-01', endDate: '2026-06-05' },
              sourceRunFinishedAt: '2026-06-05T07:00:00.000Z',
              rows: [{ collection_date: '2026-06-05', interest_rate: 5.99 }],
            }),
            built_at: '2026-06-05T08:00:00.000Z',
          }),
        }),
      }),
    } as unknown as D1Database

    const result = await getCachedOrCompute(
      { DB: db, CHART_CACHE_KV: kv as unknown as KVNamespace },
      'home_loans',
      'day',
      { __kvDay: '2026-06-07' },
      async () => {
        throw new Error('compute should not run')
      },
      {
        latestAvailableCollectionDate: '2026-06-07',
      },
    )

    expect(result.fromCache).toBe('d1')
    expect(result.fallbackReason).not.toBeNull()
    expect(kv.putCalls).toBe(0)
  })

  it('writes fresh D1 chart cache into KV with freshness metadata', async () => {
    const kv = new MemoryKv()
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('run_reports')) return null
            return {
              payload_json: JSON.stringify({
                v: 2,
                builtAt: '2026-06-07T08:00:00.000Z',
                filtersResolved: { startDate: '2026-04-01', endDate: '2026-06-07' },
                sourceRunFinishedAt: '2026-06-07T07:30:00.000Z',
                rows: [{ collection_date: '2026-06-07', interest_rate: 5.49 }],
              }),
              built_at: '2026-06-07T08:00:00.000Z',
            }
          },
        }),
      }),
    } as unknown as D1Database

    const result = await getCachedOrCompute(
      { DB: db, CHART_CACHE_KV: kv as unknown as KVNamespace },
      'home_loans',
      'day',
      { __kvDay: '2026-06-07' },
      async () => {
        throw new Error('compute should not run')
      },
      {
        latestAvailableCollectionDate: '2026-06-07',
      },
    )

    expect(result.fromCache).toBe('d1')
    expect(result.fallbackReason).toBeNull()
    expect(kv.putCalls).toBe(1)
    const stored = JSON.parse(kv.values.values().next().value as string) as {
      builtAt?: string
      filtersResolved?: { endDate?: string }
    }
    expect(stored.builtAt).toBe('2026-06-07T08:00:00.000Z')
    expect(stored.filtersResolved?.endDate).toBe('2026-06-07')
  })
})
