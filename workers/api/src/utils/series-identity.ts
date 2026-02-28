import { buildDimensionJson, buildLegacyProductKey, buildSeriesKey, type DatasetKind } from '../../../../packages/shared/src'
import type { NormalizedRateRow } from '../ingest/normalize'
import type { NormalizedSavingsRow, NormalizedTdRow } from '../ingest/normalize-savings'

export function homeLoanSeriesKey(row: Pick<NormalizedRateRow, 'bankName' | 'productId' | 'securityPurpose' | 'repaymentType' | 'lvrTier' | 'rateStructure'>): string {
  return buildSeriesKey({
    dataset: 'home_loans',
    bankName: row.bankName,
    productId: row.productId,
    securityPurpose: row.securityPurpose,
    repaymentType: row.repaymentType,
    lvrTier: row.lvrTier,
    rateStructure: row.rateStructure,
  })
}

export function savingsSeriesKey(row: Pick<NormalizedSavingsRow, 'bankName' | 'productId' | 'accountType' | 'rateType' | 'depositTier'>): string {
  return buildSeriesKey({
    dataset: 'savings',
    bankName: row.bankName,
    productId: row.productId,
    accountType: row.accountType,
    rateType: row.rateType,
    depositTier: row.depositTier,
  })
}

export function tdSeriesKey(row: Pick<NormalizedTdRow, 'bankName' | 'productId' | 'termMonths' | 'depositTier' | 'interestPayment'>): string {
  return buildSeriesKey({
    dataset: 'term_deposits',
    bankName: row.bankName,
    productId: row.productId,
    termMonths: row.termMonths,
    depositTier: row.depositTier,
    interestPayment: row.interestPayment,
  })
}

export function legacyProductKey(dataset: DatasetKind, input: {
  bankName: string
  productId: string
  securityPurpose?: string | null
  repaymentType?: string | null
  lvrTier?: string | null
  rateStructure?: string | null
  accountType?: string | null
  rateType?: string | null
  depositTier?: string | null
  termMonths?: number | string | null
  interestPayment?: string | null
}): string {
  return buildLegacyProductKey({
    dataset,
    bankName: input.bankName,
    productId: input.productId,
    securityPurpose: input.securityPurpose,
    repaymentType: input.repaymentType,
    lvrTier: input.lvrTier,
    rateStructure: input.rateStructure,
    accountType: input.accountType,
    rateType: input.rateType,
    depositTier: input.depositTier,
    termMonths: input.termMonths,
    interestPayment: input.interestPayment,
  })
}

export function homeLoanDimensionJson(row: Pick<NormalizedRateRow, 'bankName' | 'productId' | 'securityPurpose' | 'repaymentType' | 'lvrTier' | 'rateStructure'>): string {
  return buildDimensionJson({
    dataset: 'home_loans',
    bankName: row.bankName,
    productId: row.productId,
    securityPurpose: row.securityPurpose,
    repaymentType: row.repaymentType,
    lvrTier: row.lvrTier,
    rateStructure: row.rateStructure,
  })
}

export function savingsDimensionJson(row: Pick<NormalizedSavingsRow, 'bankName' | 'productId' | 'accountType' | 'rateType' | 'depositTier'>): string {
  return buildDimensionJson({
    dataset: 'savings',
    bankName: row.bankName,
    productId: row.productId,
    accountType: row.accountType,
    rateType: row.rateType,
    depositTier: row.depositTier,
  })
}

export function tdDimensionJson(row: Pick<NormalizedTdRow, 'bankName' | 'productId' | 'termMonths' | 'depositTier' | 'interestPayment'>): string {
  return buildDimensionJson({
    dataset: 'term_deposits',
    bankName: row.bankName,
    productId: row.productId,
    termMonths: row.termMonths,
    depositTier: row.depositTier,
    interestPayment: row.interestPayment,
  })
}
