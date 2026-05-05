import { describe, expect, it } from 'vitest'
import {
  createEconomicVisibilityContext,
  economicSeriesQuarantineStatus,
  shouldExcludeEconomicSeriesFromPublic,
} from '../src/economic/public-visibility'

describe('economic public visibility', () => {
  it('keeps missing status rows publicly requestable while catalog data catches up', () => {
    const visibility = createEconomicVisibilityContext('2026-05-05')
    expect(shouldExcludeEconomicSeriesFromPublic(undefined, 'monthly', visibility)).toBe(false)
    expect(economicSeriesQuarantineStatus(undefined, 'monthly', visibility)).toEqual({
      quarantined: true,
      reason: 'missing_status',
    })
  })

  it('excludes non-ok and stale status rows from public route probes', () => {
    const visibility = createEconomicVisibilityContext('2026-05-05')
    expect(
      shouldExcludeEconomicSeriesFromPublic(
        { status: 'error', last_observation_date: '2026-05-01' },
        'monthly',
        visibility,
      ),
    ).toBe(true)
    expect(
      shouldExcludeEconomicSeriesFromPublic(
        { status: 'ok', last_observation_date: '2025-12-01' },
        'monthly',
        visibility,
      ),
    ).toBe(true)
  })

  it('accepts current ok status rows', () => {
    const visibility = createEconomicVisibilityContext('2026-05-05')
    expect(
      economicSeriesQuarantineStatus(
        { status: 'ok', last_observation_date: '2026-04-30' },
        'monthly',
        visibility,
      ),
    ).toEqual({ quarantined: false, reason: null })
  })
})
