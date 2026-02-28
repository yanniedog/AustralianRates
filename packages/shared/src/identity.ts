import type { DatasetKind, SeriesKeyParts } from './types'

function asText(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function required(value: unknown, field: string): string {
  const text = asText(value)
  if (!text) throw new Error(`missing_series_key_part:${field}`)
  return text
}

function maybe(value: unknown): string {
  return asText(value)
}

export function datasetLabel(dataset: DatasetKind): string {
  if (dataset === 'home_loans') return 'home loans'
  if (dataset === 'savings') return 'savings'
  return 'term deposits'
}

export function buildSeriesKey(parts: SeriesKeyParts): string {
  if (parts.dataset === 'home_loans') {
    return [
      required(parts.bankName, 'bank_name'),
      required(parts.productId, 'product_id'),
      required(parts.securityPurpose, 'security_purpose'),
      required(parts.repaymentType, 'repayment_type'),
      required(parts.lvrTier, 'lvr_tier'),
      required(parts.rateStructure, 'rate_structure'),
    ].join('|')
  }

  if (parts.dataset === 'savings') {
    return [
      required(parts.bankName, 'bank_name'),
      required(parts.productId, 'product_id'),
      required(parts.accountType, 'account_type'),
      required(parts.rateType, 'rate_type'),
      required(parts.depositTier, 'deposit_tier'),
    ].join('|')
  }

  return [
    required(parts.bankName, 'bank_name'),
    required(parts.productId, 'product_id'),
    required(parts.termMonths, 'term_months'),
    required(parts.depositTier, 'deposit_tier'),
    required(parts.interestPayment, 'interest_payment'),
  ].join('|')
}

export function buildLegacyProductKey(parts: SeriesKeyParts): string {
  if (parts.dataset === 'term_deposits') {
    return [
      required(parts.bankName, 'bank_name'),
      required(parts.productId, 'product_id'),
      required(parts.termMonths, 'term_months'),
      required(parts.depositTier, 'deposit_tier'),
    ].join('|')
  }
  return buildSeriesKey(parts)
}

export function buildDimensionJson(parts: SeriesKeyParts): string {
  const json = {
    dataset: parts.dataset,
    bank_name: required(parts.bankName, 'bank_name'),
    product_id: required(parts.productId, 'product_id'),
    security_purpose: maybe(parts.securityPurpose) || null,
    repayment_type: maybe(parts.repaymentType) || null,
    lvr_tier: maybe(parts.lvrTier) || null,
    rate_structure: maybe(parts.rateStructure) || null,
    account_type: maybe(parts.accountType) || null,
    rate_type: maybe(parts.rateType) || null,
    deposit_tier: maybe(parts.depositTier) || null,
    term_months: maybe(parts.termMonths) || null,
    interest_payment: maybe(parts.interestPayment) || null,
  }
  return JSON.stringify(json)
}
