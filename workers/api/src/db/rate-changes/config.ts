import { tdProductKeySql, tdSeriesKeySql } from '../term-deposits/identity'

export type RateChangeDataset = 'home_loans' | 'savings' | 'term_deposits'

export type RateChangeDatasetConfig = {
  dataset: RateChangeDataset
  table: string
  minRate: number
  maxRate: number
  minConfidence: number
  keyDimensions: string[]
  productKeyExpression: string
  seriesKeyExpression: string
  detailColumns: string[]
  detailSelect: string[]
}

const homeLoanConfig: RateChangeDatasetConfig = {
  dataset: 'home_loans',
  table: 'historical_loan_rates',
  minRate: 0.5,
  maxRate: 25,
  minConfidence: 0.85,
  keyDimensions: ['bank_name', 'product_id', 'security_purpose', 'repayment_type', 'lvr_tier', 'rate_structure'],
  productKeyExpression:
    "h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure",
  seriesKeyExpression:
    "COALESCE(NULLIF(TRIM(h.series_key), ''), h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure)",
  detailColumns: ['security_purpose', 'repayment_type', 'lvr_tier', 'rate_structure'],
  detailSelect: ['o.security_purpose', 'o.repayment_type', 'o.lvr_tier', 'o.rate_structure'],
}

const savingsConfig: RateChangeDatasetConfig = {
  dataset: 'savings',
  table: 'historical_savings_rates',
  minRate: 0,
  maxRate: 15,
  minConfidence: 0.85,
  keyDimensions: ['bank_name', 'product_id', 'account_type', 'rate_type', 'deposit_tier'],
  productKeyExpression: "h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier",
  seriesKeyExpression:
    "COALESCE(NULLIF(TRIM(h.series_key), ''), h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier)",
  detailColumns: ['account_type', 'rate_type', 'deposit_tier'],
  detailSelect: ['o.account_type', 'o.rate_type', 'o.deposit_tier'],
}

const termDepositConfig: RateChangeDatasetConfig = {
  dataset: 'term_deposits',
  table: 'historical_term_deposit_rates',
  minRate: 0,
  maxRate: 15,
  minConfidence: 0.85,
  keyDimensions: ['bank_name', 'product_id', 'term_months', 'deposit_tier', 'interest_payment'],
  productKeyExpression: tdProductKeySql('h'),
  seriesKeyExpression: tdSeriesKeySql('h'),
  detailColumns: ['term_months', 'deposit_tier', 'interest_payment'],
  detailSelect: ['o.term_months', 'o.deposit_tier', 'o.interest_payment'],
}

export const RATE_CHANGE_DATASETS: Record<RateChangeDataset, RateChangeDatasetConfig> = {
  home_loans: homeLoanConfig,
  savings: savingsConfig,
  term_deposits: termDepositConfig,
}

export function getRateChangeDatasetConfig(dataset: RateChangeDataset): RateChangeDatasetConfig {
  return RATE_CHANGE_DATASETS[dataset]
}
