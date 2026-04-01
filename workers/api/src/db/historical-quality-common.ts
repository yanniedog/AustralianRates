import { tdSeriesKeySql } from './term-deposits/identity'
import type { HistoricalQualityDatasetScope, HistoricalQualityScope } from './historical-quality-types'

export type HistoricalQualityDatasetConfig = {
  scope: HistoricalQualityDatasetScope
  table: 'historical_loan_rates' | 'historical_savings_rates' | 'historical_term_deposit_rates'
  latestTable: 'latest_home_loan_series' | 'latest_savings_series' | 'latest_td_series'
  rateMin: number
  rateMax: number
  seriesKeySql: string
  dimensionsSql: string
  detailFingerprintSql: string
  productNameColumn: string
}

export const HISTORICAL_QUALITY_DATASET_CONFIGS: HistoricalQualityDatasetConfig[] = [
  {
    scope: 'home_loans',
    table: 'historical_loan_rates',
    latestTable: 'latest_home_loan_series',
    rateMin: 0.5,
    rateMax: 25,
    seriesKeySql:
      "COALESCE(NULLIF(TRIM(rates.series_key), ''), rates.bank_name || '|' || rates.product_id || '|' || rates.security_purpose || '|' || rates.repayment_type || '|' || rates.lvr_tier || '|' || rates.rate_structure)",
    dimensionsSql:
      "COALESCE(NULLIF(TRIM(rates.security_purpose), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.repayment_type), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.lvr_tier), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.rate_structure), ''), '')",
    detailFingerprintSql:
      "COALESCE(CAST(rates.comparison_rate AS TEXT), '') || '|' || COALESCE(CAST(rates.annual_fee AS TEXT), '') || '|' || COALESCE(NULLIF(TRIM(rates.feature_set), ''), '') || '|' || COALESCE(CAST(rates.has_offset_account AS TEXT), '') || '|' || COALESCE(NULLIF(TRIM(rates.source_url), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.product_url), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.published_at), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.cdr_product_detail_hash), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.data_quality_flag), ''), '')",
    productNameColumn: 'product_name',
  },
  {
    scope: 'savings',
    table: 'historical_savings_rates',
    latestTable: 'latest_savings_series',
    rateMin: 0,
    rateMax: 15,
    seriesKeySql:
      "COALESCE(NULLIF(TRIM(rates.series_key), ''), rates.bank_name || '|' || rates.product_id || '|' || rates.account_type || '|' || rates.rate_type || '|' || rates.deposit_tier)",
    dimensionsSql:
      "COALESCE(NULLIF(TRIM(rates.account_type), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.rate_type), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.deposit_tier), ''), '')",
    detailFingerprintSql:
      "COALESCE(CAST(rates.min_balance AS TEXT), '') || '|' || COALESCE(CAST(rates.max_balance AS TEXT), '') || '|' || COALESCE(NULLIF(TRIM(rates.conditions), ''), '') || '|' || COALESCE(CAST(rates.monthly_fee AS TEXT), '') || '|' || COALESCE(NULLIF(TRIM(rates.source_url), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.product_url), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.published_at), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.cdr_product_detail_hash), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.data_quality_flag), ''), '')",
    productNameColumn: 'product_name',
  },
  {
    scope: 'term_deposits',
    table: 'historical_term_deposit_rates',
    latestTable: 'latest_td_series',
    rateMin: 0,
    rateMax: 15,
    seriesKeySql: tdSeriesKeySql('rates'),
    dimensionsSql:
      "CAST(COALESCE(rates.term_months, -1) AS TEXT) || '|' || COALESCE(NULLIF(TRIM(rates.deposit_tier), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.interest_payment), ''), '')",
    detailFingerprintSql:
      "COALESCE(CAST(rates.min_deposit AS TEXT), '') || '|' || COALESCE(CAST(rates.max_deposit AS TEXT), '') || '|' || COALESCE(NULLIF(TRIM(rates.source_url), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.product_url), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.published_at), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.cdr_product_detail_hash), ''), '') || '|' || COALESCE(NULLIF(TRIM(rates.data_quality_flag), ''), '')",
    productNameColumn: 'product_name',
  },
]

export function datasetConfigForScope(scope: HistoricalQualityDatasetScope): HistoricalQualityDatasetConfig {
  const config = HISTORICAL_QUALITY_DATASET_CONFIGS.find((candidate) => candidate.scope === scope)
  if (!config) throw new Error(`Unsupported historical quality scope: ${scope}`)
  return config
}

export function scopeOrder(scope: HistoricalQualityScope): number {
  switch (scope) {
    case 'home_loans':
      return 1
    case 'savings':
      return 2
    case 'term_deposits':
      return 3
    case 'overall':
    default:
      return 4
  }
}

export function stableFindingKey(parts: Array<string | number | null | undefined>): string {
  return parts.map((part) => String(part ?? '').trim()).join('|')
}
