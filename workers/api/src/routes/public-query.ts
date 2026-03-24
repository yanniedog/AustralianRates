export function parseCsvList(value: string | undefined): string[] {
  if (!value) return []
  return Array.from(
    new Set(
      String(value)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  )
}

export function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value == null || String(value).trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseIncludeRemoved(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

/** Default true: omit niche/mis-filed compare outliers. Set 0/false/off for full rows. */
export function parseExcludeCompareEdgeCases(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false
  }
  return true
}
