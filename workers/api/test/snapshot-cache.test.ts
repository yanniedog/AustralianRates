import { describe, expect, it } from 'vitest'
import {
  buildSnapshotKvKey,
  buildSnapshotLatestAvailableMetaKvKey,
  getCachedOrComputeSnapshot,
  writeSnapshotKvBundles,
} from '../src/db/snapshot-cache'

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

  it('rejects stale KV snapshot when endDate lags latest available collection date', async () => {
    const kv = new MemoryKv()
    const section = 'home_loans'
    const scope = 'window:90D'
    const mainKey = buildSnapshotKvKey(section, scope)
    const payload = {
      builtAt: '2026-05-04T08:00:00.000Z',
      scope,
      section,
      sourceRunFinishedAt: '2026-05-03T07:00:00.000Z',
      data: {
        filtersResolved: { startDate: '2026-04-01', endDate: '2026-05-03' },
        siteUi: { ok: true },
      },
    }

    kv.values.set(mainKey, JSON.stringify(payload))

    let computed = false
    const result = await getCachedOrComputeSnapshot(
      { DB: {} as D1Database, CHART_CACHE_KV: kv as unknown as KVNamespace },
      section,
      scope,
      async () => {
        computed = true
        return {
          builtAt: new Date().toISOString(),
          scope,
          section,
          data: {
            filtersResolved: { startDate: '2026-04-01', endDate: '2026-05-04' },
            siteUi: { ok: true },
          },
        }
      },
      {
        latestAvailableCollectionDate: '2026-05-04',
        latestRunFinishedAt: '2026-05-04T07:30:00.000Z',
        now: new Date('2026-05-04T10:00:00.000Z'),
        allowD1Fallback: false,
      },
    )

    expect(computed).toBe(true)
    expect(result.fromCache).toBe('live')
    expect((result.data as { filtersResolved?: { endDate?: string } }).filtersResolved?.endDate).toBe('2026-05-04')
  })

  it('writes latest-available meta KV when snapshot bundles are stored', async () => {
    const kv = new MemoryKv()
    const section = 'home_loans' as const
    const scope = 'window:90D' as const
    const payload = {
      builtAt: new Date().toISOString(),
      scope,
      section,
      data: {
        filtersResolved: { startDate: '2026-04-18', endDate: '2026-06-07' },
        siteUi: { ok: true },
      },
    }

    await writeSnapshotKvBundles(kv as unknown as KVNamespace, section, scope, payload, {
      latestAvailableCollectionDate: '2026-06-07',
    })

    const metaKey = buildSnapshotLatestAvailableMetaKvKey(section)
    expect(await kv.get(metaKey)).toBe('2026-06-07')
  })
})
