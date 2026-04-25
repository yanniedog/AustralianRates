import { computeD1OverageCostUsd } from './d1-budget'

export type D1UsageDayRow = {
  date: string
  reads: number
  writes: number
}

export type D1BillingPeriod = {
  label: string
  start_date: string
  end_date: string
  cycle_start_day: number
  elapsed_days: number
  days_in_period: number
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day))
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return utcDate(year, monthIndex + 1, 0).getUTCDate()
}

function clampCycleDay(year: number, monthIndex: number, cycleStartDay: number): number {
  return Math.min(cycleStartDay, daysInUtcMonth(year, monthIndex))
}

function diffDaysInclusive(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1)
}

function periodLabel(startDate: string, endDate: string): string {
  return `${startDate} to ${endDate}`
}

export function resolveD1BillingPeriod(now: Date, cycleStartDay: number): D1BillingPeriod {
  const day = Math.min(31, Math.max(1, Math.floor(cycleStartDay)))
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
  const startDate = ymd(start)
  const endDate = ymd(end)
  return {
    label: periodLabel(startDate, endDate),
    start_date: startDate,
    end_date: endDate,
    cycle_start_day: day,
    elapsed_days: diffDaysInclusive(start, now > end ? end : now),
    days_in_period: diffDaysInclusive(start, end),
  }
}

export function movingAverage(values: number[], window: number): number[] {
  if (window < 1) throw new Error('window must be >= 1')
  return values.map((_, i) => {
    const start = Math.max(0, i - window + 1)
    const slice = values.slice(start, i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

export function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length
  if (n === 0) return { slope: 0, intercept: 0 }
  if (n === 1) return { slope: 0, intercept: values[0] ?? 0 }
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = 0; i < n; i++) {
    sumX += i
    sumY += values[i]
    sumXY += i * values[i]
    sumXX += i * i
  }
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: sumY / n }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

export function tailWindow<T>(arr: T[], maxLen: number): T[] {
  if (arr.length <= maxLen) return [...arr]
  return arr.slice(arr.length - maxLen)
}

export type D1HistoryMonth = {
  month: string
  day_count: number
  reads: number
  writes: number
  overage_usd: number
}

export function aggregateD1UsageByMonth(sortedDays: D1UsageDayRow[]): D1HistoryMonth[] {
  const map = new Map<string, { reads: number; writes: number; day_count: number }>()
  for (const day of sortedDays) {
    const month = day.date.slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) continue
    const prev = map.get(month) ?? { reads: 0, writes: 0, day_count: 0 }
    prev.reads += Math.max(0, day.reads)
    prev.writes += Math.max(0, day.writes)
    prev.day_count += 1
    map.set(month, prev)
  }
  return [...map.entries()]
    .map(([month, v]) => ({
      month,
      day_count: v.day_count,
      reads: v.reads,
      writes: v.writes,
      overage_usd: computeD1OverageCostUsd(v.reads, v.writes),
    }))
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0))
}

export type D1HistoryBillingPeriod = {
  period: string
  start_date: string
  end_date: string
  day_count: number
  reads: number
  writes: number
  overage_usd: number
}

function billingPeriodForDate(date: string, cycleStartDay: number): D1BillingPeriod | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return resolveD1BillingPeriod(new Date(`${date}T12:00:00.000Z`), cycleStartDay)
}

export function aggregateD1UsageByBillingPeriod(
  sortedDays: D1UsageDayRow[],
  cycleStartDay: number,
): D1HistoryBillingPeriod[] {
  const map = new Map<string, { start_date: string; end_date: string; reads: number; writes: number; day_count: number }>()
  for (const day of sortedDays) {
    const period = billingPeriodForDate(day.date, cycleStartDay)
    if (!period) continue
    const prev = map.get(period.start_date) ?? {
      start_date: period.start_date,
      end_date: period.end_date,
      reads: 0,
      writes: 0,
      day_count: 0,
    }
    prev.reads += Math.max(0, day.reads)
    prev.writes += Math.max(0, day.writes)
    prev.day_count += 1
    map.set(period.start_date, prev)
  }
  return [...map.values()]
    .map((v) => ({
      period: periodLabel(v.start_date, v.end_date),
      start_date: v.start_date,
      end_date: v.end_date,
      day_count: v.day_count,
      reads: v.reads,
      writes: v.writes,
      overage_usd: computeD1OverageCostUsd(v.reads, v.writes),
    }))
    .sort((a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0))
}

const TREND_MAX_DAYS = 28

function fittedTrendNullable(values: number[], maxWindow: number): (number | null)[] {
  const n = values.length
  const tail = tailWindow(values, maxWindow)
  const start = n - tail.length
  const { slope, intercept } = linearRegression(tail)
  return values.map((_, i) => {
    if (i < start) return null
    return intercept + slope * (i - start)
  })
}

export type D1UsageSeries = {
  dates: string[]
  reads: number[]
  writes: number[]
  ma7_reads: number[]
  ma7_writes: number[]
  trend_reads_fitted: (number | null)[]
  trend_writes_fitted: (number | null)[]
  trend_reads_window_days: number
  trend_writes_window_days: number
  trend_reads_slope_per_day: number
  trend_writes_slope_per_day: number
}

export function buildD1UsageSeries(sortedDays: D1UsageDayRow[]): D1UsageSeries {
  const dates = sortedDays.map((d) => d.date)
  const reads = sortedDays.map((d) => Math.max(0, d.reads))
  const writes = sortedDays.map((d) => Math.max(0, d.writes))
  const ma7_reads = movingAverage(reads, 7)
  const ma7_writes = movingAverage(writes, 7)
  const readTail = tailWindow(reads, TREND_MAX_DAYS)
  const writeTail = tailWindow(writes, TREND_MAX_DAYS)
  const readReg = linearRegression(readTail)
  const writeReg = linearRegression(writeTail)
  return {
    dates,
    reads,
    writes,
    ma7_reads,
    ma7_writes,
    trend_reads_fitted: fittedTrendNullable(reads, TREND_MAX_DAYS),
    trend_writes_fitted: fittedTrendNullable(writes, TREND_MAX_DAYS),
    trend_reads_window_days: readTail.length,
    trend_writes_window_days: writeTail.length,
    trend_reads_slope_per_day: readReg.slope,
    trend_writes_slope_per_day: writeReg.slope,
  }
}
