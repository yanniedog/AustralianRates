import type { DatasetKind } from '../../../../packages/shared/src'
const UPDATE_BATCH_SIZE = 80

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

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

export async function findMissingSeriesKeys(
  db: D1Database,
  input: {
    dataset: DatasetKind
    bankName: string
    activeSeriesKeys: string[]
  },
): Promise<string[]> {
  const keys = uniqueSeriesKeys(input.activeSeriesKeys)
  const activeSet = new Set(keys)
  const currentResult = await db
    .prepare(
      `SELECT series_key
       FROM series_presence_status
       WHERE dataset_kind = ?1
         AND bank_name = ?2
         AND is_removed = 0`,
    )
    .bind(input.dataset, input.bankName)
    .all<{ series_key: string }>()

  return (currentResult.results ?? [])
    .map((row) => String(row.series_key || '').trim())
    .filter((seriesKey) => seriesKey.length > 0 && !activeSet.has(seriesKey))
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
  if (keys.length === 0) {
    const result = await db
      .prepare(
        `UPDATE series_presence_status
         SET
           is_removed = 1,
           removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP)
         WHERE
           dataset_kind = ?1
           AND bank_name = ?2
           AND is_removed = 0`,
      )
      .bind(input.dataset, input.bankName)
      .run()
    return Number(result.meta?.changes ?? 0)
  }

  const missingKeys = await findMissingSeriesKeys(db, input)
  if (missingKeys.length === 0) return 0

  let removed = 0
  for (const batch of chunkValues(missingKeys, UPDATE_BATCH_SIZE)) {
    const placeholders = batch.map((_v, idx) => `?${idx + 3}`).join(', ')
    const result = await db
      .prepare(
        `UPDATE series_presence_status
         SET
           is_removed = 1,
           removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP)
         WHERE
           dataset_kind = ?1
           AND bank_name = ?2
           AND is_removed = 0
           AND series_key IN (${placeholders})`,
      )
      .bind(input.dataset, input.bankName, ...batch)
      .run()
    removed += Number(result.meta?.changes ?? 0)
  }

  return removed
}
