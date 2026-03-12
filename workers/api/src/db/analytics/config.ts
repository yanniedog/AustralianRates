import type { DatasetKind } from '../../../../../packages/shared/src/index.js'

export type AnalyticsDatasetConfig = {
  dataset: DatasetKind
  routeSlug: 'home-loans' | 'savings' | 'term-deposits'
  historicalTable: string
  latestTable: string
  eventsTable: string
  intervalsTable: string
  canonicalKeyColumns: string[]
  changeDetailColumns: string[]
  pivotValueColumns: string[]
  pivotLabelColumns: string[]
}

const DATASET_CONFIGS: Record<DatasetKind, AnalyticsDatasetConfig> = {
  home_loans: {
    dataset: 'home_loans',
    routeSlug: 'home-loans',
    historicalTable: 'historical_loan_rates',
    latestTable: 'latest_home_loan_series',
    eventsTable: 'home_loan_rate_events',
    intervalsTable: 'home_loan_rate_intervals',
    canonicalKeyColumns: [
      'bank_name',
      'collection_date',
      'product_id',
      'lvr_tier',
      'rate_structure',
      'security_purpose',
      'repayment_type',
      'run_source',
    ],
    changeDetailColumns: ['security_purpose', 'repayment_type', 'lvr_tier', 'rate_structure', 'feature_set'],
    pivotValueColumns: ['interest_rate', 'comparison_rate', 'annual_fee'],
    pivotLabelColumns: [
      'collection_date',
      'bank_name',
      'product_name',
      'product_key',
      'series_key',
      'security_purpose',
      'repayment_type',
      'lvr_tier',
      'rate_structure',
      'feature_set',
      'run_source',
      'retrieval_type',
      'data_quality_flag',
    ],
  },
  savings: {
    dataset: 'savings',
    routeSlug: 'savings',
    historicalTable: 'historical_savings_rates',
    latestTable: 'latest_savings_series',
    eventsTable: 'savings_rate_events',
    intervalsTable: 'savings_rate_intervals',
    canonicalKeyColumns: [
      'bank_name',
      'collection_date',
      'product_id',
      'account_type',
      'rate_type',
      'deposit_tier',
      'run_source',
    ],
    changeDetailColumns: ['account_type', 'rate_type', 'deposit_tier', 'conditions'],
    pivotValueColumns: ['interest_rate', 'min_balance', 'max_balance', 'monthly_fee'],
    pivotLabelColumns: [
      'collection_date',
      'bank_name',
      'product_name',
      'product_key',
      'series_key',
      'account_type',
      'rate_type',
      'deposit_tier',
      'conditions',
      'run_source',
      'retrieval_type',
      'data_quality_flag',
    ],
  },
  term_deposits: {
    dataset: 'term_deposits',
    routeSlug: 'term-deposits',
    historicalTable: 'historical_term_deposit_rates',
    latestTable: 'latest_td_series',
    eventsTable: 'td_rate_events',
    intervalsTable: 'td_rate_intervals',
    canonicalKeyColumns: [
      'bank_name',
      'collection_date',
      'product_id',
      'term_months',
      'deposit_tier',
      'interest_payment',
      'run_source',
    ],
    changeDetailColumns: ['term_months', 'deposit_tier', 'interest_payment'],
    pivotValueColumns: ['interest_rate', 'min_deposit', 'max_deposit'],
    pivotLabelColumns: [
      'collection_date',
      'bank_name',
      'product_name',
      'product_key',
      'series_key',
      'term_months',
      'deposit_tier',
      'interest_payment',
      'run_source',
      'retrieval_type',
      'data_quality_flag',
    ],
  },
}

export function getAnalyticsDatasetConfig(dataset: DatasetKind): AnalyticsDatasetConfig {
  return DATASET_CONFIGS[dataset]
}

export function getAnalyticsDatasetConfigs(): AnalyticsDatasetConfig[] {
  return Object.values(DATASET_CONFIGS)
}

export function datasetFromHistoricalTable(tableName: string): DatasetKind | null {
  const match = getAnalyticsDatasetConfigs().find((config) => config.historicalTable === tableName)
  return match?.dataset ?? null
}

export function datasetFromProjectionTable(tableName: string): DatasetKind | null {
  const match = getAnalyticsDatasetConfigs().find(
    (config) => config.eventsTable === tableName || config.intervalsTable === tableName,
  )
  return match?.dataset ?? null
}
