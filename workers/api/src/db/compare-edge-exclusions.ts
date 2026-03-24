/**
 * Optional SQL fragments for default "compare" views: omit niche / mis-filed rows
 * that skew min/max or distributions (see exports/OUTLIER_PRODUCTS.md).
 * Disabled when `excludeCompareEdgeCases === false` (e.g. full export).
 */

export function applyHomeLoanCompareEdgeExclusions(
  where: string[],
  productNameColumn: string,
  excludeCompareEdgeCases: boolean | undefined,
): void {
  if (excludeCompareEdgeCases === false) return
  where.push(`LOWER(${productNameColumn}) NOT LIKE '%veterans%'`)
  where.push(`LOWER(${productNameColumn}) NOT LIKE '%sustainable upgrades%'`)
  where.push(`LOWER(${productNameColumn}) NOT LIKE '%bridging%'`)
}

export function applySavingsCompareEdgeExclusions(
  where: string[],
  productNameColumn: string,
  excludeCompareEdgeCases: boolean | undefined,
): void {
  if (excludeCompareEdgeCases === false) return
  where.push(`LOWER(${productNameColumn}) NOT LIKE '%foreign currency%'`)
  where.push(`LOWER(${productNameColumn}) NOT LIKE '%term deposit%'`)
}

export function applyTdCompareEdgeExclusions(
  where: string[],
  productNameColumn: string,
  minDepositColumn: string,
  excludeCompareEdgeCases: boolean | undefined,
): void {
  if (excludeCompareEdgeCases === false) return
  where.push(`(${minDepositColumn} IS NULL OR ${minDepositColumn} >= 1000)`)
  where.push(`LOWER(${productNameColumn}) NOT LIKE '%farm management%'`)
}
