import type { DatasetKind } from '../../../../packages/shared/src'

function uniqueSeriesKeys(rows: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of rows) {
    const key = String(raw || '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export async function markSeriesSeen(
  db: D1Database,
  input: {
    dataset: DatasetKind
    seriesKey: string
    bankName: string
    productId: string
    productCode: string
    collectionDate: string
    runId?: string | null
  },
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO series_presence_status (
         dataset_kind, series_key, bank_name, product_id, product_code, is_removed, removed_at,
         last_seen_collection_date, last_seen_at, last_seen_run_id
       ) VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL, ?6, CURRENT_TIMESTAMP, ?7)
       ON CONFLICT(series_key) DO UPDATE SET
         bank_name = excluded.bank_name,
         product_id = excluded.product_id,
         product_code = excluded.product_code,
         is_removed = 0,
         removed_at = NULL,
         last_seen_collection_date = excluded.last_seen_collection_date,
         last_seen_at = CURRENT_TIMESTAMP,
         last_seen_run_id = excluded.last_seen_run_id`,
    )
    .bind(
      input.dataset,
      input.seriesKey,
      input.bankName,
      input.productId,
      input.productCode,
      input.collectionDate,
      input.runId ?? null,
    )
    .run()
  return Number(result.meta?.changes ?? 0)
}

export async function markMissingSeriesRemoved(
  db: D1Database,
  input: {
    dataset: DatasetKind
    bankName: string
    activeSeriesKeys: string[]
  },
): Promise<number> {
  const keys = uniqueSeriesKeys(input.activeSeriesKeys)
  let sql = `UPDATE series_presence_status
    SET
      is_removed = 1,
      removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP)
    WHERE
      dataset_kind = ?1
      AND bank_name = ?2
      AND is_removed = 0`

  const binds: Array<string> = [input.dataset, input.bankName]
  if (keys.length > 0) {
    const placeholders = keys.map((_v, idx) => `?${idx + 3}`).join(', ')
    sql += ` AND series_key NOT IN (${placeholders})`
    for (const key of keys) binds.push(key)
  }

  const result = await db.prepare(sql).bind(...binds).run()
  return Number(result.meta?.changes ?? 0)
}
