/**
 * Ports `buildDistributionModel` (and its `quantile` helper) from
 * `site/ar-chart-data.js`.
 *
 * Groups rows by `preferredGroupField(fields)` (defaults to `bank_name` when the
 * chart is pivoting on product_key), computes box-whisker stats, sorts by metric
 * direction, keeps the top 10 categories. Server stores raw category keys; the
 * client is free to pretty-print them via its own `chartConfig.formatFieldValue`.
 */

import type { ChartRow } from './series-collection'
import { compareMetricValues } from './series-collection'
import type { ChartSection } from './config'
import { rankDirection } from './config'

export type DistributionModel = {
  categories: string[]
  boxes: Array<[number, number, number, number, number]>
  means: (number | null)[]
  counts: number[]
}

function numericValue(row: ChartRow, field: string): number | null {
  const num = Number(row?.[field])
  return Number.isFinite(num) ? num : null
}

function preferredGroupField(fields: { groupField?: string }): string {
  if (fields.groupField && fields.groupField !== 'product_key') return fields.groupField
  return 'bank_name'
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null
  if (sorted.length === 1) return sorted[0]
  const position = (sorted.length - 1) * q
  const base = Math.floor(position)
  const remainder = position - base
  const lower = sorted[base]
  const upper = sorted[Math.min(sorted.length - 1, base + 1)]
  return lower + (upper - lower) * remainder
}

export function buildDistributionModel(
  rows: ChartRow[],
  fields: { yField: string; groupField?: string },
  section: ChartSection,
): DistributionModel {
  const grouped = new Map<string, number[]>()
  const direction = rankDirection(section, fields.yField)
  const keyField = preferredGroupField(fields)

  for (const row of rows) {
    const value = numericValue(row, fields.yField)
    if (!Number.isFinite(value)) continue
    const raw = row[keyField]
    const displayKey = `${keyField}_display`
    const label = raw == null || raw === ''
      ? 'Unknown'
      : String(row[displayKey] ?? raw)
    let bucket = grouped.get(label)
    if (!bucket) {
      bucket = []
      grouped.set(label, bucket)
    }
    bucket.push(value as number)
  }

  const categories = Array.from(grouped.entries()).map(([name, rawValues]) => {
    const values = rawValues.slice().sort((a, b) => a - b)
    const total = values.reduce((sum, value) => sum + value, 0)
    const box: [number, number, number, number, number] = [
      values[0],
      quantile(values, 0.25) ?? values[0],
      quantile(values, 0.5) ?? values[0],
      quantile(values, 0.75) ?? values[values.length - 1],
      values[values.length - 1],
    ]
    return {
      name,
      count: values.length,
      mean: values.length ? total / values.length : null,
      box,
    }
  })

  categories.sort((left, right) => {
    const metricSort = compareMetricValues(left.mean, right.mean, direction)
    if (metricSort !== 0) return metricSort
    return right.count - left.count
  })

  const top = categories.slice(0, 10)
  return {
    categories: top.map((entry) => entry.name),
    boxes: top.map((entry) => entry.box),
    means: top.map((entry) => entry.mean),
    counts: top.map((entry) => entry.count),
  }
}
