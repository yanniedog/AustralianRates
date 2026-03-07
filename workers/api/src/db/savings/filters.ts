import { SAVINGS_ACCOUNT_TYPES, SAVINGS_RATE_TYPES } from '../../constants'
import { rows } from '../query-common'

type LatestDistinctCounts = {
  account_type_count: number
  rate_type_count: number
  deposit_tier_count: number
}

export async function getSavingsFilters(db: D1Database) {
  const [banks, depositTiers, counts] = await Promise.all([
    db
      .prepare(
        `SELECT DISTINCT bank_name AS value
         FROM product_catalog
         WHERE dataset_kind = 'savings'
         ORDER BY bank_name ASC`,
      )
      .all<{ value: string }>(),
    db
      .prepare(
        `SELECT DISTINCT deposit_tier AS value
         FROM series_catalog
         WHERE dataset_kind = 'savings'
           AND deposit_tier IS NOT NULL
           AND TRIM(deposit_tier) != ''
         ORDER BY deposit_tier ASC`,
      )
      .all<{ value: string }>(),
    db
      .prepare(
        `SELECT
           COUNT(DISTINCT account_type) AS account_type_count,
           COUNT(DISTINCT rate_type) AS rate_type_count,
           COUNT(DISTINCT deposit_tier) AS deposit_tier_count
         FROM latest_savings_series`,
      )
      .first<LatestDistinctCounts>(),
  ])

  const singleValueColumns: string[] = []
  if (Number(counts?.account_type_count ?? 0) === 1) singleValueColumns.push('account_type')
  if (Number(counts?.rate_type_count ?? 0) === 1) singleValueColumns.push('rate_type')
  if (Number(counts?.deposit_tier_count ?? 0) === 1) singleValueColumns.push('deposit_tier')

  return {
    banks: rows(banks).map((row) => row.value),
    account_types: SAVINGS_ACCOUNT_TYPES,
    rate_types: SAVINGS_RATE_TYPES,
    deposit_tiers: rows(depositTiers).map((row) => row.value),
    single_value_columns: singleValueColumns,
  }
}
