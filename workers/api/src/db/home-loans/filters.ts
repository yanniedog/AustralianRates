import {
  FEATURE_SETS,
  LVR_TIERS,
  RATE_STRUCTURES,
  REPAYMENT_TYPES,
  SECURITY_PURPOSES,
} from '../../constants'
import { rows } from '../query-common'

type LatestDistinctCounts = {
  security_purpose_count: number
  repayment_type_count: number
  rate_structure_count: number
  lvr_tier_count: number
  feature_set_count: number
}

export async function getFilters(db: D1Database) {
  const [banks, counts] = await Promise.all([
    db
      .prepare(
        `SELECT DISTINCT bank_name AS value
         FROM product_catalog
         WHERE dataset_kind = 'home_loans'
         ORDER BY bank_name ASC`,
      )
      .all<{ value: string }>(),
    db
      .prepare(
        `SELECT
           COUNT(DISTINCT security_purpose) AS security_purpose_count,
           COUNT(DISTINCT repayment_type) AS repayment_type_count,
           COUNT(DISTINCT rate_structure) AS rate_structure_count,
           COUNT(DISTINCT lvr_tier) AS lvr_tier_count,
           COUNT(DISTINCT feature_set) AS feature_set_count
         FROM latest_home_loan_series`,
      )
      .first<LatestDistinctCounts>(),
  ])

  const singleValueColumns: string[] = []
  if (Number(counts?.security_purpose_count ?? 0) === 1) singleValueColumns.push('security_purpose')
  if (Number(counts?.repayment_type_count ?? 0) === 1) singleValueColumns.push('repayment_type')
  if (Number(counts?.rate_structure_count ?? 0) === 1) singleValueColumns.push('rate_structure')
  if (Number(counts?.lvr_tier_count ?? 0) === 1) singleValueColumns.push('lvr_tier')
  if (Number(counts?.feature_set_count ?? 0) === 1) singleValueColumns.push('feature_set')

  return {
    banks: rows(banks).map((row) => row.value),
    security_purposes: SECURITY_PURPOSES,
    repayment_types: REPAYMENT_TYPES,
    rate_structures: RATE_STRUCTURES,
    lvr_tiers: LVR_TIERS,
    feature_sets: FEATURE_SETS,
    single_value_columns: singleValueColumns,
  }
}
