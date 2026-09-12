import { sha256HexFromText } from '../utils/hash'

export type ChangeAwareFilterResult<Row> = {
  changed: Row[]
  unchangedRows: Row[]
  unchanged: number
}

/** When rate fields match latest, still treat as changed if non-empty CDR JSON hashes differ from latest. */
export async function cdrDetailPayloadUnchangedForLatestRow(
  current: Record<string, unknown>,
  row: { cdrProductDetailJson?: string | null },
): Promise<boolean> {
  const json = row.cdrProductDetailJson?.trim()
  if (!json) return true
  const stored = String(current.cdr_product_detail_hash ?? '').trim()
  const next = await sha256HexFromText(json)
  return stored === next
}

export function equalStateValue(left: unknown, right: unknown): boolean {
  if (left == null && right == null) return true
  if (typeof left === 'number' || typeof right === 'number') {
    const a = left == null ? null : Number(left)
    const b = right == null ? null : Number(right)
    if (a == null || b == null) return a === b
    return Number.isFinite(a) && Number.isFinite(b) ? a === b : String(left) === String(right)
  }
  return String(left ?? '') === String(right ?? '')
}

export function chunkRows<T>(rows: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size))
  }
  return output
}

export async function filterChangedRows<Row>(
  db: D1Database,
  input: {
    rows: Row[]
    latestTable: 'latest_home_loan_series' | 'latest_savings_series' | 'latest_td_series'
    selectColumns: string[]
    seriesKeyForRow: (row: Row) => string
    rowUnchanged: (current: Record<string, unknown>, row: Row) => boolean
    asyncRefineUnchanged?: (current: Record<string, unknown>, row: Row) => Promise<boolean>
  },
): Promise<ChangeAwareFilterResult<Row>> {
  const keyed = input.rows.map((row) => ({ row, seriesKey: input.seriesKeyForRow(row) }))
  const currentByKey = new Map<string, Record<string, unknown>>()
  for (const part of chunkRows(Array.from(new Set(keyed.map((item) => item.seriesKey))), 80)) {
    const result = await db
      .prepare(
        `SELECT ${['series_key', ...input.selectColumns, 'is_removed'].join(', ')}
         FROM ${input.latestTable}
         WHERE series_key IN (${part.map(() => '?').join(',')})`,
      )
      .bind(...part)
      .all<Record<string, unknown>>()
    for (const current of result.results ?? []) {
      currentByKey.set(String(current.series_key || ''), current)
    }
  }

  const changed: Row[] = []
  const unchangedRows: Row[] = []
  for (const item of keyed) {
    const current = currentByKey.get(item.seriesKey)
    if (current && Number(current.is_removed ?? 0) === 0 && input.rowUnchanged(current, item.row)) {
      const stillUnchanged =
        !input.asyncRefineUnchanged || (await input.asyncRefineUnchanged(current, item.row))
      if (stillUnchanged) {
        unchangedRows.push(item.row)
      } else {
        changed.push(item.row)
      }
    } else {
      changed.push(item.row)
    }
  }

  return { changed, unchangedRows, unchanged: unchangedRows.length }
}
