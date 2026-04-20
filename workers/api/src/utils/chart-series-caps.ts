/**
 * Bounds for /analytics/series collection: unbounded reads caused Worker timeouts.
 * Fetch caps are raw rows from D1; response cap applies after projection + collapse.
 */

/** Max rows in the JSON `rows` / grouped payload when not using disableRowCap (public default). */
export const CHART_SERIES_RESPONSE_CAP = 120_000

/** Raw rows to read: default public chart (no chart_window). */
export const CHART_SERIES_FETCH_PUBLIC = 160_000

/** Raw rows to read when chart_window is set (`disableRowCap` widens fetch vs default public cap). */
export const CHART_SERIES_FETCH_WINDOW = 120_000

/** Cron chart-cache refresh: bounded but higher so precomputed slices stay complete. */
export const CHART_SERIES_FETCH_REFRESH = 2_500_000

export type ChartSeriesFetchContext = {
  disableRowCap?: boolean
  chartInternalRefresh?: boolean
}

export function resolveChartSeriesFetchCap(ctx: ChartSeriesFetchContext): number {
  if (ctx.chartInternalRefresh) return CHART_SERIES_FETCH_REFRESH
  if (ctx.disableRowCap) return CHART_SERIES_FETCH_WINDOW
  return CHART_SERIES_FETCH_PUBLIC
}

/**
 * Paginate newest-first (caller must pass sort+dir on the query), stop at maxRows, then caller reverses to ascending.
 */
export async function collectPaginatedRatesCapped<T>(
  fetchPage: (page: number, size: number) => Promise<{ rows: T[]; lastPage: number }>,
  options: { pageSize?: number; maxRows: number },
): Promise<T[]> {
  const pageSize = options.pageSize ?? 1000
  const maxRows = Math.max(1, Math.floor(options.maxRows))
  const acc: T[] = []
  let page = 1
  let lastPage = 1
  do {
    const payload = await fetchPage(page, pageSize)
    const batch = payload.rows
    lastPage = Math.max(1, Math.floor(Number(payload.lastPage || 1)))
    const space = maxRows - acc.length
    if (space <= 0) break
    if (batch.length <= space) {
      acc.push(...batch)
    } else {
      acc.push(...batch.slice(0, space))
      break
    }
    page += 1
  } while (page <= lastPage)
  return acc
}
