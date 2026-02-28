import { describe, expect, it } from 'vitest'
import {
  validateNormalizedSavingsRow,
  validateNormalizedTdRow,
  type NormalizedSavingsRow,
  type NormalizedTdRow,
} from '../src/ingest/normalize-savings'

const validCollectionDate = '2025-02-20'

function validSavingsRow(overrides: Partial<NormalizedSavingsRow> = {}): NormalizedSavingsRow {
  return {
    bankName: 'ANZ',
    collectionDate: validCollectionDate,
    productId: 'sav-1',
    productName: 'ANZ Online Savings Account',
    accountType: 'savings',
    rateType: 'base',
    interestRate: 4.5,
    depositTier: 'all',
    minBalance: null,
    maxBalance: null,
    conditions: null,
    monthlyFee: null,
    sourceUrl: 'https://example.com/savings',
    dataQualityFlag: 'cdr_live',
    confidenceScore: 0.9,
    ...overrides,
  }
}

function validTdRow(overrides: Partial<NormalizedTdRow> = {}): NormalizedTdRow {
  return {
    bankName: 'ANZ',
    collectionDate: validCollectionDate,
    productId: 'td-1',
    productName: 'ANZ Term Deposit 12 months',
    termMonths: 12,
    interestRate: 4.25,
    depositTier: 'all',
    minDeposit: null,
    maxDeposit: null,
    interestPayment: 'at_maturity',
    sourceUrl: 'https://example.com/td',
    dataQualityFlag: 'cdr_live',
    confidenceScore: 0.9,
    ...overrides,
  }
}

describe('validateNormalizedSavingsRow', () => {
  it('accepts a valid savings row', () => {
    const verdict = validateNormalizedSavingsRow(validSavingsRow())
    expect(verdict.ok).toBe(true)
  })

  it('rejects invalid collection_date', () => {
    const verdict = validateNormalizedSavingsRow(validSavingsRow({ collectionDate: 'bad' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_collection_date')
  })

  it('rejects invalid data_quality_flag', () => {
    const verdict = validateNormalizedSavingsRow(
      validSavingsRow({ productName: 'ANZ Savings Account', dataQualityFlag: 'unknown' }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_data_quality_flag')
  })

  it('accepts unusually high savings rates for anomaly review', () => {
    const verdict = validateNormalizedSavingsRow(
      validSavingsRow({ productName: 'ANZ Savings Account', interestRate: 20 }),
    )
    expect(verdict.ok).toBe(true)
  })

  it('rejects invalid account_type', () => {
    const verdict = validateNormalizedSavingsRow(
      validSavingsRow({ productName: 'ANZ Savings Account', accountType: 'invalid' as 'savings' }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_account_type')
  })

  it('rejects empty deposit_tier', () => {
    const verdict = validateNormalizedSavingsRow(
      validSavingsRow({ productName: 'ANZ Savings Account', depositTier: '  ' }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_deposit_tier')
  })

  it('accepts optional product_url and published_at', () => {
    const verdict = validateNormalizedSavingsRow(
      validSavingsRow({
        productUrl: 'https://example.com/savings-product',
        publishedAt: '2026-02-25T06:17:08.000Z',
      }),
    )
    expect(verdict.ok).toBe(true)
  })

  it('rejects invalid optional product_url', () => {
    const verdict = validateNormalizedSavingsRow(validSavingsRow({ productUrl: 'not-a-url' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_product_url')
  })
})

describe('validateNormalizedTdRow', () => {
  it('accepts a valid TD row', () => {
    const verdict = validateNormalizedTdRow(validTdRow())
    expect(verdict.ok).toBe(true)
  })

  it('accepts long term deposits beyond the old 120-month cap', () => {
    const verdict = validateNormalizedTdRow(validTdRow({ termMonths: 240 }))
    expect(verdict.ok).toBe(true)
  })

  it('rejects invalid interest_payment enum', () => {
    const verdict = validateNormalizedTdRow(
      validTdRow({ interestPayment: 'invalid' as 'at_maturity' }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_interest_payment')
  })

  it('rejects invalid source_url', () => {
    const verdict = validateNormalizedTdRow(validTdRow({ sourceUrl: 'not-a-url' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_source_url')
  })

  it('rejects invalid optional published_at', () => {
    const verdict = validateNormalizedTdRow(validTdRow({ publishedAt: 'not-a-date' }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_published_at')
  })
})
