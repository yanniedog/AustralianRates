type SourceLineageRow = {
  sourceUrl: string
  fetchEventId?: number | null
}

export function assignFetchEventIdsBySourceUrl<T extends SourceLineageRow>(
  rows: T[],
  fetchEventIdBySourceUrl: Map<string, number>,
): void {
  for (const row of rows) {
    if (row.fetchEventId != null) continue
    row.fetchEventId = fetchEventIdBySourceUrl.get(row.sourceUrl) ?? null
  }
}
