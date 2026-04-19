import { describe, expect, it } from 'vitest'
import { buildReportProductHistoryPayload } from '../src/chart-model/report-product-history'

describe('report-product-history', () => {
  it('builds compact per-product series with sorted shared dates', () => {
    const payload = buildReportProductHistoryPayload('home_loans', [
      {
        collection_date: '2026-04-18',
        bank_name: 'AMP Bank',
        product_name: 'First Home Loan',
        product_key: 'amp|first|oo|pi|80-85|variable',
        product_id: 'first',
        security_purpose: 'owner_occupied',
        repayment_type: 'principal_and_interest',
        rate_structure: 'variable',
        lvr_tier: 'lvr_80-85%',
        feature_set: 'basic',
        interest_rate: 5.9,
      },
      {
        collection_date: '2026-04-19',
        bank_name: 'AMP Bank',
        product_name: 'First Home Loan',
        product_key: 'amp|first|oo|pi|80-85|variable',
        product_id: 'first',
        security_purpose: 'owner_occupied',
        repayment_type: 'principal_and_interest',
        rate_structure: 'variable',
        lvr_tier: 'lvr_80-85%',
        feature_set: 'basic',
        interest_rate: 5.88,
      },
    ])

    expect(payload.dates).toEqual(['2026-04-18', '2026-04-19'])
    expect(payload.products).toHaveLength(1)
    expect(payload.products[0]).toMatchObject({
      key: 'amp|first|oo|pi|80-85|variable',
      bank_name: 'AMP Bank',
      product_name: 'First Home Loan',
      rate_structure: 'variable',
      lvr_tier: 'lvr_80-85%',
    })
    expect(payload.products[0]?.points).toEqual([
      [0, 5.9],
      [1, 5.88],
    ])
  })

  it('keeps term-deposit terms numeric for client-side sorting', () => {
    const payload = buildReportProductHistoryPayload('term_deposits', [
      {
        collection_date: '2026-04-19',
        bank_name: 'ANZ',
        product_name: 'ANZ Term Deposit',
        product_key: 'anz|td|12',
        product_id: 'td-12',
        term_months: 12,
        deposit_tier: '$0 to $10k',
        interest_payment: 'monthly',
        interest_rate: 4.55,
      },
    ])

    expect(payload.products[0]?.term_months).toBe(12)
    expect(payload.products[0]?.points).toEqual([[0, 4.55]])
  })
})
