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

/**
 * Savings and term-deposit UIs use 0.01 as a display default for "no min rate filter".
 * Normalize that sentinel so public requests stay on the default query path.
 */
export function parseOptionalPublicMinRate(
  value: string | undefined,
  options: { treatPointZeroOneAsDefault?: boolean } = {},
): number | undefined {
  const parsed = parseOptionalNumber(value)
  if (options.treatPointZeroOneAsDefault && parsed === 0.01) return undefined
  return parsed
}

export type PublicDatasetMode = 'daily' | 'historical' | 'all'

export type PublicRateOrderBy = 'default' | 'rate_asc' | 'rate_desc'

export type PublicSortDirection = 'asc' | 'desc'

export function parseSortDirection(
  value: string | undefined,
  fallback: PublicSortDirection = 'desc',
): PublicSortDirection {
  const normalized = String(value || fallback).trim().toLowerCase()
  return normalized === 'asc' || normalized === 'desc' ? normalized : fallback
}

export function parsePublicMode(value: string | undefined): PublicDatasetMode {
  const normalized = String(value || 'all').trim().toLowerCase()
  return normalized === 'daily' || normalized === 'historical' ? normalized : 'all'
}

export function parseRateOrderBy(
  primary: string | undefined,
  secondary?: string | undefined,
): PublicRateOrderBy {
  const normalized = String(primary || secondary || 'default').trim().toLowerCase()
  return normalized === 'rate_asc' || normalized === 'rate_desc' ? normalized : 'default'
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
