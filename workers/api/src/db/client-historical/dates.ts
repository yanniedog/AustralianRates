function parseDateOnly(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  if (!start || !end || end < start) return 0
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
}

export function listDatesInclusive(startDate: string, endDate: string): string[] {
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  if (!start || !end || end < start) return []
  const out: string[] = []
  const cursor = new Date(start.getTime())
  while (cursor <= end) {
    out.push(formatDateOnly(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}
