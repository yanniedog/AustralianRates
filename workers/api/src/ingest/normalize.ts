import type { FeatureSet, LvrTier, RateStructure, RepaymentType, SecurityPurpose } from '../types'

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
  dataQualityFlag: string
  confidenceScore: number
}

function asText(value: unknown): string {
  if (value == null) {
    return ''
  }
  return String(value).trim()
}

function lower(value: unknown): string {
  return asText(value).toLowerCase()
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }
  const raw = String(value).replace(/[^0-9.\-]/g, '')
  if (!raw) {
    return null
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
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

export function normalizeSecurityPurpose(text: string): SecurityPurpose {
  const t = lower(text)
  if (t.includes('invest')) {
    return 'investment'
  }
  return 'owner_occupied'
}

export function normalizeRepaymentType(text: string): RepaymentType {
  const t = lower(text)
  if (t.includes('interest only') || t.includes('interest_only')) {
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

export function normalizeLvrTier(text: string, minLvr?: number | null, maxLvr?: number | null): LvrTier {
  if (Number.isFinite(minLvr as number) || Number.isFinite(maxLvr as number)) {
    const hi = Number.isFinite(maxLvr as number) ? (maxLvr as number) : (minLvr as number)
    return tierForBoundary(hi)
  }

  const t = lower(text)
  const range = t.match(/(\d{1,2}(?:\.\d+)?)\s*(?:-|to)\s*(\d{1,2}(?:\.\d+)?)\s*%/)
  if (range) {
    const hi = Number(range[2])
    if (Number.isFinite(hi)) {
      return tierForBoundary(hi)
    }
  }

  const le = t.match(/(?:<=|≤|under|up to|maximum|max)\s*(\d{1,2}(?:\.\d+)?)\s*%/)
  if (le) {
    const hi = Number(le[1])
    if (Number.isFinite(hi)) {
      return tierForBoundary(hi)
    }
  }

  const anyPercent = t.match(/(\d{1,2}(?:\.\d+)?)\s*%/)
  if (anyPercent) {
    const hi = Number(anyPercent[1])
    if (Number.isFinite(hi)) {
      return tierForBoundary(hi)
    }
  }

  return 'lvr_80-85%'
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
  return parseNumber(value)
}

export function parseComparisonRate(value: unknown): number | null {
  return parseNumber(value)
}

export function parseAnnualFee(value: unknown): number | null {
  return parseNumber(value)
}
