import { computeD1OverageCostUsd } from './d1-budget'

export type D1UsageDayRow = {
  date: string
  reads: number
  writes: number
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
