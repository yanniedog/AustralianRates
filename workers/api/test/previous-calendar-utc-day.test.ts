import { describe, expect, it } from 'vitest'

import { previousCalendarUtcDay } from '../src/utils/previous-calendar-utc-day'

describe('previousCalendarUtcDay', () => {
  it('returns UTC prior calendar date', () => {
    expect(previousCalendarUtcDay('2026-04-02')).toBe('2026-04-01')
    expect(previousCalendarUtcDay('2026-01-01')).toBe('2025-12-31')
  })
})
