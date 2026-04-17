/**
 * Ports `buildSeriesCollection` + `finalizeSeries` from `site/ar-chart-data.js`
 * to TypeScript. Pure function: groups row records by product identity, sorts
 * each series' points by `collection_date`, and produces one `SeriesEntry`
 * per product with summary fields (latestRow / latestValue / delta / pointCount).
 *
 * The output matches the structure the client's `buildChartModel` passes down
 * to surface / lender-ranking / visible-series builders, so the server can
 * precompute the expensive aggregation once and ship it to every visitor.
 */

import type { ChartSection } from './config'
import { rankDirection } from './config'

export type ChartRow = Record<string, unknown>

export type SeriesPoint = {
  date: string
  value: number
  row: ChartRow
}

export type SeriesEntry = {
  key: string
  name: string
  axisLabel: string
  subtitle: string
  bankName: string
  productName: string
  latestRow: ChartRow
  latestDate: string
  latestValue: number | null
  delta: number | null
  pointCount: number
  points: SeriesPoint[]
  /** Populated by `buildVisibleSeries` when the series is selected for display. */
  colorIndex?: number
}

function numericValue(row: ChartRow, field: string): number | null {
  const num = Number(row?.[field])
  return Number.isFinite(num) ? num : null
}

function compareDates(left: string, right: string): number {
  if (left === right) return 0
  return String(left || '').localeCompare(String(right || ''))
}

function productIdentity(row: ChartRow): string {
  if (!row || typeof row !== 'object') return ''
  return String(
    row.product_key ?? row.series_key ?? row.product_id ?? row.product_name ?? 'unknown',
  )
}

function shortText(value: unknown, maxLength: number): string {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, Math.max(0, maxLength - 1)).trim() + '...'
}

function seriesName(row: ChartRow): string {
  if (!row) return 'Unknown'
  const parts = [row.bank_name ? String(row.bank_name) : '']
  if (row.product_name) parts.push(String(row.product_name))
  else if (row.term_months != null) parts.push(`${String(row.term_months)}m`)
  else parts.push('Unknown product')
  return parts.filter(Boolean).join(' | ')
}

function axisLabel(row: ChartRow): string {
  return [
    row && row.bank_name ? String(row.bank_name) : '',
    shortText(row && row.product_name ? row.product_name : 'Unknown product', 34),
  ]
    .filter(Boolean)
    .join(' | ')
}

/** Subtitle built from the raw first-row values (no display-name mapping on server). */
function subtitleParts(row: ChartRow): string[] {
  if (!row) return []
  const keys = [
    'term_months',
    'rate_structure',
    'deposit_tier',
    'security_purpose',
    'repayment_type',
    'account_type',
    'rate_type',
    'interest_payment',
    'lvr_tier',
    'feature_set',
  ]
  const parts: string[] = []
  for (const key of keys) {
    const value = row[key]
    if (value == null || value === '') continue
    const displayKey = `${key}_display`
    const text = String(row[displayKey] ?? value)
    if (text && text !== '-') parts.push(text)
    if (parts.length >= 4) break
  }
  return parts
}

function compareMetricValues(left: number | null | undefined, right: number | null | undefined, direction: 'asc' | 'desc'): number {
  const leftValue = Number(left)
  const rightValue = Number(right)
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
    return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue
  }
  if (Number.isFinite(leftValue)) return -1
  if (Number.isFinite(rightValue)) return 1
  return 0
}

function compareSeriesByMetric(left: SeriesEntry, right: SeriesEntry, direction: 'asc' | 'desc'): number {
  const metricSort = compareMetricValues(left.latestValue, right.latestValue, direction)
  if (metricSort !== 0) return metricSort
  if (right.pointCount !== left.pointCount) return right.pointCount - left.pointCount
  return String(left.name).localeCompare(String(right.name))
}

function finalizeSeries(key: string, firstRow: ChartRow, points: SeriesPoint[]): SeriesEntry {
  const sortedPoints = points.slice().sort((a, b) => compareDates(a.date, b.date))
  const first = sortedPoints[0] ?? null
  const last = sortedPoints[sortedPoints.length - 1] ?? null
  return {
    key,
    name: seriesName(firstRow),
    axisLabel: axisLabel(firstRow),
    subtitle: subtitleParts(firstRow).join(' | '),
    bankName: firstRow.bank_name ? String(firstRow.bank_name) : '',
    productName: firstRow.product_name ? String(firstRow.product_name) : '',
    latestRow: last ? last.row : firstRow,
    latestDate: last ? last.date : '',
    latestValue: last ? last.value : null,
    delta: first && last ? last.value - first.value : null,
    pointCount: sortedPoints.length,
    points: sortedPoints,
  }
}

export function buildSeriesCollection(rows: ChartRow[], metricField: string, section: ChartSection): SeriesEntry[] {
  const direction = rankDirection(section, metricField)
  const groups = new Map<string, { firstRow: ChartRow; points: SeriesPoint[] }>()
  for (const row of rows) {
    const value = numericValue(row, metricField)
    if (!Number.isFinite(value)) continue
    const key = productIdentity(row)
    if (!key) continue
    const entry = groups.get(key)
    if (!entry) {
      groups.set(key, {
        firstRow: row,
        points: [{ date: String(row.collection_date || ''), value: value as number, row }],
      })
      continue
    }
    entry.points.push({ date: String(row.collection_date || ''), value: value as number, row })
  }

  const result: SeriesEntry[] = []
  for (const [key, group] of groups) {
    const finalized = finalizeSeries(key, group.firstRow, group.points)
    if (finalized.pointCount > 0) result.push(finalized)
  }
  result.sort((left, right) => compareSeriesByMetric(left, right, direction))
  return result
}

export { compareSeriesByMetric, compareMetricValues, compareDates }
