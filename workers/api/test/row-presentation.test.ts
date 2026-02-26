import { describe, expect, it } from 'vitest'
import {
  cleanConditionsText,
  presentCoreRowFields,
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

  it('derives core row fields without source_url fallback and with retrieved_at alias', () => {
    const row = presentCoreRowFields({
      source_url: 'https://example.com/rates',
      parsed_at: '2026-02-25 06:17:08',
      published_at: '',
    })

    expect(row.product_url).toBe('')
    expect(row.retrieved_at).toBe('2026-02-25 06:17:08')
    expect(row.published_at).toBe('')
  })

  it('derives published_at from wayback snapshot timestamp when missing', () => {
    const row = presentCoreRowFields({
      source_url: 'https://web.archive.org/web/20200102030405/https://example.com/rates',
      published_at: null,
      parsed_at: '2026-02-25 06:17:08',
    })

    expect(row.published_at).toBe('2020-01-02T03:04:05Z')
  })

  it('normalizes provider published_at to ISO UTC when present', () => {
    const row = presentCoreRowFields({
      source_url: 'https://example.com/rates',
      product_url: 'https://example.com/product',
      published_at: '2026-02-25T17:30:45+11:00',
      parsed_at: '2026-02-25 06:17:08',
    })

    expect(row.product_url).toBe('https://example.com/product')
    expect(row.published_at).toBe('2026-02-25T06:30:45.000Z')
  })
})
