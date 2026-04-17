import { describe, expect, it } from 'vitest'
import { observationFutureCompareCutoffYmd } from '../src/db/economic-coverage-audit'

describe('observationFutureCompareCutoffYmd', () => {
  it('allows month-end labels through the end of the Melbourne month for monthly series', () => {
    const tz = 'Australia/Melbourne'
    expect(observationFutureCompareCutoffYmd('2026-04-17T04:45:00.000Z', 'monthly', tz)).toBe('2026-04-30')
    expect(observationFutureCompareCutoffYmd('2026-04-30T12:00:00.000Z', 'monthly', tz)).toBe('2026-04-30')
  })

  it('uses quarter-end for quarterly series', () => {
    const tz = 'Australia/Melbourne'
    expect(observationFutureCompareCutoffYmd('2026-04-10T00:00:00.000Z', 'quarterly', tz)).toBe('2026-06-30')
    expect(observationFutureCompareCutoffYmd('2026-07-01T00:00:00.000Z', 'quarterly', tz)).toBe('2026-09-30')
  })

  it('uses calendar Melbourne date for daily and policy series', () => {
    const tz = 'Australia/Melbourne'
    expect(observationFutureCompareCutoffYmd('2026-04-17T14:00:00.000Z', 'daily', tz)).toBe('2026-04-18')
    expect(observationFutureCompareCutoffYmd('2026-04-17T14:00:00.000Z', 'policy', tz)).toBe('2026-04-18')
  })

  it('uses year-end for annual series', () => {
    const tz = 'Australia/Melbourne'
    expect(observationFutureCompareCutoffYmd('2026-06-15T00:00:00.000Z', 'annual', tz)).toBe('2026-12-31')
  })
})
