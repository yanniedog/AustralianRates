/**
 * Trim snapshot `data` so the Pages HTML inline script stays under the UTF-8 byte
 * budget (must stay in sync with `MAX_INLINE_BYTES` in `functions/_middleware.js`).
 *
 * Full `/snapshot` + D1 rows keep `analyticsSeries`; the inline KV variant drops the
 * grouped series blob so default pages can still inject chartModels + tables without a
 * multi-megabyte `<script>`.
 */

/** Wrapped JSON shape produced by Pages middleware and `GET /snapshot` responses. */
export const SNAPSHOT_INLINE_RESPONSE_MAX_BYTES = 400_000

const encoder = new TextEncoder()

export function wrappedSnapshotApiByteLength(
  section: string,
  scope: string,
  builtAt: string,
  data: Record<string, unknown>,
): number {
  const wrapped = JSON.stringify({
    ok: true,
    section,
    scope,
    builtAt,
    data,
  })
  return encoder.encode(wrapped).length
}

function withoutKeys(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...source }
  for (const k of keys) delete out[k]
  return out
}

function pickKeys(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key]
  }
  return out
}

function capTableRows(source: Record<string, unknown>, key: string, max: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...source }
  const block = source[key]
  if (!block || typeof block !== 'object' || !Array.isArray((block as { rows?: unknown }).rows)) {
    return out
  }
  const b = block as { rows: unknown[]; [k: string]: unknown }
  if (b.rows.length <= max) return out
  out[key] = { ...b, rows: b.rows.slice(0, max) }
  return out
}

/**
 * Returns a shallow-cloned `data` object trimmed until the wrapped API JSON fits the
 * inline byte ceiling, or null if it cannot be brought under budget.
 */
export function trimSnapshotDataForHtmlInline(
  section: string,
  scope: string,
  builtAt: string,
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const fits = (d: Record<string, unknown>) =>
    wrappedSnapshotApiByteLength(section, scope, builtAt, d) <= SNAPSHOT_INLINE_RESPONSE_MAX_BYTES

  let d: Record<string, unknown> = { ...data }
  if (fits(d)) return d

  d = withoutKeys(d, ['analyticsSeries'])
  if (fits(d)) return d

  d = withoutKeys(d, ['currentLeaders'])
  if (fits(d)) return d

  for (const cap of [500, 300, 200, 100, 50, 25]) {
    d = capTableRows(d, 'latestAll', cap)
    if (fits(d)) return d
  }

  for (const cap of [100, 50, 25, 10]) {
    d = capTableRows(d, 'changes', cap)
    if (fits(d)) return d
  }

  d = withoutKeys(d, ['chartModels'])
  if (fits(d)) return d

  d = withoutKeys(d, ['reportPlotMoves'])
  if (fits(d)) return d

  d = withoutKeys(d, ['executiveSummary'])
  if (fits(d)) return d

  d = capTableRows(d, 'latestAll', 10)
  if (fits(d)) return d

  d = capTableRows(d, 'changes', 10)
  if (fits(d)) return d

  for (const keys of [
    ['siteUi', 'filters', 'overview', 'rbaHistory', 'cpiHistory', 'reportPlotBands', 'reportProductHistory', 'filtersResolved', 'urls'],
    ['siteUi', 'filters', 'overview', 'reportPlotBands', 'reportProductHistory', 'filtersResolved', 'urls'],
    ['siteUi', 'filters', 'overview', 'filtersResolved', 'urls'],
  ]) {
    const minimal = pickKeys(data, keys)
    if (fits(minimal)) return minimal
  }

  return null
}
