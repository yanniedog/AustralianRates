export type ProductPresenceSection = 'home_loans' | 'savings' | 'term_deposits'

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
  let sql = `UPDATE product_presence_status
    SET
      is_removed = 1,
      removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP)
    WHERE
      section = ?1
      AND bank_name = ?2
      AND is_removed = 0`

  const binds: Array<string | number> = [input.section, input.bankName]
  if (activeIds.length > 0) {
    const placeholders = activeIds.map((_v, idx) => `?${idx + 3}`).join(', ')
    sql += ` AND product_id NOT IN (${placeholders})`
    for (const id of activeIds) binds.push(id)
  }

  const result = await db.prepare(sql).bind(...binds).run()
  return Number(result.meta?.changes ?? 0)
}
