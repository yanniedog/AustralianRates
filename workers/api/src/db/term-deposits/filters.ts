import { INTEREST_PAYMENTS } from '../../constants'
import { rows } from '../query-common'

export async function getTdFilters(db: D1Database) {
  const [banks, termMonths, depositTiers, interestPayments] = await Promise.all([
    db.prepare('SELECT DISTINCT bank_name AS value FROM historical_term_deposit_rates ORDER BY bank_name ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT term_months AS value FROM historical_term_deposit_rates ORDER BY CAST(term_months AS INTEGER) ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT deposit_tier AS value FROM historical_term_deposit_rates ORDER BY deposit_tier ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT interest_payment AS value FROM historical_term_deposit_rates ORDER BY interest_payment ASC').all<{ value: string }>(),
  ])

  const fallback = (vals: string[], fb: string[]) => (vals.length > 0 ? vals : fb)

  const termMonthsList = rows(termMonths).map((x) => x.value)
  const depositTiersList = rows(depositTiers).map((x) => x.value)
  const interestPaymentsList = fallback(rows(interestPayments).map((x) => x.value), INTEREST_PAYMENTS)

  const single_value_columns: string[] = []
  if (termMonthsList.length <= 1) single_value_columns.push('term_months')
  if (depositTiersList.length <= 1) single_value_columns.push('deposit_tier')
  if (interestPaymentsList.length <= 1) single_value_columns.push('interest_payment')

  return {
    banks: rows(banks).map((x) => x.value),
    term_months: termMonthsList,
    deposit_tiers: depositTiersList,
    interest_payments: interestPaymentsList,
    single_value_columns,
  }
}
