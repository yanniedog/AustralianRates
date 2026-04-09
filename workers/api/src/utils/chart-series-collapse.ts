import type { AnalyticsRepresentation } from '../routes/analytics-route-utils'

function productIdentity(row: Record<string, unknown>): string {
  return String(row.product_key ?? row.series_key ?? row.product_id ?? '')
}

function collapseKey(representation: AnalyticsRepresentation, row: Record<string, unknown>): string {
  const id = productIdentity(row)
  const date = String(row.collection_date ?? '')
  if (representation === 'day') {
    return `${id}\u0001${date}`
  }
  const neu = row.new_rate ?? row.interest_rate
  const prev = row.previous_rate
  const changed = row.changed_at ?? row.previous_changed_at ?? ''
  return `${id}\u0001${date}\u0001${String(neu)}\u0001${String(prev)}\u0001${String(changed)}`
}

function isRemovedRow(row: Record<string, unknown>): boolean {
  return row.is_removed === 1 || row.is_removed === true
}

/** Prefer candidate when it improves row choice for the same chart key. */
function shouldReplace(
  representation: AnalyticsRepresentation,
  current: Record<string, unknown>,
  candidate: Record<string, unknown>,
): boolean {
  const curR = isRemovedRow(current)
  const canR = isRemovedRow(candidate)
  if (curR && !canR) return true
  if (!curR && canR) return false
  if (representation === 'change') {
    const c1 = String(current.changed_at || current.collection_date || '')
    const c2 = String(candidate.changed_at || candidate.collection_date || '')
    if (c2 > c1) return true
    if (c2 < c1) return false
  }
  return true
}

/**
 * One point per product per day (day rep) or per distinct change event (change rep).
 * Drops redundant snapshots so caps retain more distinct time series coverage.
 */
export function collapseChartSeriesRows(
  representation: AnalyticsRepresentation,
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (rows.length <= 1) return rows
  const sorted = [...rows].sort((a, b) => {
    const da = String(a.collection_date || '')
    const db = String(b.collection_date || '')
    if (da !== db) return da.localeCompare(db)
    const c = productIdentity(a).localeCompare(productIdentity(b))
    if (c !== 0) return c
    return collapseKey(representation, a).localeCompare(collapseKey(representation, b))
  })
  const map = new Map<string, Record<string, unknown>>()
  for (const row of sorted) {
    const key = collapseKey(representation, row)
    const existing = map.get(key)
    if (!existing) {
      map.set(key, row)
      continue
    }
    if (shouldReplace(representation, existing, row)) {
      map.set(key, row)
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const da = String(a.collection_date || '')
    const db = String(b.collection_date || '')
    if (da !== db) return da.localeCompare(db)
    return productIdentity(a).localeCompare(productIdentity(b))
  })
}
