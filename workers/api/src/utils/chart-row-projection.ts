import type { DatasetKind } from '../../../../packages/shared/src/index.js'
import type { AnalyticsRepresentation } from '../routes/analytics-route-utils'

const COMMON_DAY_FIELDS = [
  'collection_date',
  'bank_name',
  'product_id',
  'product_name',
  'series_key',
  'product_key',
  'product_url',
  'is_removed',
] as const

const DAY_FIELDS_BY_DATASET: Record<DatasetKind, readonly string[]> = {
  home_loans: [
    'interest_rate',
    'comparison_rate',
    'annual_fee',
    'security_purpose',
    'repayment_type',
    'lvr_tier',
    'rate_structure',
    'feature_set',
  ],
  savings: [
    'interest_rate',
    'monthly_fee',
    'account_type',
    'rate_type',
    'deposit_tier',
    'min_balance',
    'max_balance',
    'conditions',
  ],
  term_deposits: [
    'interest_rate',
    'term_months',
    'deposit_tier',
    'min_deposit',
    'max_deposit',
    'interest_payment',
  ],
}

const COMMON_CHANGE_FIELDS = [
  'collection_date',
  'previous_collection_date',
  'changed_at',
  'previous_changed_at',
  'bank_name',
  'product_name',
  'series_key',
  'product_key',
  'product_url',
  'previous_rate',
  'new_rate',
  'delta_bps',
] as const

const CHANGE_FIELDS_BY_DATASET: Record<DatasetKind, readonly string[]> = {
  home_loans: ['security_purpose', 'repayment_type', 'lvr_tier', 'rate_structure', 'feature_set'],
  savings: ['account_type', 'rate_type', 'deposit_tier', 'conditions'],
  term_deposits: ['term_months', 'deposit_tier', 'interest_payment'],
}

function resolveAllowedFields(
  dataset: DatasetKind,
  representation: AnalyticsRepresentation,
): readonly string[] {
  return representation === 'change'
    ? [...COMMON_CHANGE_FIELDS, ...CHANGE_FIELDS_BY_DATASET[dataset]]
    : [...COMMON_DAY_FIELDS, ...DAY_FIELDS_BY_DATASET[dataset]]
}

function pickAllowedFields(
  row: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (row[field] !== undefined) out[field] = row[field]
  }
  return out
}

export function projectChartRows(
  dataset: DatasetKind,
  representation: AnalyticsRepresentation,
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const allowedFields = resolveAllowedFields(dataset, representation)
  return rows.map((row) => pickAllowedFields(row, allowedFields))
}
