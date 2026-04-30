import { describe, expect, it } from 'vitest'
import { buildSnapshotInlineKvKey, buildSnapshotKvKey, getCachedOrComputeSnapshot } from '../src/db/snapshot-cache'

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

describe('snapshot cache KV healing', () => {
  it('backfills the inline KV entry when serving a full snapshot from KV', async () => {
    const kv = new MemoryKv()
    const section = 'home_loans'
    const scope = 'window:90D'
    const mainKey = buildSnapshotKvKey(section, scope)
    const inlineKey = buildSnapshotInlineKvKey(section, scope)
    const payload = {
      builtAt: '2026-04-19T00:00:00.000Z',
      scope,
      section,
      data: {
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
    expect(kv.values.get(inlineKey)).toBeTruthy()
    expect(kv.putCalls).toBeGreaterThan(0)
  })
})
