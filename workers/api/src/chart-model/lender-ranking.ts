/**
 * Ports `buildLenderRanking` from `site/ar-chart-data.js`.
 *
 * Groups series by bank name, picks each bank's best-ranked series, ranks banks
 * by metric direction, and returns the top `density.rowLimit` entries with
 * min/max for axis scaling.
 */

import type { ChartRow, SeriesEntry } from './series-collection'
import { compareMetricValues } from './series-collection'
import type { ChartSection, DensityResolved } from './config'
import { rankDirection } from './config'

export type LenderRankingEntry = {
  key: string
  bankName: string
  seriesKey: string
  productName: string
  subtitle: string
  latestDate: string
  value: number | null
  delta: number | null
  pointCount: number
  rank: number
  /** Not serialised into snapshot JSON (would bloat payload); included here for parity with client shape. */
  series?: SeriesEntry
  row?: ChartRow
}

export type LenderRankingModel = {
  direction: 'asc' | 'desc'
  totalBanks: number
  entries: LenderRankingEntry[]
  min: number | null
  max: number | null
}

export function buildLenderRanking(
  allSeries: SeriesEntry[],
  fields: { yField: string },
  density: DensityResolved,
  section: ChartSection,
): LenderRankingModel {
  const direction = rankDirection(section, fields.yField)
  const grouped = new Map<string, SeriesEntry[]>()

  for (const series of allSeries) {
    const bankName = String(series.bankName || '').trim() || 'Unknown bank'
    const list = grouped.get(bankName)
    if (list) list.push(series)
    else grouped.set(bankName, [series])
  }

  const entries: LenderRankingEntry[] = []
  for (const [bankName, bankSeries] of grouped) {
    const ranked = bankSeries.slice().sort((left, right) => {
      const metricSort = compareMetricValues(left.latestValue, right.latestValue, direction)
      if (metricSort !== 0) return metricSort
      if (right.pointCount !== left.pointCount) return right.pointCount - left.pointCount
      return String(left.productName).localeCompare(String(right.productName))
    })
    const best = ranked[0]
    entries.push({
      key: bankName,
      bankName,
      seriesKey: best.key,
      productName: best.productName,
      subtitle: best.subtitle,
      latestDate: best.latestDate,
      value: best.latestValue,
      delta: best.delta,
      pointCount: best.pointCount,
      rank: 0,
    })
  }

  entries.sort((left, right) => {
    const metricSort = compareMetricValues(left.value, right.value, direction)
    if (metricSort !== 0) return metricSort
    if (right.pointCount !== left.pointCount) return right.pointCount - left.pointCount
    return String(left.bankName).localeCompare(String(right.bankName))
  })

  const visible = entries.slice(0, density.rowLimit)
  let min: number | null = null
  let max: number | null = null
  visible.forEach((entry, index) => {
    entry.rank = index + 1
    const value = Number(entry.value)
    if (!Number.isFinite(value)) return
    if (min == null || value < min) min = value
    if (max == null || value > max) max = value
  })
  if (min != null && max != null && min === max) max = min + 1

  return {
    direction,
    totalBanks: entries.length,
    entries: visible,
    min,
    max,
  }
}
