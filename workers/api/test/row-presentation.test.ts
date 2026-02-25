import { describe, expect, it } from 'vitest'
import {
  cleanConditionsText,
  presentHomeLoanRow,
  presentSavingsRow,
  presentTdRow,
} from '../src/utils/row-presentation'

describe('row presentation', () => {
  it('canonicalizes legacy retrieval_type values to present scrape', () => {
    const row = presentHomeLoanRow({
      retrieval_type: 'cdr_live',
      data_quality_flag: 'cdr_live',
      source_url: 'https://api.bank.example/products',
    })

    expect(row.retrieval_type).toBe('cdr_live')
    expect(row.retrieval_type_canonical).toBe('present_scrape_same_date')
    expect(row.retrieval_type_display).toBe('Present scrape (same date)')
  })

  it('treats wayback rows as historical regardless of retrieval_type value', () => {
    const row = presentSavingsRow({
      retrieval_type: 'cdr_live',
      data_quality_flag: 'ok',
      source_url: 'https://web.archive.org/web/20200101000000/https://example.com',
    })

    expect(row.retrieval_type_canonical).toBe('historical_scrape')
    expect(row.retrieval_type_display).toBe('Historical scrape')
  })

  it('maps mortgage enum values to readable display labels', () => {
    const row = presentHomeLoanRow({
      security_purpose: 'owner_occupied',
      repayment_type: 'principal_and_interest',
      rate_structure: 'fixed_1yr',
      lvr_tier: 'lvr_=60%',
      feature_set: 'premium',
    })

    expect(row.security_purpose_display).toBe('Owner occupied')
    expect(row.repayment_type_display).toBe('Principal & Interest')
    expect(row.rate_structure_display).toBe('Fixed 1 year')
    expect(row.lvr_tier_display).toBe('<=60%')
    expect(row.feature_set_display).toBe('Premium')
  })

  it('normalizes savings and td deposit tier display formatting', () => {
    const savings = presentSavingsRow({
      deposit_tier: '$50k-$100.0k',
      min_balance: null,
      max_balance: null,
    })
    const td = presentTdRow({
      deposit_tier: '$100k-$250.0k',
      min_deposit: 100000,
      max_deposit: 250000,
    })

    expect(savings.deposit_tier_display).toBe('$50k to $100k')
    expect(td.deposit_tier_display).toBe('$100k to $250k')
  })

  it('cleans conditions by removing machine fragments and duplicates', () => {
    const cleaned = cleanConditionsText('PT3M | Bonus when you deposit monthly | Bonus when you deposit monthly | ')
    expect(cleaned).toBe('Bonus when you deposit monthly')
  })
})
