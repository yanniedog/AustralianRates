export type ProductPresenceSection = 'home_loans' | 'savings' | 'term_deposits'
const UPDATE_BATCH_SIZE = 80

function uniqueProductIds(productIds: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of productIds) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
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

export async function markProductsSeen(
  db: D1Database,
  input: {
    section: ProductPresenceSection
    bankName: string
    productIds: string[]
    collectionDate: string
    runId?: string | null
  },
): Promise<number> {
  const ids = uniqueProductIds(input.productIds)
  if (ids.length === 0) return 0

  let touched = 0
  for (const productId of ids) {
    const result = await db
      .prepare(
        `INSERT INTO product_presence_status (
          section,
          bank_name,
          product_id,
          is_removed,
          removed_at,
          last_seen_collection_date,
          last_seen_at,
          last_seen_run_id
        ) VALUES (?1, ?2, ?3, 0, NULL, ?4, CURRENT_TIMESTAMP, ?5)
        ON CONFLICT(section, bank_name, product_id) DO UPDATE SET
          is_removed = 0,
          removed_at = NULL,
          last_seen_collection_date = excluded.last_seen_collection_date,
          last_seen_at = CURRENT_TIMESTAMP,
          last_seen_run_id = excluded.last_seen_run_id`,
      )
      .bind(input.section, input.bankName, productId, input.collectionDate, input.runId ?? null)
      .run()
    touched += Number(result.meta?.changes ?? 0)
  }

  return touched
}

export async function markMissingProductsRemoved(
  db: D1Database,
  input: {
    section: ProductPresenceSection
    bankName: string
    activeProductIds: string[]
  },
): Promise<number> {
  const activeIds = uniqueProductIds(input.activeProductIds)
  if (activeIds.length === 0) {
    const result = await db
      .prepare(
        `UPDATE product_presence_status
         SET
           is_removed = 1,
           removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP)
         WHERE
           section = ?1
           AND bank_name = ?2
           AND is_removed = 0`,
      )
      .bind(input.section, input.bankName)
      .run()
    return Number(result.meta?.changes ?? 0)
  }

  const activeSet = new Set(activeIds)
  const currentResult = await db
    .prepare(
      `SELECT product_id
       FROM product_presence_status
       WHERE section = ?1
         AND bank_name = ?2
         AND is_removed = 0`,
    )
    .bind(input.section, input.bankName)
    .all<{ product_id: string }>()

  const missingIds = (currentResult.results ?? [])
    .map((row) => String(row.product_id || '').trim())
    .filter((id) => id.length > 0 && !activeSet.has(id))

  if (missingIds.length === 0) return 0

  let removed = 0
  for (const batch of chunkValues(missingIds, UPDATE_BATCH_SIZE)) {
    const placeholders = batch.map((_v, idx) => `?${idx + 3}`).join(', ')
    const result = await db
      .prepare(
        `UPDATE product_presence_status
         SET
           is_removed = 1,
           removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP)
         WHERE
           section = ?1
           AND bank_name = ?2
           AND is_removed = 0
           AND product_id IN (${placeholders})`,
      )
      .bind(input.section, input.bankName, ...batch)
      .run()
    removed += Number(result.meta?.changes ?? 0)
  }

  return removed
}
