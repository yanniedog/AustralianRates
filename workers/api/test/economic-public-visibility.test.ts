import { describe, expect, it } from 'vitest'
import {
  economicSeriesQuarantineStatus,
  shouldExcludeEconomicSeriesFromPublic,
} from '../src/economic/public-visibility'

describe('economic public visibility', () => {
  it('keeps missing status rows publicly requestable while catalog data catches up', () => {
    expect(shouldExcludeEconomicSeriesFromPublic(undefined, 'monthly', '2026-05-05')).toBe(false)
    expect(economicSeriesQuarantineStatus(undefined, 'monthly', '2026-05-05')).toEqual({
      quarantined: true,
      reason: 'missing_status',
    })
  })

  it('excludes non-ok and stale status rows from public route probes', () => {
    expect(
      shouldExcludeEconomicSeriesFromPublic(
        { status: 'error', last_observation_date: '2026-05-01' },
        'monthly',
        '2026-05-05',
      ),
    ).toBe(true)
    expect(
      shouldExcludeEconomicSeriesFromPublic(
        { status: 'ok', last_observation_date: '2025-12-01' },
        'monthly',
        '2026-05-05',
      ),
    ).toBe(true)
  })

  it('accepts current ok status rows', () => {
    expect(
      economicSeriesQuarantineStatus(
        { status: 'ok', last_observation_date: '2026-04-30' },
        'monthly',
        '2026-05-05',
      ),
    ).toEqual({ quarantined: false, reason: null })
  })
})
