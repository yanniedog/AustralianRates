import type { InterestPayment, RunSource, SavingsAccountType, SavingsRateType } from '../types'

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
  dataQualityFlag: string
  confidenceScore: number
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
  dataQualityFlag: string
  confidenceScore: number
  runId?: string
  runSource?: RunSource
}

export const MIN_SAVINGS_RATE = 0
export const MAX_SAVINGS_RATE = 15
export const MAX_MONTHLY_FEE = 50

function asText(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function lower(value: unknown): string {
  return asText(value).toLowerCase()
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
  if (!row.productId?.trim()) return { ok: false, reason: 'missing_product_id' }
  if (!row.productName?.trim()) return { ok: false, reason: 'missing_product_name' }
  if (!row.sourceUrl?.trim()) return { ok: false, reason: 'missing_source_url' }
  if (!Number.isFinite(row.interestRate) || row.interestRate < MIN_SAVINGS_RATE || row.interestRate > MAX_SAVINGS_RATE) {
    return { ok: false, reason: 'interest_rate_out_of_bounds' }
  }
  if (!Number.isFinite(row.confidenceScore) || row.confidenceScore < 0 || row.confidenceScore > 1) {
    return { ok: false, reason: 'confidence_out_of_bounds' }
  }
  return { ok: true }
}

export function validateNormalizedTdRow(
  row: NormalizedTdRow,
): { ok: true } | { ok: false; reason: string } {
  if (!row.productId?.trim()) return { ok: false, reason: 'missing_product_id' }
  if (!row.productName?.trim()) return { ok: false, reason: 'missing_product_name' }
  if (!row.sourceUrl?.trim()) return { ok: false, reason: 'missing_source_url' }
  if (!Number.isFinite(row.interestRate) || row.interestRate < MIN_SAVINGS_RATE || row.interestRate > MAX_SAVINGS_RATE) {
    return { ok: false, reason: 'interest_rate_out_of_bounds' }
  }
  if (!Number.isFinite(row.termMonths) || row.termMonths < 1 || row.termMonths > 120) {
    return { ok: false, reason: 'term_months_out_of_bounds' }
  }
  if (!Number.isFinite(row.confidenceScore) || row.confidenceScore < 0 || row.confidenceScore > 1) {
    return { ok: false, reason: 'confidence_out_of_bounds' }
  }
  return { ok: true }
}
