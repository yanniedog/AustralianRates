import { describe, expect, it } from 'vitest'
import { normalizeWindowDays } from '../src/db/executive-summary'

describe('normalizeWindowDays', () => {
  it('defaults to 30 when the input is missing or invalid', () => {
    expect(normalizeWindowDays(undefined)).toBe(30)
    expect(normalizeWindowDays(Number.NaN)).toBe(30)
  })

  it('returns the requested window when it is within the supported range', () => {
    expect(normalizeWindowDays(7)).toBe(7)
    expect(normalizeWindowDays(30)).toBe(30)
    expect(normalizeWindowDays(365)).toBe(365)
  })

  it('clamps the requested window into the supported range', () => {
    expect(normalizeWindowDays(0)).toBe(1)
    expect(normalizeWindowDays(-10)).toBe(1)
    expect(normalizeWindowDays(999)).toBe(365)
  })
})
