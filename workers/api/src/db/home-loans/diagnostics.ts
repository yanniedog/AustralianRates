import { rows } from '../query-common'
import { MAX_PUBLIC_RATE, MIN_CONFIDENCE_ALL, MIN_PUBLIC_RATE } from './shared'

export async function getLenderStaleness(db: D1Database, staleHours = 48) {
  const result = await db
    .prepare(
      `SELECT
        bank_name,
        MAX(collection_date) AS latest_date,
        MAX(parsed_at) AS latest_parsed_at,
        COUNT(*) AS total_rows
       FROM historical_loan_rates
       GROUP BY bank_name
       ORDER BY bank_name ASC`,
    )
    .all<{ bank_name: string; latest_date: string; latest_parsed_at: string; total_rows: number }>()

  const now = Date.now()
  return rows(result).map((r) => {
    const parsedAt = new Date(r.latest_parsed_at).getTime()
    const ageMs = now - parsedAt
    const ageHours = Math.round(ageMs / (1000 * 60 * 60))
    return {
      bank_name: r.bank_name,
      latest_date: r.latest_date,
      latest_parsed_at: r.latest_parsed_at,
      total_rows: Number(r.total_rows),
      age_hours: ageHours,
      stale: ageHours > staleHours,
    }
  })
}

export async function getQualityDiagnostics(db: D1Database) {
  const [totals, byFlag] = await Promise.all([
    db
      .prepare(
        `SELECT
          COUNT(*) AS total_rows,
          SUM(CASE WHEN interest_rate BETWEEN ? AND ? THEN 1 ELSE 0 END) AS in_range_rows,
          SUM(CASE WHEN confidence_score >= ? THEN 1 ELSE 0 END) AS confidence_ok_rows
         FROM historical_loan_rates`,
      )
      .bind(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE, MIN_CONFIDENCE_ALL)
      .first<{ total_rows: number; in_range_rows: number; confidence_ok_rows: number }>(),
    db
      .prepare(
        `SELECT data_quality_flag, COUNT(*) AS n
         FROM historical_loan_rates
         GROUP BY data_quality_flag
         ORDER BY n DESC`,
      )
      .all<{ data_quality_flag: string; n: number }>(),
  ])

  return {
    total_rows: Number(totals?.total_rows ?? 0),
    in_range_rows: Number(totals?.in_range_rows ?? 0),
    confidence_ok_rows: Number(totals?.confidence_ok_rows ?? 0),
    by_flag: rows(byFlag).map((x) => ({
      data_quality_flag: x.data_quality_flag,
      count: Number(x.n),
    })),
  }
}
