import { describe, expect, it } from 'vitest'
import { nextIsoAfterLeaseExpires } from '../src/queue/consumer/idempotency'

describe('idempotency lease timing helpers', () => {
  it('schedules replay a few ms after lease expiry when lease is in the future', () => {
    const nowMs = Date.parse('2026-05-06T02:00:00.000Z')
    const leaseUntil = new Date(nowMs + 120_000).toISOString()
    const iso = nextIsoAfterLeaseExpires(leaseUntil, nowMs, 2000)
    expect(Date.parse(iso)).toBeGreaterThan(nowMs + 120_000)
    expect(Date.parse(iso)).toBeLessThanOrEqual(nowMs + 120_000 + 2500)
  })

  it('uses now as floor when lease is missing or unparsable', () => {
    const nowMs = Date.parse('2026-05-06T03:00:00.000Z')
    expect(Date.parse(nextIsoAfterLeaseExpires('', nowMs))).toBeGreaterThan(nowMs)
    expect(Date.parse(nextIsoAfterLeaseExpires('not-a-date', nowMs))).toBeGreaterThan(nowMs)
  })
})
