import { describe, expect, it } from 'vitest'
import {
  parseComparisonRate,
  parseInterestRate,
  validateNormalizedRow,
  type NormalizedRateRow,
} from '../src/ingest/normalize'

describe('strict numeric parsing', () => {
  it('parses CDR decimal fractions as percentages', () => {
    expect(parseInterestRate('0.0594')).toBe(5.94)
    expect(parseComparisonRate(0.061)).toBe(6.1)
  })

  it('rejects ambiguous or out-of-range values', () => {
    expect(parseInterestRate('LVR 80 to 90%')).toBeNull()
    expect(parseInterestRate('80%')).toBeNull()
    expect(parseComparisonRate('1.20% and 1.40%')).toBeNull()
  })
})

describe('row validation', () => {
  it('rejects weak product rows', () => {
    const row: NormalizedRateRow = {
      bankName: 'ANZ',
      collectionDate: '2026-02-23',
      productId: 'anz-1',
      productName: 'Tooltip disclaimer text',
      securityPurpose: 'owner_occupied',
      repaymentType: 'principal_and_interest',
      rateStructure: 'variable',
      lvrTier: 'lvr_80-85%',
      featureSet: 'basic',
      interestRate: 5.99,
      comparisonRate: 6.1,
      annualFee: null,
      sourceUrl: 'https://example.com',
      dataQualityFlag: 'cdr_live',
      confidenceScore: 0.95,
    }
    const verdict = validateNormalizedRow(row)
    expect(verdict.ok).toBe(false)
  })
})
