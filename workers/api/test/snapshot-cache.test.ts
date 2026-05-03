import { describe, expect, it } from 'vitest'
import { buildSnapshotKvKey, getCachedOrComputeSnapshot } from '../src/db/snapshot-cache'

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

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

describe('snapshot cache KV hits', () => {
  it('serves a fresh full snapshot from KV without rewriting snapshot bundles', async () => {
    const kv = new MemoryKv()
    const section = 'home_loans'
    const scope = 'window:90D'
    const mainKey = buildSnapshotKvKey(section, scope)
    const payload = {
      builtAt: new Date().toISOString(),
      scope,
      section,
      data: {
        filtersResolved: { startDate: '2026-04-18', endDate: new Date().toISOString().slice(0, 10) },
        siteUi: { ok: true },
        filters: { ok: true, filters: { banks: ['ANZ'] } },
        latestAll: {
          ok: true,
          rows: [{ bank_name: 'ANZ', product_name: 'Example', interest_rate: 5.99 }],
        },
        urls: {},
      },
    }

    kv.values.set(mainKey, JSON.stringify(payload))

    const result = await getCachedOrComputeSnapshot(
      { DB: {} as D1Database, CHART_CACHE_KV: kv as unknown as KVNamespace },
      section,
      scope,
      async () => {
        throw new Error('compute should not run')
      },
    )

    expect(result.fromCache).toBe('kv')
    expect(result.section).toBe(section)
    expect(kv.putCalls).toBe(0)
  })
})
