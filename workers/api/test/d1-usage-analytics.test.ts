import { describe, expect, it } from 'vitest'
import {
  aggregateD1UsageByBillingPeriod,
  aggregateD1UsageByMonth,
  buildD1UsageSeries,
  linearRegression,
  movingAverage,
  resolveD1BillingPeriod,
} from '../src/utils/d1-usage-analytics'

describe('movingAverage', () => {
  it('windows trailing values', () => {
    const v = [10, 20, 30, 40]
    expect(movingAverage(v, 2)).toEqual([10, 15, 25, 35])
  })
})

describe('linearRegression', () => {
  it('fits a line through two points', () => {
    const { slope, intercept } = linearRegression([0, 2])
    expect(slope).toBeCloseTo(2, 5)
    expect(intercept).toBeCloseTo(0, 5)
  })
})

describe('aggregateD1UsageByMonth', () => {
  it('sums by month and sorts newest first', () => {
    const rows = [
      { date: '2026-03-30', reads: 100, writes: 5 },
      { date: '2026-03-31', reads: 200, writes: 1 },
      { date: '2026-04-01', reads: 50, writes: 10 },
    ]
    const out = aggregateD1UsageByMonth(rows)
    expect(out.map((m) => m.month)).toEqual(['2026-04', '2026-03'])
    expect(out.find((m) => m.month === '2026-03')).toMatchObject({
      reads: 300,
      writes: 6,
      day_count: 2,
    })
  })
})

describe('resolveD1BillingPeriod', () => {
  it('uses the account billing cycle start day instead of calendar month', () => {
    const period = resolveD1BillingPeriod(new Date('2026-04-25T10:00:00.000Z'), 21)
    expect(period).toMatchObject({
      label: '2026-04-21 to 2026-05-20',
      start_date: '2026-04-21',
      end_date: '2026-05-20',
      cycle_start_day: 21,
      elapsed_days: 5,
      days_in_period: 30,
    })
  })
})

describe('aggregateD1UsageByBillingPeriod', () => {
  it('sums rows by invoice-aligned period', () => {
    const rows = [
      { date: '2026-04-20', reads: 100, writes: 5 },
      { date: '2026-04-21', reads: 200, writes: 10 },
      { date: '2026-04-25', reads: 50, writes: 1 },
    ]
    const out = aggregateD1UsageByBillingPeriod(rows, 21)
    expect(out.map((p) => p.period)).toEqual([
      '2026-04-21 to 2026-05-20',
      '2026-03-21 to 2026-04-20',
    ])
    expect(out[0]).toMatchObject({
      reads: 250,
      writes: 11,
      day_count: 2,
    })
  })
})

describe('buildD1UsageSeries', () => {
  it('returns aligned arrays', () => {
    const days = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      reads: (i + 1) * 1000,
      writes: (10 - i) * 100,
    }))
    const s = buildD1UsageSeries(days)
    expect(s.dates.length).toBe(10)
    expect(s.ma7_reads.length).toBe(10)
    expect(s.trend_reads_fitted.filter((x) => x != null).length).toBeGreaterThan(0)
    expect(Number.isFinite(s.trend_reads_slope_per_day)).toBe(true)
  })
})
