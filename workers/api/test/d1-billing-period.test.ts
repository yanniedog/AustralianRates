import { describe, expect, it } from 'vitest'
import {
  aggregateD1UsageByBillingPeriod,
  resolveBillingPeriod,
} from '../src/utils/d1-billing-period'
import { D1_INCLUDED_MONTHLY_WRITES } from '../src/utils/d1-budget'

describe('D1 billing periods', () => {
  it('resolves the Cloudflare account cycle shown in billable usage', () => {
    const period = resolveBillingPeriod(new Date('2026-04-25T12:00:00.000Z'), 21)
    expect(period).toMatchObject({
      start_date: '2026-04-21',
      end_date: '2026-05-20',
      label: '2026-04-21 to 2026-05-20',
      elapsed_days: 5,
      days_in_period: 30,
    })
  })

  it('aggregates history by billing cycle and applies billed overage cost', () => {
    const out = aggregateD1UsageByBillingPeriod([
      { date: '2026-04-20', reads: 100, writes: 10 },
      { date: '2026-04-21', reads: 100, writes: 50_000_000 },
      { date: '2026-04-24', reads: 100, writes: 7_380_000 },
    ], 21)
    expect(out[0]).toMatchObject({
      period: '2026-04-21 to 2026-05-20',
      day_count: 2,
      writes: D1_INCLUDED_MONTHLY_WRITES + 7_380_000,
      overage_usd: 8,
    })
    expect(out[1]).toMatchObject({
      period: '2026-03-21 to 2026-04-20',
      day_count: 1,
      overage_usd: 0,
    })
  })
})
