export type RateBoundFilters = {
  minRate?: number
  maxRate?: number
  minComparisonRate?: number
  maxComparisonRate?: number
}

export function safeLimit(limit: number | undefined, fallback: number, max = 500): number {
  const n = Number(limit)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(max, Math.floor(n)))
}

export function rows<T>(result: D1Result<T>): T[] {
  return Array.isArray(result.results) ? result.results : []
}

export function addBankWhere(
  where: string[],
  binds: Array<string | number>,
  column: string,
  bank?: string,
  banks?: string[],
): void {
  const bankList = Array.from(new Set((banks || []).map((v) => String(v).trim()).filter(Boolean)))
  if (bankList.length > 0) {
    where.push(`${column} IN (${bankList.map(() => '?').join(',')})`)
    binds.push(...bankList)
    return
  }
  if (bank) {
    where.push(`${column} = ?`)
    binds.push(bank)
  }
}

const BALANCE_BAND_MAX_DOLLARS = 100_000_000

/**
 * Rows whose tier interval [minCol, maxCol] overlaps the user band [balanceMin, balanceMax] (dollars).
 * Open upper tier uses NULL max column (treated as no upper cap).
 */
export function addBalanceBandOverlapWhere(
  where: string[],
  binds: Array<string | number>,
  minCol: string,
  maxCol: string,
  balanceMin?: number,
  balanceMax?: number,
): void {
  if (balanceMin == null && balanceMax == null) return
  let lo =
    balanceMin != null && Number.isFinite(Number(balanceMin)) ? Math.max(0, Number(balanceMin)) : 0
  let hi =
    balanceMax != null && Number.isFinite(Number(balanceMax))
      ? Math.min(BALANCE_BAND_MAX_DOLLARS, Number(balanceMax))
      : BALANCE_BAND_MAX_DOLLARS
  if (hi < lo) {
    const t = lo
    lo = hi
    hi = t
  }
  where.push(`(COALESCE(${minCol}, 0) <= ?)`)
  binds.push(hi)
  where.push(`(${maxCol} IS NULL OR ${maxCol} >= ?)`)
  binds.push(lo)
}

export function addRateBoundsWhere(
  where: string[],
  binds: Array<string | number>,
  rateColumn: string,
  comparisonColumn: string,
  filters: RateBoundFilters,
): void {
  if (filters.minRate != null && Number.isFinite(Number(filters.minRate))) {
    where.push(`${rateColumn} >= ?`)
    binds.push(Number(filters.minRate))
  }
  if (filters.maxRate != null && Number.isFinite(Number(filters.maxRate))) {
    where.push(`${rateColumn} <= ?`)
    binds.push(Number(filters.maxRate))
  }
  if (filters.minComparisonRate != null && Number.isFinite(Number(filters.minComparisonRate))) {
    where.push(`${comparisonColumn} IS NOT NULL`)
    where.push(`${comparisonColumn} >= ?`)
    binds.push(Number(filters.minComparisonRate))
  }
  if (filters.maxComparisonRate != null && Number.isFinite(Number(filters.maxComparisonRate))) {
    where.push(`${comparisonColumn} IS NOT NULL`)
    where.push(`${comparisonColumn} <= ?`)
    binds.push(Number(filters.maxComparisonRate))
  }
}
