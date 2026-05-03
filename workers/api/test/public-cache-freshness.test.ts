import { describe, expect, it } from 'vitest'
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
})
