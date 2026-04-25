import { computeD1OverageCostUsd } from './d1-budget'

export type BillingPeriod = {
  start_date: string
  end_date: string
  label: string
  cycle_start_day: number
  elapsed_days: number
  days_in_period: number
}

export type BillingPeriodUsage = {
  period: string
  start_date: string
  end_date: string
  day_count: number
  reads: number
  writes: number
  overage_usd: number
}

type UsageDay = {
  date: string
  reads: number
  writes: number
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day))
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return utcDate(year, monthIndex + 1, 0).getUTCDate()
}

function clampCycleDay(year: number, monthIndex: number, cycleDay: number): number {
  return Math.min(cycleDay, daysInUtcMonth(year, monthIndex))
}

function daysInclusive(start: Date, end: Date): number {
  const ms = 24 * 60 * 60 * 1000
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / ms) + 1)
}

export function normalizeBillingCycleStartDay(value: string | number | undefined): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) ? Math.min(31, Math.max(1, parsed)) : 21
}

export function resolveBillingPeriod(now: Date, cycleDayValue: string | number | undefined): BillingPeriod {
  const day = normalizeBillingCycleStartDay(cycleDayValue)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const currentStart = utcDate(year, month, clampCycleDay(year, month, day))
  const start = now >= currentStart
    ? currentStart
    : utcDate(year, month - 1, clampCycleDay(year, month - 1, day))
  const nextStart = utcDate(
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
    clampCycleDay(start.getUTCFullYear(), start.getUTCMonth() + 1, day),
  )
  const end = utcDate(nextStart.getUTCFullYear(), nextStart.getUTCMonth(), nextStart.getUTCDate() - 1)
  const cappedNow = now > end ? end : now
  return {
    start_date: iso(start),
    end_date: iso(end),
    label: `${iso(start)} to ${iso(end)}`,
    cycle_start_day: day,
    elapsed_days: daysInclusive(start, cappedNow),
    days_in_period: daysInclusive(start, end),
  }
}

export function periodForDate(date: string, cycleDayValue: string | number | undefined): BillingPeriod | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return resolveBillingPeriod(new Date(`${date}T12:00:00.000Z`), cycleDayValue)
}

export function aggregateD1UsageByBillingPeriod(
  sortedDays: UsageDay[],
  cycleDayValue: string | number | undefined,
): BillingPeriodUsage[] {
  const map = new Map<string, BillingPeriodUsage>()
  for (const day of sortedDays) {
    const period = periodForDate(day.date, cycleDayValue)
    if (!period) continue
    const row = map.get(period.start_date) ?? {
      period: period.label,
      start_date: period.start_date,
      end_date: period.end_date,
      day_count: 0,
      reads: 0,
      writes: 0,
      overage_usd: 0,
    }
    row.day_count += 1
    row.reads += Math.max(0, day.reads)
    row.writes += Math.max(0, day.writes)
    row.overage_usd = computeD1OverageCostUsd(row.reads, row.writes)
    map.set(period.start_date, row)
  }
  return [...map.values()].sort((a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0))
}
