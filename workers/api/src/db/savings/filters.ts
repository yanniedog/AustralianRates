import { SAVINGS_ACCOUNT_TYPES, SAVINGS_RATE_TYPES } from '../../constants'
import { rows } from '../query-common'

export async function getSavingsFilters(db: D1Database) {
  const [banks, accountTypes, rateTypes, depositTiers] = await Promise.all([
    db.prepare('SELECT DISTINCT bank_name AS value FROM historical_savings_rates ORDER BY bank_name ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT account_type AS value FROM historical_savings_rates ORDER BY account_type ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT rate_type AS value FROM historical_savings_rates ORDER BY rate_type ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT deposit_tier AS value FROM historical_savings_rates ORDER BY deposit_tier ASC').all<{ value: string }>(),
  ])

  const fallback = (vals: string[], fb: string[]) => (vals.length > 0 ? vals : fb)

  const accountTypesList = fallback(rows(accountTypes).map((x) => x.value), SAVINGS_ACCOUNT_TYPES)
  const rateTypesList = fallback(rows(rateTypes).map((x) => x.value), SAVINGS_RATE_TYPES)
  const depositTiersList = rows(depositTiers).map((x) => x.value)

  const single_value_columns: string[] = []
  if (accountTypesList.length <= 1) single_value_columns.push('account_type')
  if (rateTypesList.length <= 1) single_value_columns.push('rate_type')
  if (depositTiersList.length <= 1) single_value_columns.push('deposit_tier')

  return {
    banks: rows(banks).map((x) => x.value),
    account_types: accountTypesList,
    rate_types: rateTypesList,
    deposit_tiers: depositTiersList,
    single_value_columns,
  }
}
