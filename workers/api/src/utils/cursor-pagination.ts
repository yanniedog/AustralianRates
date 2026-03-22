export function parseCursorOffset(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor(parsed))
}

/** When absent or blank, export all matching rows; otherwise clamp to [1, maxExplicit]. */
export function parseOptionalExportLimit(value: string | undefined, maxExplicit: number): number | undefined {
  if (value === undefined) return undefined
  const trimmed = String(value).trim()
  if (trimmed === '') return undefined
  return parsePageSize(trimmed, 1, maxExplicit)
}

export function parsePageSize(value: string | undefined, fallback = 1000, max = 1000): number {
  const trimmed = String(value ?? '').trim()
  // Number('') is 0 in JS; empty must mean "use default", not "clamp to min page size 1".
  if (trimmed === '') return fallback
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.min(max, Math.floor(parsed)))
}

export function paginateRows<T>(rows: T[], offset: number, pageSize: number): {
  rows: T[]
  nextCursor: string | null
  partial: boolean
} {
  if (rows.length > pageSize) {
    return {
      rows: rows.slice(0, pageSize),
      nextCursor: String(offset + pageSize),
      partial: true,
    }
  }

  return {
    rows,
    nextCursor: null,
    partial: false,
  }
}
