import { describe, expect, it } from 'vitest'
import { shouldRunScheduledAtTargetHour } from '../src/pipeline/scheduled'

describe('scheduled hour guard', () => {
  it('runs every 6 hours anchored to target hour', () => {
    expect(shouldRunScheduledAtTargetHour(6, 6)).toBe(true)
    expect(shouldRunScheduledAtTargetHour(12, 6)).toBe(true)
    expect(shouldRunScheduledAtTargetHour(18, 6)).toBe(true)
    expect(shouldRunScheduledAtTargetHour(0, 6)).toBe(true)
    expect(shouldRunScheduledAtTargetHour(5, 6)).toBe(false)
    expect(shouldRunScheduledAtTargetHour(7, 6)).toBe(false)
  })
})
