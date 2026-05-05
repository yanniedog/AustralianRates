import { describe, expect, it, vi } from 'vitest'
import { readD1ChartCache } from '../src/db/chart-cache'
import { isPublicDailyCacheFresh } from '../src/db/public-cache-freshness'

describe('public daily cache freshness', () => {
  const now = new Date('2026-05-03T10:00:00.000Z')

  it('keeps a two-hour-old package fresh for the current Melbourne data day', () => {
    expect(
      isPublicDailyCacheFresh({
        now,
        builtAt: '2026-05-03T08:00:00.000Z',
        filtersResolved: { startDate: '2026-05-01', endDate: '2026-05-03' },
      }),
    ).toBe(true)
  })

  it('rejects packages older than the daily cache bridge window', () => {
    expect(
      isPublicDailyCacheFresh({
        now,
        builtAt: '2026-05-01T20:59:59.000Z',
        filtersResolved: { startDate: '2026-05-01', endDate: '2026-05-03' },
      }),
    ).toBe(false)
  })

  it('rejects packages older than the latest completed daily run watermark', () => {
    expect(
      isPublicDailyCacheFresh({
        now,
        builtAt: '2026-05-03T08:00:00.000Z',
        filtersResolved: { startDate: '2026-05-01', endDate: '2026-05-03' },
        sourceRunFinishedAt: '2026-05-03T07:00:00.000Z',
        latestRunFinishedAt: '2026-05-03T09:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('accepts a stale end date when it matches the latest available collection date', () => {
    expect(
      isPublicDailyCacheFresh({
        now,
        builtAt: '2026-05-03T08:00:00.000Z',
        filtersResolved: { startDate: '2026-04-01', endDate: '2026-05-01' },
        latestAvailableCollectionDate: '2026-05-01',
      }),
    ).toBe(true)
  })

  it('does not use a missing latest available collection date as freshness proof', () => {
    expect(
      isPublicDailyCacheFresh({
        now,
        builtAt: '2026-05-03T08:00:00.000Z',
        filtersResolved: { startDate: '2026-04-01', endDate: '2026-05-01' },
        latestAvailableCollectionDate: null,
      }),
    ).toBe(false)
  })

  it('rejects latest-matching cache rows beyond the max staleness canary and logs at the read layer', async () => {
    const builtAt = '2026-05-20T08:00:00.000Z'
    const payload = JSON.stringify({
      v: 2,
      builtAt,
      meta: {
        builtAt,
        filtersResolved: { startDate: '2026-04-01', endDate: '2026-05-01' },
      },
      rows: [],
    })
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            payload_json: payload,
            row_count: 0,
            built_at: builtAt,
          }),
        }),
      }),
    } as unknown as D1Database
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const result = await readD1ChartCache(db, 'term_deposits', 'day', 'default', {
        latestRunFinishedAt: null,
        latestAvailableCollectionDate: '2026-05-01',
        now: new Date('2026-05-20T10:00:00.000Z'),
      })
      expect(result).toBeNull()
      expect(warn.mock.calls.some((call) => String(call[0]).includes('public_cache_wedged_section'))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })
})
