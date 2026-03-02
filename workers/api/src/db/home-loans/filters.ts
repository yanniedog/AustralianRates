import {
  FEATURE_SETS,
  LVR_TIERS,
  RATE_STRUCTURES,
  REPAYMENT_TYPES,
  SECURITY_PURPOSES,
} from '../../constants'
import { rows } from '../query-common'

export async function getFilters(db: D1Database) {
  const [banks, securityPurposes, repaymentTypes, rateStructures, lvrTiers, featureSets] = await Promise.all([
    db.prepare('SELECT DISTINCT bank_name AS value FROM historical_loan_rates ORDER BY bank_name ASC').all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT security_purpose AS value FROM historical_loan_rates ORDER BY security_purpose ASC')
      .all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT repayment_type AS value FROM historical_loan_rates ORDER BY repayment_type ASC')
      .all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT rate_structure AS value FROM historical_loan_rates ORDER BY rate_structure ASC')
      .all<{ value: string }>(),
    db.prepare('SELECT DISTINCT lvr_tier AS value FROM historical_loan_rates ORDER BY lvr_tier ASC').all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT feature_set AS value FROM historical_loan_rates ORDER BY feature_set ASC')
      .all<{ value: string }>(),
  ])

  const fallbackIfEmpty = (values: string[], fallback: string[]) => (values.length > 0 ? values : fallback)

  const securityPurposesList = fallbackIfEmpty(
    rows(securityPurposes).map((x) => x.value),
    SECURITY_PURPOSES,
  )
  const repaymentTypesList = fallbackIfEmpty(
    rows(repaymentTypes).map((x) => x.value),
    REPAYMENT_TYPES,
  )
  const rateStructuresList = fallbackIfEmpty(
    rows(rateStructures).map((x) => x.value),
    RATE_STRUCTURES,
  )
  const lvrTiersList = fallbackIfEmpty(
    rows(lvrTiers).map((x) => x.value),
    LVR_TIERS,
  )
  const featureSetsList = fallbackIfEmpty(
    rows(featureSets).map((x) => x.value),
    FEATURE_SETS,
  )

  const single_value_columns: string[] = []
  if (securityPurposesList.length <= 1) single_value_columns.push('security_purpose')
  if (repaymentTypesList.length <= 1) single_value_columns.push('repayment_type')
  if (rateStructuresList.length <= 1) single_value_columns.push('rate_structure')
  if (lvrTiersList.length <= 1) single_value_columns.push('lvr_tier')
  if (featureSetsList.length <= 1) single_value_columns.push('feature_set')

  return {
    banks: rows(banks).map((x) => x.value),
    security_purposes: securityPurposesList,
    repayment_types: repaymentTypesList,
    rate_structures: rateStructuresList,
    lvr_tiers: lvrTiersList,
    feature_sets: featureSetsList,
    single_value_columns,
  }
}
