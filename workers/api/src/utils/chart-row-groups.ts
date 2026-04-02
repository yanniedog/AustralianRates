type ChartRow = Record<string, unknown>

export type GroupedChartRows = {
  version: 1
  groups: Array<{
    meta: ChartRow
    points: ChartRow[]
  }>
}

function groupKey(row: ChartRow): string {
  return String(
    row.series_key ??
      row.product_key ??
      row.product_id ??
      `${String(row.bank_name ?? '')}|${String(row.product_name ?? '')}`,
  )
}

function copyRow(row: ChartRow): ChartRow {
  return { ...row }
}

export function buildGroupedChartRows(rows: ChartRow[]): GroupedChartRows {
  const groups = new Map<
    string,
    {
      meta: ChartRow
      rows: ChartRow[]
    }
  >()

  for (const row of rows) {
    const key = groupKey(row)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        meta: copyRow(row),
        rows: [row],
      })
      continue
    }
    existing.rows.push(row)
    for (const field of Object.keys(existing.meta)) {
      if (row[field] !== existing.meta[field]) delete existing.meta[field]
    }
  }

  return {
    version: 1,
    groups: Array.from(groups.values()).map((group) => {
      const meta = copyRow(group.meta)
      delete meta.collection_date
      const points = group.rows.map((row) => {
        const point: ChartRow = {}
        for (const [field, value] of Object.entries(row)) {
          if (field === 'collection_date' || meta[field] !== value) point[field] = value
        }
        return point
      })
      return { meta, points }
    }),
  }
}
