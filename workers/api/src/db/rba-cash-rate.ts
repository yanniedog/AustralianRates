export async function upsertRbaCashRate(
  db: D1Database,
  input: {
    collectionDate: string
    cashRate: number
    effectiveDate: string
    sourceUrl: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rba_cash_rates (
        collection_date,
        cash_rate,
        effective_date,
        source_url,
        fetched_at
      ) VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
      ON CONFLICT(collection_date) DO UPDATE SET
        cash_rate = excluded.cash_rate,
        effective_date = excluded.effective_date,
        source_url = excluded.source_url,
        fetched_at = CURRENT_TIMESTAMP`,
    )
    .bind(input.collectionDate, input.cashRate, input.effectiveDate, input.sourceUrl)
    .run()
}

export async function getNearestRbaCashRate(db: D1Database, collectionDate: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT cash_rate
       FROM rba_cash_rates
       WHERE collection_date <= ?1
       ORDER BY collection_date DESC
       LIMIT 1`,
    )
    .bind(collectionDate)
    .first<{ cash_rate: number }>()

  if (!row) return null
  return Number.isFinite(Number(row.cash_rate)) ? Number(row.cash_rate) : null
}
