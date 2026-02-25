import { describe, expect, it } from 'vitest'
import { hasDeprecatedHistoricalTriggerPayload } from '../src/routes/historical-deprecation'

describe('historical trigger payload deprecation helper', () => {
  it('detects nested historical payloads', () => {
    expect(hasDeprecatedHistoricalTriggerPayload({ historical: { enabled: true } })).toBe(true)
  })

  it('detects legacy start/end payload fields', () => {
    expect(hasDeprecatedHistoricalTriggerPayload({ start_date: '2026-01-01', end_date: '2026-01-10' })).toBe(true)
    expect(hasDeprecatedHistoricalTriggerPayload({ startDate: '2026-01-01', endDate: '2026-01-10' })).toBe(true)
  })

  it('returns false for regular manual trigger payload', () => {
    expect(hasDeprecatedHistoricalTriggerPayload({})).toBe(false)
    expect(hasDeprecatedHistoricalTriggerPayload({ force: true })).toBe(false)
  })
})
