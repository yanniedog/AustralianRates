import { describe, expect, it } from 'vitest'
import {
  parseComparisonRate,
  parseInterestRate,
  validateNormalizedRow,
  type NormalizedRateRow,
} from '../src/ingest/normalize'

const validCollectionDate = '2025-02-20'

function validHomeLoanRow(overrides: Partial<NormalizedRateRow> = {}): NormalizedRateRow {
  return {
    bankName: 'ANZ',
    collectionDate: validCollectionDate,
    productId: 'anz-1',
    productName: 'ANZ Variable Home Loan',
    securityPurpose: 'owner_occupied',
    repaymentType: 'principal_and_interest',
    rateStructure: 'variable',
    lvrTier: 'lvr_80-85%',
    featureSet: 'basic',
    interestRate: 5.99,
    comparisonRate: 6.1,
    annualFee: null,
    sourceUrl: 'https://example.com/rates',
    dataQualityFlag: 'cdr_live',
    confidenceScore: 0.95,
    ...overrides,
  }
}

describe('strict numeric parsing', () => {
  it('parses CDR decimal fractions as percentages', () => {
    expect(parseInterestRate('0.0594')).toBe(5.94)
    expect(parseComparisonRate(0.061)).toBe(6.1)
  })

  it('rejects ambiguous parsing while allowing broad but finite rates', () => {
    expect(parseInterestRate('LVR 80 to 90%')).toBeNull()
    expect(parseInterestRate('80%')).toBe(80)
    expect(parseComparisonRate('1.20% and 1.40%')).toBeNull()
  })
})

describe('row validation', () => {
  it('accepts a valid home loan row', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow())
    expect(verdict.ok).toBe(true)
  })

  it('accepts weak product names so they can be classified later instead of being dropped', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow({ productName: 'Tooltip disclaimer text' }))
    expect(verdict.ok).toBe(true)
  })

  it('rejects invalid collection_date', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow({ collectionDate: 'not-a-date' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_collection_date')
  })

  it('rejects invalid source_url', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow({ sourceUrl: 'not-a-url' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_source_url')
  })

  it('accepts valid optional product_url and published_at', () => {
    const verdict = validateNormalizedRow(
      validHomeLoanRow({
        productUrl: 'https://example.com/product',
        publishedAt: '2026-02-25T06:17:08.000Z',
      }),
    )
    expect(verdict.ok).toBe(true)
  })

  it('rejects invalid optional product_url', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow({ productUrl: 'not-a-url' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_product_url')
  })

  it('rejects invalid optional published_at', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow({ publishedAt: 'not-a-date' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_published_at')
  })

  it('rejects invalid data_quality_flag', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow({ dataQualityFlag: 'unknown_flag' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_data_quality_flag')
  })

  it('rejects invalid run_source', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow({ runSource: 'invalid' as 'scheduled' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_run_source')
  })

  it('accepts unusually high but still finite rates for anomaly review', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow({ interestRate: 100 }))
    expect(verdict.ok).toBe(true)
  })

  it('accepts anomalous comparison-rate gaps for later classification', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow({ interestRate: 5, comparisonRate: 20 }))
    expect(verdict.ok).toBe(true)
  })

  it('rejects empty bank_name', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow({ bankName: '  ' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_bank_name')
  })

  it('rejects missing product_id', () => {
    const verdict = validateNormalizedRow(validHomeLoanRow({ productId: '' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('missing_product_id')
  })
})
