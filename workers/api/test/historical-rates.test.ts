/**
 * DB layer tests: invalid normalized rows must be rejected before INSERT.
 */
import { describe, expect, it } from 'vitest'
import { upsertHistoricalRateRow } from '../src/db/historical-rates'
import type { NormalizedRateRow } from '../src/ingest/normalize'

function makeMockD1(): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        run: async () => ({ meta: { changes: 1, last_row_id: 1 } }),
      }),
    }),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database
}

const validCollectionDate = '2025-02-20'

function invalidHomeLoanRow(overrides: Partial<NormalizedRateRow> = {}): NormalizedRateRow {
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

describe('upsertHistoricalRateRow', () => {
  it('throws with invalid_normalized_rate_row reason when interest_rate out of bounds', async () => {
    const db = makeMockD1()
    const row = invalidHomeLoanRow({ interestRate: 100 })
    await expect(upsertHistoricalRateRow(db, row)).rejects.toThrow(/invalid_normalized_rate_row:interest_rate_out_of_bounds/)
  })

  it('throws when product_id is missing', async () => {
    const db = makeMockD1()
    const row = invalidHomeLoanRow({ productId: '' })
    await expect(upsertHistoricalRateRow(db, row)).rejects.toThrow(/invalid_normalized_rate_row:missing_product_id/)
  })

  it('throws when source_url is invalid', async () => {
    const db = makeMockD1()
    const row = invalidHomeLoanRow({ sourceUrl: 'not-a-url' })
    await expect(upsertHistoricalRateRow(db, row)).rejects.toThrow(/invalid_normalized_rate_row:invalid_source_url/)
  })
})
