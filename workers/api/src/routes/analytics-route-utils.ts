export type AnalyticsRepresentation = 'day' | 'change'

export function parseAnalyticsRepresentation(value: string | undefined): AnalyticsRepresentation {
  return String(value || '').trim().toLowerCase() === 'change' ? 'change' : 'day'
}

export async function collectAllPages<T>(
  fetchPage: (page: number, size: number) => Promise<{ rows: T[]; lastPage: number }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = []
  let page = 1
  let lastPage = 1
  do {
    const payload = await fetchPage(page, pageSize)
    rows.push(...payload.rows)
    lastPage = Math.max(1, Number(payload.lastPage || page))
    page += 1
  } while (page <= lastPage)
  return rows
}
