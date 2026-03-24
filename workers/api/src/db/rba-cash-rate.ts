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

export type NearestRbaCashRateSnapshot = {
  cashRate: number
  effectiveDate: string
  sourceUrl: string
}

export async function getNearestRbaCashRateSnapshot(
  db: D1Database,
  collectionDate: string,
): Promise<NearestRbaCashRateSnapshot | null> {
  const row = await db
    .prepare(
      `SELECT cash_rate, effective_date, source_url
       FROM rba_cash_rates
       WHERE collection_date <= ?1
       ORDER BY collection_date DESC
       LIMIT 1`,
    )
    .bind(collectionDate)
    .first<{ cash_rate: number; effective_date: string | null; source_url: string | null }>()

  if (!row) return null
  const cashRate = Number(row.cash_rate)
  const effectiveDate = String(row.effective_date || '').trim()
  const sourceUrl = String(row.source_url || '').trim()
  if (!Number.isFinite(cashRate) || !effectiveDate || !sourceUrl) return null

  return {
    cashRate,
    effectiveDate,
    sourceUrl,
  }
}

/** Distinct RBA cash rate changes by effective_date for chart annotations (date and rate labels). */
export type RbaHistoryEntry = { effective_date: string; cash_rate: number }

export async function getRbaHistory(db: D1Database): Promise<RbaHistoryEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT effective_date, cash_rate
       FROM rba_cash_rates
       GROUP BY effective_date
       ORDER BY effective_date ASC`,
    )
    .all<{ effective_date: string; cash_rate: number }>()
  if (!results || !Array.isArray(results)) return []
  return results
    .filter((r) => r && r.effective_date != null && Number.isFinite(Number(r.cash_rate)))
    .map((r) => ({ effective_date: String(r.effective_date), cash_rate: Number(r.cash_rate) }))
}
