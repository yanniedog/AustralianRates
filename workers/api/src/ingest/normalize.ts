import {
  DATA_QUALITY_FLAGS,
  FEATURE_SETS,
  LVR_TIERS,
  REPAYMENT_TYPES,
  RATE_STRUCTURES,
  RUN_SOURCES,
  SECURITY_PURPOSES,
} from '../constants'
import type { FeatureSet, LvrTier, RateStructure, RepaymentType, RetrievalType, RunSource, SecurityPurpose } from '../types'
import {
  isAllowedDataQualityFlag,
  isFiniteNumber,
  isValidCollectionDate,
  isValidUrl,
  reasonableStringLength,
  VALIDATE_COMMON,
} from './validate-common'

export type NormalizedRateRow = {
  bankName: string
  collectionDate: string
  productId: string
  productName: string
  securityPurpose: SecurityPurpose
  repaymentType: RepaymentType
  rateStructure: RateStructure
  lvrTier: LvrTier
  featureSet: FeatureSet
  interestRate: number
  comparisonRate: number | null
  annualFee: number | null
  sourceUrl: string
  productUrl?: string | null
  publishedAt?: string | null
  dataQualityFlag: string
  confidenceScore: number
  retrievalType?: RetrievalType
  runId?: string
  runSource?: RunSource
}

export const MIN_RATE_PERCENT = 0.5
export const MAX_RATE_PERCENT = 25
export const MIN_COMPARISON_RATE_PERCENT = 0.5
export const MAX_COMPARISON_RATE_PERCENT = 30
export const MAX_ANNUAL_FEE = 10000

function asText(value: unknown): string {
  if (value == null) {
    return ''
  }
  return String(value).trim()
}

function lower(value: unknown): string {
  return asText(value).toLowerCase()
}

function parseSingleNumberToken(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const text = String(value)
  const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? []
  if (matches.length !== 1) {
    return null
  }
  const n = Number(matches[0])
  return Number.isFinite(n) ? n : null
}

function normalizePercentValue(value: unknown): number | null {
  const n = parseSingleNumberToken(value)
  if (n == null) return null

  const text = String(value ?? '')
  const hasPercent = text.includes('%')

  // CDR commonly uses decimal fractions such as 0.0594 for 5.94%.
  if (!hasPercent && n > 0 && n < 1) {
    return Number((n * 100).toFixed(4))
  }

  return n
}

function parseYears(text: string): number | null {
  const m = text.match(/([1-5])\s*(?:year|yr)/i)
  if (!m) {
    return null
  }
  const years = Number(m[1])
  return Number.isFinite(years) ? years : null
}

export function normalizeBankName(input: string, fallback: string): string {
  const v = asText(input)
  return v || fallback
}

export function normalizeProductName(input: string): string {
  return asText(input).replace(/\s+/g, ' ').trim()
}

export function normalizeSecurityPurpose(text: string): SecurityPurpose {
  const t = lower(text)
  if (t.includes('invest')) {
    return 'investment'
  }
  return 'owner_occupied'
}

export function normalizeRepaymentType(text: string): RepaymentType {
  const t = lower(text)
  if (
    t.includes('interest only') ||
    t.includes('interest_only') ||
    t.includes('interestonly') ||
    /\binterest[_\s]*only[_\s]*(?:fixed|variable)?\b/.test(t)
  ) {
    return 'interest_only'
  }
  return 'principal_and_interest'
}

export function normalizeRateStructure(input: string): RateStructure {
  const t = lower(input)
  if (t.includes('variable')) {
    return 'variable'
  }
  if (t.includes('fixed')) {
    const years = parseYears(t)
    if (years === 1) return 'fixed_1yr'
    if (years === 2) return 'fixed_2yr'
    if (years === 3) return 'fixed_3yr'
    if (years === 4) return 'fixed_4yr'
    if (years === 5) return 'fixed_5yr'
    return 'fixed_1yr'
  }
  return 'variable'
}

function tierForBoundary(percent: number): LvrTier {
  if (percent <= 60) return 'lvr_=60%'
  if (percent <= 70) return 'lvr_60-70%'
  if (percent <= 80) return 'lvr_70-80%'
  if (percent <= 85) return 'lvr_80-85%'
  if (percent <= 90) return 'lvr_85-90%'
  return 'lvr_90-95%'
}

export type LvrTierResult = { tier: LvrTier; wasDefault: boolean }

export function normalizeLvrTier(text: string, minLvr?: number | null, maxLvr?: number | null): LvrTierResult {
  if (Number.isFinite(minLvr as number) || Number.isFinite(maxLvr as number)) {
    const hi = Number.isFinite(maxLvr as number) ? (maxLvr as number) : (minLvr as number)
    return { tier: tierForBoundary(hi), wasDefault: false }
  }

  const t = lower(text)
  const range = t.match(/(\d{1,2}(?:\.\d+)?)\s*(?:-|to)\s*(\d{1,2}(?:\.\d+)?)\s*%/)
  if (range) {
    const hi = Number(range[2])
    if (Number.isFinite(hi)) {
      return { tier: tierForBoundary(hi), wasDefault: false }
    }
  }

  const le = t.match(/(?:<=|≤|under|up to|maximum|max)\s*(\d{1,2}(?:\.\d+)?)\s*%/)
  if (le) {
    const hi = Number(le[1])
    if (Number.isFinite(hi)) {
      return { tier: tierForBoundary(hi), wasDefault: false }
    }
  }

  const anyPercent = t.match(/(\d{1,2}(?:\.\d+)?)\s*%/)
  if (anyPercent) {
    const hi = Number(anyPercent[1])
    if (Number.isFinite(hi)) {
      return { tier: tierForBoundary(hi), wasDefault: false }
    }
  }

  return { tier: 'lvr_80-85%', wasDefault: true }
}

export function normalizeFeatureSet(text: string, annualFee: number | null): FeatureSet {
  const t = lower(text)
  if (
    t.includes('package') ||
    t.includes('advantage') ||
    t.includes('premium') ||
    t.includes('offset') ||
    (annualFee != null && annualFee > 0)
  ) {
    return 'premium'
  }
  return 'basic'
}

export function parseInterestRate(value: unknown): number | null {
  const text = lower(value)
  if (text.includes('lvr') || text.includes('loan to value') || text.includes('ltv')) {
    return null
  }
  const rate = normalizePercentValue(value)
  if (rate == null) return null
  if (rate < MIN_RATE_PERCENT || rate > MAX_RATE_PERCENT) return null
  return rate
}

export function parseComparisonRate(value: unknown): number | null {
  const text = lower(value)
  if (text.includes('lvr') || text.includes('loan to value') || text.includes('ltv')) {
    return null
  }
  const rate = normalizePercentValue(value)
  if (rate == null) return null
  if (rate < MIN_COMPARISON_RATE_PERCENT || rate > MAX_COMPARISON_RATE_PERCENT) return null
  return rate
}

export function parseAnnualFee(value: unknown): number | null {
  const n = parseSingleNumberToken(value)
  if (n == null) return null
  if (n < 0 || n > MAX_ANNUAL_FEE) return null
  return n
}

export function minConfidenceForFlag(flag: string): number {
  const f = lower(flag)
  if (f.startsWith('cdr_')) return 0.9
  if (f.startsWith('parsed_from_wayback')) return 0.82
  if (f.startsWith('scraped_fallback')) return 0.95
  return 0.85
}

export function isProductNameLikelyRateProduct(name: string): boolean {
  const normalized = lower(name)
  if (normalized.length < 6) return false
  const blocked = [
    'disclaimer',
    'warning',
    'example',
    'cashback',
    'copyright',
    'privacy',
    'terms and conditions',
    'loan to value ratio',
    'lvr ',
    'tooltip',
  ]
  if (blocked.some((x) => normalized.includes(x))) return false

  const helpfulTokens = ['home', 'loan', 'variable', 'fixed', 'owner', 'invest', 'rate', 'offset', 'package']
  return helpfulTokens.some((x) => normalized.includes(x))
}

const COMPARISON_RATE_MAX_ABOVE_INTEREST = 10

export function validateNormalizedRow(row: NormalizedRateRow): { ok: true } | { ok: false; reason: string } {
  if (!reasonableStringLength(row.bankName, VALIDATE_COMMON.MAX_BANK_NAME_LENGTH)) {
    return { ok: false, reason: 'invalid_bank_name' }
  }
  if (!isValidCollectionDate(row.collectionDate)) {
    return { ok: false, reason: 'invalid_collection_date' }
  }
  if (!reasonableStringLength(row.productId, VALIDATE_COMMON.MAX_PRODUCT_ID_LENGTH)) {
    return { ok: false, reason: 'missing_product_id' }
  }
  const productName = normalizeProductName(row.productName)
  if (!productName || productName.length > VALIDATE_COMMON.MAX_PRODUCT_NAME_LENGTH) {
    return { ok: false, reason: 'missing_product_name' }
  }
  if (!isProductNameLikelyRateProduct(productName)) {
    return { ok: false, reason: 'product_name_not_rate_like' }
  }
  if (!isValidUrl(row.sourceUrl)) {
    return { ok: false, reason: 'invalid_source_url' }
  }
  if (row.productUrl != null && row.productUrl !== '' && !isValidUrl(row.productUrl)) {
    return { ok: false, reason: 'invalid_product_url' }
  }
  if (row.publishedAt != null && row.publishedAt !== '') {
    const published = new Date(String(row.publishedAt))
    if (!Number.isFinite(published.getTime())) {
      return { ok: false, reason: 'invalid_published_at' }
    }
  }
  if (!isAllowedDataQualityFlag(row.dataQualityFlag, DATA_QUALITY_FLAGS)) {
    return { ok: false, reason: 'invalid_data_quality_flag' }
  }
  if (row.runSource != null && !RUN_SOURCES.includes(row.runSource)) {
    return { ok: false, reason: 'invalid_run_source' }
  }
  if (!SECURITY_PURPOSES.includes(row.securityPurpose)) {
    return { ok: false, reason: 'invalid_security_purpose' }
  }
  if (!REPAYMENT_TYPES.includes(row.repaymentType)) {
    return { ok: false, reason: 'invalid_repayment_type' }
  }
  if (!RATE_STRUCTURES.includes(row.rateStructure)) {
    return { ok: false, reason: 'invalid_rate_structure' }
  }
  if (!LVR_TIERS.includes(row.lvrTier)) {
    return { ok: false, reason: 'invalid_lvr_tier' }
  }
  if (!FEATURE_SETS.includes(row.featureSet)) {
    return { ok: false, reason: 'invalid_feature_set' }
  }
  if (!isFiniteNumber(row.interestRate) || row.interestRate < MIN_RATE_PERCENT || row.interestRate > MAX_RATE_PERCENT) {
    return { ok: false, reason: 'interest_rate_out_of_bounds' }
  }
  if (
    row.comparisonRate != null &&
    (!isFiniteNumber(row.comparisonRate) ||
      row.comparisonRate < MIN_COMPARISON_RATE_PERCENT ||
      row.comparisonRate > MAX_COMPARISON_RATE_PERCENT)
  ) {
    return { ok: false, reason: 'comparison_rate_out_of_bounds' }
  }
  if (row.comparisonRate != null && row.comparisonRate + 0.01 < row.interestRate) {
    return { ok: false, reason: 'comparison_rate_below_interest_rate' }
  }
  if (
    row.comparisonRate != null &&
    row.comparisonRate > row.interestRate + COMPARISON_RATE_MAX_ABOVE_INTEREST
  ) {
    return { ok: false, reason: 'comparison_rate_anomalous' }
  }
  if (row.annualFee != null && (!isFiniteNumber(row.annualFee) || row.annualFee < 0 || row.annualFee > MAX_ANNUAL_FEE)) {
    return { ok: false, reason: 'annual_fee_out_of_bounds' }
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
  if (row.runId != null && row.runId !== '' && row.runId.length > VALIDATE_COMMON.MAX_RUN_ID_LENGTH) {
    return { ok: false, reason: 'invalid_run_id' }
  }

  return { ok: true }
}
