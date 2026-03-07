import { INTEREST_PAYMENTS } from '../../constants'
import { rows } from '../query-common'

type LatestDistinctCounts = {
  term_months_count: number
  deposit_tier_count: number
  interest_payment_count: number
}

export async function getTdFilters(db: D1Database) {
  const [banks, termMonths, depositTiers, counts] = await Promise.all([
    db
      .prepare(
        `SELECT DISTINCT bank_name AS value
         FROM product_catalog
         WHERE dataset_kind = 'term_deposits'
         ORDER BY bank_name ASC`,
      )
      .all<{ value: string }>(),
    db
      .prepare(
        `SELECT DISTINCT CAST(term_months AS TEXT) AS value
         FROM series_catalog
         WHERE dataset_kind = 'term_deposits'
           AND term_months IS NOT NULL
         ORDER BY CAST(term_months AS INTEGER) ASC`,
      )
      .all<{ value: string }>(),
    db
      .prepare(
        `SELECT DISTINCT deposit_tier AS value
         FROM series_catalog
         WHERE dataset_kind = 'term_deposits'
           AND deposit_tier IS NOT NULL
           AND TRIM(deposit_tier) != ''
         ORDER BY deposit_tier ASC`,
      )
      .all<{ value: string }>(),
    db
      .prepare(
        `SELECT
           COUNT(DISTINCT term_months) AS term_months_count,
           COUNT(DISTINCT deposit_tier) AS deposit_tier_count,
           COUNT(DISTINCT interest_payment) AS interest_payment_count
         FROM latest_td_series`,
      )
      .first<LatestDistinctCounts>(),
  ])

  const singleValueColumns: string[] = []
  if (Number(counts?.term_months_count ?? 0) === 1) singleValueColumns.push('term_months')
  if (Number(counts?.deposit_tier_count ?? 0) === 1) singleValueColumns.push('deposit_tier')
  if (Number(counts?.interest_payment_count ?? 0) === 1) singleValueColumns.push('interest_payment')

  return {
    banks: rows(banks).map((row) => row.value),
    term_months: rows(termMonths).map((row) => row.value),
    deposit_tiers: rows(depositTiers).map((row) => row.value),
    interest_payments: INTEREST_PAYMENTS,
    single_value_columns: singleValueColumns,
  }
}
