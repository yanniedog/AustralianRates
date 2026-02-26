import {
  DATA_QUALITY_FLAGS,
  INTEREST_PAYMENTS,
  RUN_SOURCES,
  SAVINGS_ACCOUNT_TYPES,
  SAVINGS_RATE_TYPES,
} from '../constants'
import type { InterestPayment, RetrievalType, RunSource, SavingsAccountType, SavingsRateType } from '../types'
import {
  isAllowedDataQualityFlag,
  isFiniteNumber,
  isValidCollectionDate,
  isValidUrl,
  reasonableStringLength,
  VALIDATE_COMMON,
} from './validate-common'

export type NormalizedSavingsRow = {
  bankName: string
  collectionDate: string
  productId: string
  productName: string
  accountType: SavingsAccountType
  rateType: SavingsRateType
  interestRate: number
  depositTier: string
  minBalance: number | null
  maxBalance: number | null
  conditions: string | null
  monthlyFee: number | null
  sourceUrl: string
  productUrl?: string | null
  publishedAt?: string | null
  cdrProductDetailJson?: string | null
  dataQualityFlag: string
  confidenceScore: number
  retrievalType?: RetrievalType
  runId?: string
  runSource?: RunSource
}

export type NormalizedTdRow = {
  bankName: string
  collectionDate: string
  productId: string
  productName: string
  termMonths: number
  interestRate: number
  depositTier: string
  minDeposit: number | null
  maxDeposit: number | null
  interestPayment: InterestPayment
  sourceUrl: string
  productUrl?: string | null
  publishedAt?: string | null
  cdrProductDetailJson?: string | null
  dataQualityFlag: string
  confidenceScore: number
  retrievalType?: RetrievalType
  runId?: string
  runSource?: RunSource
}

export const MIN_SAVINGS_RATE = 0
export const MAX_SAVINGS_RATE = 15
export const MAX_MONTHLY_FEE = 50
const MAX_BALANCE_VALUE = 100000000
const MAX_DEPOSIT_VALUE = 100000000

function asText(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function lower(value: unknown): string {
  return asText(value).toLowerCase()
}

function hasBlockedProductText(name: string): boolean {
  const normalized = lower(name)
  const blocked = [
    'disclaimer',
    'warning',
    'example',
    'privacy',
    'terms and conditions',
    'copyright',
    'tooltip',
  ]
  return blocked.some((x) => normalized.includes(x))
}

function isLikelySavingsProductName(name: string): boolean {
  const normalized = lower(name)
  if (!normalized || normalized.length < 4) return false
  if (hasBlockedProductText(normalized)) return false
  const tokens = ['savings', 'account', 'bonus', 'intro', 'transaction', 'everyday', 'at call', 'deposit']
  return tokens.some((x) => normalized.includes(x))
}

function isLikelyTdProductName(name: string): boolean {
  const normalized = lower(name)
  if (!normalized || normalized.length < 4) return false
  if (hasBlockedProductText(normalized)) return false
  const tokens = ['term', 'deposit', 'fixed', 'maturity']
  return tokens.some((x) => normalized.includes(x))
}

function minConfidenceForFlag(flag: string): number {
  const normalized = lower(flag)
  if (normalized.startsWith('cdr_')) return 0.7
  if (normalized.startsWith('scraped_fallback')) return 0.75
  if (normalized.startsWith('parsed_from_wayback')) return 0.65
  return 0.6
}

export function normalizeAccountType(text: string): SavingsAccountType {
  const t = lower(text)
  if (t.includes('transaction') || t.includes('everyday') || t.includes('spending')) return 'transaction'
  if (t.includes('at call') || t.includes('at_call')) return 'at_call'
  return 'savings'
}

export function normalizeDepositRateType(depositRateType: string): SavingsRateType {
  const t = lower(depositRateType)
  if (t.includes('bonus')) return 'bonus'
  if (t.includes('introductory') || t.includes('intro')) return 'introductory'
  if (t.includes('bundle') || t.includes('bundled')) return 'bundle'
  if (t === 'fixed' || t === 'variable' || t === 'floating' || t === 'market_linked') return 'base'
  return 'base'
}

export function normalizeDepositTier(
  minBalance: number | null,
  maxBalance: number | null,
): string {
  if (minBalance == null && maxBalance == null) return 'all'
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}m`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`
    return `$${n}`
  }
  if (minBalance != null && maxBalance != null) return `${fmt(minBalance)}-${fmt(maxBalance)}`
  if (minBalance != null) return `${fmt(minBalance)}+`
  if (maxBalance != null) return `up to ${fmt(maxBalance)}`
  return 'all'
}

export function parseTermMonths(duration: string): number | null {
  const t = asText(duration).toUpperCase()
  const isoMatch = t.match(/^P(\d+)([DMYW])$/)
  if (isoMatch) {
    const n = Number(isoMatch[1])
    const unit = isoMatch[2]
    if (unit === 'M') return n
    if (unit === 'D') return Math.round(n / 30)
    if (unit === 'Y' || unit === 'W') return unit === 'Y' ? n * 12 : Math.round((n * 7) / 30)
  }
  const monthMatch = t.match(/(\d+)\s*(?:month|mth|mo)/i)
  if (monthMatch) return Number(monthMatch[1])
  const dayMatch = t.match(/(\d+)\s*day/i)
  if (dayMatch) return Math.round(Number(dayMatch[1]) / 30)
  const yearMatch = t.match(/(\d+)\s*year/i)
  if (yearMatch) return Number(yearMatch[1]) * 12
  const n = Number(t)
  if (Number.isFinite(n) && n > 0 && n <= 120) return n
  return null
}

export function normalizeInterestPayment(text: string): InterestPayment {
  const t = lower(text)
  if (t.includes('monthly')) return 'monthly'
  if (t.includes('quarterly') || t.includes('quarter')) return 'quarterly'
  if (t.includes('annual') || t.includes('yearly')) return 'annually'
  return 'at_maturity'
}

export function parseSavingsInterestRate(value: unknown): number | null {
  if (value == null || value === '') return null
  let n: number
  if (typeof value === 'number') {
    n = value
  } else {
    const text = String(value)
    const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? []
    if (matches.length !== 1) return null
    n = Number(matches[0])
  }
  if (!Number.isFinite(n)) return null
  if (n > 0 && n < 1) n = Number((n * 100).toFixed(4))
  if (n < MIN_SAVINGS_RATE || n > MAX_SAVINGS_RATE) return null
  return n
}

export function validateNormalizedSavingsRow(
  row: NormalizedSavingsRow,
): { ok: true } | { ok: false; reason: string } {
  if (!reasonableStringLength(row.bankName, VALIDATE_COMMON.MAX_BANK_NAME_LENGTH)) {
    return { ok: false, reason: 'invalid_bank_name' }
  }
  if (!isValidCollectionDate(row.collectionDate)) {
    return { ok: false, reason: 'invalid_collection_date' }
  }
  if (!reasonableStringLength(row.productId, VALIDATE_COMMON.MAX_PRODUCT_ID_LENGTH)) {
    return { ok: false, reason: 'missing_product_id' }
  }
  if (!row.productName?.trim() || row.productName.length > VALIDATE_COMMON.MAX_PRODUCT_NAME_LENGTH) {
    return { ok: false, reason: 'missing_product_name' }
  }
  if (!isLikelySavingsProductName(row.productName)) return { ok: false, reason: 'product_name_not_rate_like' }
  if (!isValidUrl(row.sourceUrl)) return { ok: false, reason: 'invalid_source_url' }
  if (row.productUrl != null && row.productUrl !== '' && !isValidUrl(row.productUrl)) {
    return { ok: false, reason: 'invalid_product_url' }
  }
  if (row.publishedAt != null && row.publishedAt !== '') {
    const published = new Date(String(row.publishedAt))
    if (!Number.isFinite(published.getTime())) return { ok: false, reason: 'invalid_published_at' }
  }
  if (!row.depositTier?.trim() || row.depositTier.length > VALIDATE_COMMON.MAX_DEPOSIT_TIER_LENGTH) {
    return { ok: false, reason: 'invalid_deposit_tier' }
  }
  if (!isAllowedDataQualityFlag(row.dataQualityFlag, DATA_QUALITY_FLAGS)) {
    return { ok: false, reason: 'invalid_data_quality_flag' }
  }
  if (row.runSource != null && !RUN_SOURCES.includes(row.runSource)) {
    return { ok: false, reason: 'invalid_run_source' }
  }
  if (!SAVINGS_ACCOUNT_TYPES.includes(row.accountType)) {
    return { ok: false, reason: 'invalid_account_type' }
  }
  if (!SAVINGS_RATE_TYPES.includes(row.rateType)) {
    return { ok: false, reason: 'invalid_rate_type' }
  }
  if (!isFiniteNumber(row.interestRate) || row.interestRate < MIN_SAVINGS_RATE || row.interestRate > MAX_SAVINGS_RATE) {
    return { ok: false, reason: 'interest_rate_out_of_bounds' }
  }
  if (row.minBalance != null && (!isFiniteNumber(row.minBalance) || row.minBalance < 0 || row.minBalance > MAX_BALANCE_VALUE)) {
    return { ok: false, reason: 'min_balance_out_of_bounds' }
  }
  if (row.maxBalance != null && (!isFiniteNumber(row.maxBalance) || row.maxBalance < 0 || row.maxBalance > MAX_BALANCE_VALUE)) {
    return { ok: false, reason: 'max_balance_out_of_bounds' }
  }
  if (row.minBalance != null && row.maxBalance != null && row.minBalance > row.maxBalance) {
    return { ok: false, reason: 'balance_bounds_invalid' }
  }
  if (row.monthlyFee != null && (!isFiniteNumber(row.monthlyFee) || row.monthlyFee < 0 || row.monthlyFee > MAX_MONTHLY_FEE)) {
    return { ok: false, reason: 'monthly_fee_out_of_bounds' }
  }
  const minConfidence = minConfidenceForFlag(row.dataQualityFlag)
  if (
    !isFiniteNumber(row.confidenceScore) ||
    row.confidenceScore < 0 ||
    row.confidenceScore < minConfidence ||
    row.confidenceScore > 1
  ) {
    return { ok: false, reason: 'confidence_out_of_bounds' }
  }
  return { ok: true }
}

export function validateNormalizedTdRow(
  row: NormalizedTdRow,
): { ok: true } | { ok: false; reason: string } {
  if (!reasonableStringLength(row.bankName, VALIDATE_COMMON.MAX_BANK_NAME_LENGTH)) {
    return { ok: false, reason: 'invalid_bank_name' }
  }
  if (!isValidCollectionDate(row.collectionDate)) {
    return { ok: false, reason: 'invalid_collection_date' }
  }
  if (!reasonableStringLength(row.productId, VALIDATE_COMMON.MAX_PRODUCT_ID_LENGTH)) {
    return { ok: false, reason: 'missing_product_id' }
  }
  if (!row.productName?.trim() || row.productName.length > VALIDATE_COMMON.MAX_PRODUCT_NAME_LENGTH) {
    return { ok: false, reason: 'missing_product_name' }
  }
  if (!isLikelyTdProductName(row.productName)) return { ok: false, reason: 'product_name_not_rate_like' }
  if (!isValidUrl(row.sourceUrl)) return { ok: false, reason: 'invalid_source_url' }
  if (row.productUrl != null && row.productUrl !== '' && !isValidUrl(row.productUrl)) {
    return { ok: false, reason: 'invalid_product_url' }
  }
  if (row.publishedAt != null && row.publishedAt !== '') {
    const published = new Date(String(row.publishedAt))
    if (!Number.isFinite(published.getTime())) return { ok: false, reason: 'invalid_published_at' }
  }
  if (!row.depositTier?.trim() || row.depositTier.length > VALIDATE_COMMON.MAX_DEPOSIT_TIER_LENGTH) {
    return { ok: false, reason: 'invalid_deposit_tier' }
  }
  if (!isAllowedDataQualityFlag(row.dataQualityFlag, DATA_QUALITY_FLAGS)) {
    return { ok: false, reason: 'invalid_data_quality_flag' }
  }
  if (row.runSource != null && !RUN_SOURCES.includes(row.runSource)) {
    return { ok: false, reason: 'invalid_run_source' }
  }
  if (!INTEREST_PAYMENTS.includes(row.interestPayment)) {
    return { ok: false, reason: 'invalid_interest_payment' }
  }
  if (!isFiniteNumber(row.interestRate) || row.interestRate < MIN_SAVINGS_RATE || row.interestRate > MAX_SAVINGS_RATE) {
    return { ok: false, reason: 'interest_rate_out_of_bounds' }
  }
  const termMonths = row.termMonths
  if (
    !isFiniteNumber(termMonths) ||
    !Number.isInteger(termMonths) ||
    termMonths < 1 ||
    termMonths > 120
  ) {
    return { ok: false, reason: 'term_months_out_of_bounds' }
  }
  if (row.minDeposit != null && (!isFiniteNumber(row.minDeposit) || row.minDeposit < 0 || row.minDeposit > MAX_DEPOSIT_VALUE)) {
    return { ok: false, reason: 'min_deposit_out_of_bounds' }
  }
  if (row.maxDeposit != null && (!isFiniteNumber(row.maxDeposit) || row.maxDeposit < 0 || row.maxDeposit > MAX_DEPOSIT_VALUE)) {
    return { ok: false, reason: 'max_deposit_out_of_bounds' }
  }
  if (row.minDeposit != null && row.maxDeposit != null && row.minDeposit > row.maxDeposit) {
    return { ok: false, reason: 'deposit_bounds_invalid' }
  }
  const minConfidence = minConfidenceForFlag(row.dataQualityFlag)
  if (
    !isFiniteNumber(row.confidenceScore) ||
    row.confidenceScore < 0 ||
    row.confidenceScore < minConfidence ||
    row.confidenceScore > 1
  ) {
    return { ok: false, reason: 'confidence_out_of_bounds' }
  }
  return { ok: true }
}
