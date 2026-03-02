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
