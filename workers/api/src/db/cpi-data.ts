const CPI_UPSERT_SQL = `INSERT INTO cpi_data (quarter_date, annual_change, source_url, fetched_at)
       VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
       ON CONFLICT(quarter_date) DO UPDATE SET
         annual_change = excluded.annual_change,
         source_url    = excluded.source_url,
         fetched_at    = CURRENT_TIMESTAMP`

/** D1 batch size cap keeps statements per round-trip within platform comfort. */
const CPI_UPSERT_BATCH_SIZE = 100

export async function upsertCpiData(
  db: D1Database,
  input: {
    quarterDate: string
    annualChange: number
    sourceUrl: string
  },
): Promise<void> {
  await db.prepare(CPI_UPSERT_SQL).bind(input.quarterDate, input.annualChange, input.sourceUrl).run()
}

export type CpiUpsertPoint = { quarterDate: string; annualChange: number; sourceUrl: string }

/** Batched upserts: one `db.batch` per chunk vs N sequential round-trips. */
export async function upsertCpiDataBatch(db: D1Database, points: CpiUpsertPoint[]): Promise<void> {
  if (points.length === 0) return
  for (let i = 0; i < points.length; i += CPI_UPSERT_BATCH_SIZE) {
    const chunk = points.slice(i, i + CPI_UPSERT_BATCH_SIZE)
    const stmts = chunk.map((p) => db.prepare(CPI_UPSERT_SQL).bind(p.quarterDate, p.annualChange, p.sourceUrl))
    await db.batch(stmts)
  }
}

export type CpiEntry = { quarter_date: string; annual_change: number }

export async function getCpiHistory(db: D1Database): Promise<CpiEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT quarter_date, annual_change
       FROM cpi_data
       ORDER BY quarter_date ASC`,
    )
    .all<{ quarter_date: string; annual_change: number }>()
  if (!results || !Array.isArray(results)) return []
  return results
    .filter((r) => r && r.quarter_date != null && Number.isFinite(Number(r.annual_change)))
    .map((r) => ({ quarter_date: String(r.quarter_date), annual_change: Number(r.annual_change) }))
}
