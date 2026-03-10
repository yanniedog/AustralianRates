import type { LenderConfig } from '../../types.js'
import { nowIso } from '../../utils/time.js'
import type { NormalizedRateRow } from '../normalize.js'
import { normalizeBankName, normalizeFeatureSet } from '../normalize.js'

export function backfillSeedProductRows(input: {
  lender: LenderConfig
  collectionDate: string
  sourceUrl: string
  productName: string
  rate: number
}): NormalizedRateRow {
  const productId = `${input.lender.code}-seed-${Math.abs(hashString(input.productName))}`
  return {
    bankName: normalizeBankName(input.lender.canonical_bank_name, input.lender.name),
    collectionDate: input.collectionDate,
    productId,
    productName: input.productName,
    securityPurpose: 'owner_occupied',
    repaymentType: 'principal_and_interest',
    rateStructure: 'variable',
    lvrTier: 'lvr_80-85%',
    featureSet: normalizeFeatureSet(input.productName, null),
    interestRate: input.rate,
    comparisonRate: null,
    annualFee: null,
    sourceUrl: input.sourceUrl,
    productUrl: input.sourceUrl,
    publishedAt: null,
    dataQualityFlag: 'parsed_from_wayback',
    confidenceScore: 0.6,
    retrievalType: 'historical_scrape',
  }
}

function hashString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0
  }
  return h
}

export function buildBackfillCursorKey(lenderCode: string, monthCursor: string, seedUrl: string): string {
  return `${lenderCode}|${monthCursor}|${seedUrl}`
}

export function cdrCollectionNotes(productCount: number, rowCount: number): string {
  return `cdr_collection products=${productCount} rows=${rowCount} at=${nowIso()}`
}
