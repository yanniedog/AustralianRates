export function shouldSplitHistoricalQualityBatch(precheckRowCount: number, threshold = 5000): boolean {
  return Number.isFinite(precheckRowCount) && precheckRowCount > threshold
}

export function nextHistoricalQualityLenderCursor(lenders: string[], current: string | null): string | null {
  if (lenders.length === 0) return null
  if (!current) return lenders[0]
  const index = lenders.findIndex((lender) => lender === current)
  return index >= 0 ? lenders[index + 1] ?? null : lenders[0]
}
