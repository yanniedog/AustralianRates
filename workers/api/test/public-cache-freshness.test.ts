import { describe, expect, it } from 'vitest'
import {
  isPublicDailyCacheFresh,
  publicCacheFreshnessStatus,
} from '../src/db/public-cache-freshness'

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

  it('accepts latest-matching cache rows exactly 14 Melbourne days behind today', () => {
    const result = publicCacheFreshnessStatus({
      now: new Date('2026-05-20T10:00:00.000Z'),
      builtAt: '2026-05-20T08:00:00.000Z',
      filtersResolved: { startDate: '2026-04-01', endDate: '2026-05-06' },
      latestAvailableCollectionDate: '2026-05-06',
    })

    expect(result.fresh).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('rejects latest-matching cache rows beyond the 14 Melbourne day canary', () => {
    const result = publicCacheFreshnessStatus({
      now: new Date('2026-05-20T10:00:00.000Z'),
      builtAt: '2026-05-20T08:00:00.000Z',
      filtersResolved: { startDate: '2026-04-01', endDate: '2026-05-05' },
      latestAvailableCollectionDate: '2026-05-05',
    })

    expect(result.fresh).toBe(false)
    expect(result.reason).toBe('end_date_beyond_max_staleness')
  })
})
