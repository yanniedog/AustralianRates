export function parseCursorOffset(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor(parsed))
}

export function parsePageSize(value: string | undefined, fallback = 1000, max = 1000): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
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
