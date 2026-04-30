/**
 * Trim snapshot `data` so the Pages HTML inline script stays under the UTF-8 byte
 * budget (must stay in sync with `MAX_INLINE_BYTES` in `functions/_middleware.js`).
 *
 * Full `/snapshot` + D1 rows keep `analyticsSeries`; the inline KV variant drops the
 * grouped series blob so default pages can still inject chartModels + tables without a
 * multi-megabyte `<script>`.
 */

/** Wrapped JSON shape produced by Pages middleware and `GET /snapshot` responses. */
export const SNAPSHOT_INLINE_RESPONSE_MAX_BYTES = 500_000

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
 * Last-resort lite payload when progressive stripping still cannot fit. Never returns
 * `null`: an empty object is valid; callers must not coerce misses to `{}` and wipe
 * all navigation/table keys.
 */
export function emergencyLiteSnapshotData(
  section: string,
  scope: string,
  builtAt: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const fits = (trial: Record<string, unknown>) =>
    wrappedSnapshotApiByteLength(section, scope, builtAt, trial) <= SNAPSHOT_INLINE_RESPONSE_MAX_BYTES

  let best = pickKeys(data, ['filters', 'filtersResolved', 'urls'])
  if (!fits(best)) {
    best = pickKeys(data, ['urls'])
  }
  if (!fits(best)) {
    best = {}
  }

  const tryMerge = (chunk: Record<string, unknown>) => {
    const merged = { ...best, ...chunk }
    if (fits(merged)) best = merged
  }

  if (Object.prototype.hasOwnProperty.call(data, 'overview')) tryMerge({ overview: data.overview })
  if (Object.prototype.hasOwnProperty.call(data, 'siteUi')) tryMerge({ siteUi: data.siteUi })

  const la = data.latestAll
  if (la && typeof la === 'object' && Array.isArray((la as { rows?: unknown[] }).rows)) {
    const block = la as { rows: unknown[]; [k: string]: unknown }
    const rows = block.rows
    for (const cap of [100, 50, 25, 10, 5, 1]) {
      const trial = { ...best, latestAll: { ...block, rows: rows.slice(0, cap) } }
      if (fits(trial)) {
        best = trial
        break
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, 'reportPlotBands')) tryMerge({ reportPlotBands: data.reportPlotBands })
  if (Object.prototype.hasOwnProperty.call(data, 'reportProductHistory')) {
    tryMerge({ reportProductHistory: data.reportProductHistory })
  }
  if (Object.prototype.hasOwnProperty.call(data, 'chartModels')) tryMerge({ chartModels: data.chartModels })

  if (!fits(best)) {
    best = pickKeys(data, ['filters', 'filtersResolved', 'urls'])
    if (!fits(best)) best = pickKeys(data, ['urls'])
    if (!fits(best)) best = {}
  }

  return best
}

/**
 * Returns a shallow-cloned `data` object trimmed until the wrapped API JSON fits the
 * inline byte ceiling. Falls back to {@link emergencyLiteSnapshotData} so lite
 * snapshots never return an empty root by accident.
 */
export function trimSnapshotDataForHtmlInline(
  section: string,
  scope: string,
  builtAt: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
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

  d = withoutKeys(d, ['slicePairStats'])
  if (fits(d)) return d

  d = withoutKeys(d, ['executiveSummary'])
  if (fits(d)) return d

  d = capTableRows(d, 'latestAll', 10)
  if (fits(d)) return d

  d = capTableRows(d, 'changes', 10)
  if (fits(d)) return d

  for (const keys of [
    ['siteUi', 'filters', 'overview', 'rbaHistory', 'cpiHistory', 'reportPlotBands', 'slicePairStats', 'reportProductHistory', 'filtersResolved', 'urls'],
    ['siteUi', 'filters', 'overview', 'reportPlotBands', 'slicePairStats', 'reportProductHistory', 'filtersResolved', 'urls'],
    ['siteUi', 'filters', 'overview', 'filtersResolved', 'urls'],
  ]) {
    const minimal = pickKeys(data, keys)
    if (fits(minimal)) return minimal
  }

  return emergencyLiteSnapshotData(section, scope, builtAt, data)
}
