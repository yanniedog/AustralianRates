import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  normalizeAccountType,
  validateNormalizedSavingsRow,
  validateNormalizedTdRow,
  type NormalizedSavingsRow,
  type NormalizedTdRow,
} from '../src/ingest/normalize-savings'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(__dirname, 'fixtures')

function loadRealSavingsFixture(): NormalizedSavingsRow {
  const path = resolve(FIXTURES_DIR, 'real-normalized-savings-row.json')
  return JSON.parse(readFileSync(path, 'utf8')) as NormalizedSavingsRow
}

function loadRealTdFixture(): NormalizedTdRow {
  const path = resolve(FIXTURES_DIR, 'real-normalized-td-row.json')
  return JSON.parse(readFileSync(path, 'utf8')) as NormalizedTdRow
}

function cdrDetailJson(
  productCategory: string,
  name: string,
  productId = 'test-product-id',
  shape: 'dataProductCategory' | 'rootProductCategory' | 'rootCategory' | 'rootType' = 'dataProductCategory',
): string {
  if (shape === 'rootProductCategory') {
    return JSON.stringify({ productId, name, productCategory })
  }
  if (shape === 'rootCategory') {
    return JSON.stringify({ productId, name, category: productCategory })
  }
  if (shape === 'rootType') {
    return JSON.stringify({ productId, name, type: productCategory })
  }
  return JSON.stringify({
    data: {
      productId,
      name,
      productCategory,
    },
  })
}

describe('normalizeAccountType', () => {
  it('classifies everyday savings products as savings, not transaction', () => {
    expect(normalizeAccountType('HSBC Everyday Savings Account')).toBe('savings')
    expect(normalizeAccountType('Everyday Saver')).toBe('savings')
    expect(normalizeAccountType('Everyday Save Account')).toBe('savings')
  })

  it('still classifies everyday spend/transaction products as transaction', () => {
    expect(normalizeAccountType('Everyday Account')).toBe('transaction')
    expect(normalizeAccountType('CommBank Smart Access everyday account')).toBe('transaction')
  })

  it('classifies at-call wording before other heuristics', () => {
    expect(normalizeAccountType('At call deposit')).toBe('at_call')
  })
})

describe('validateNormalizedSavingsRow', () => {
  it('accepts a valid savings row from real-data fixture', () => {
    const verdict = validateNormalizedSavingsRow(loadRealSavingsFixture())
    expect(verdict.ok).toBe(true)
  })

  it('rejects invalid collection_date', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({ ...row, collectionDate: 'bad' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_collection_date')
  })

  it('rejects invalid data_quality_flag', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({ ...row, dataQualityFlag: 'unknown' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_data_quality_flag')
  })

  it('rejects implausibly high savings rates', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({ ...row, interestRate: 20 })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('interest_rate_out_of_bounds')
  })

  it('rejects invalid account_type', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({ ...row, accountType: 'invalid' as 'savings' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_account_type')
  })

  it('rejects empty deposit_tier', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({ ...row, depositTier: '  ' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_deposit_tier')
  })

  it('accepts optional product_url and published_at', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({
      ...row,
      productUrl: 'https://example.com/savings-product',
      publishedAt: '2026-02-25T06:17:08.000Z',
    })
    expect(verdict.ok).toBe(true)
  })

  it('rejects invalid optional product_url', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({ ...row, productUrl: 'not-a-url' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_product_url')
  })

  it('rejects savings rows that do not look like savings products', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({ ...row, productName: 'Privacy disclaimer text' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_product_name_semantics')
  })

  it('accepts legitimate saver product names from live CDR catalogs', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({ ...row, productName: 'Youth eSaver' })
    expect(verdict.ok).toBe(true)
  })

  it('accepts legitimate save product names from live AMP CDR catalogs', () => {
    const row = loadRealSavingsFixture()
    expect(validateNormalizedSavingsRow({ ...row, productName: 'AMP Bank GO Save' }).ok).toBe(true)
    expect(validateNormalizedSavingsRow({ ...row, productName: 'AMP Bank GO Business Save' }).ok).toBe(true)
  })

  it.each([
    ['data.productCategory', cdrDetailJson('TRANS_AND_SAVINGS_ACCOUNTS', 'Westpac Choice')],
    ['root productCategory', cdrDetailJson('TRANS_AND_SAVINGS_ACCOUNTS', 'Westpac Choice', 'test-product-id', 'rootProductCategory')],
    ['root category', cdrDetailJson('TRANS_AND_SAVINGS_ACCOUNTS', 'Westpac Choice', 'test-product-id', 'rootCategory')],
    ['root type', cdrDetailJson('TRANS_AND_SAVINGS_ACCOUNTS', 'Westpac Choice', 'test-product-id', 'rootType')],
  ])('accepts live CDR savings products whose names do not include savings keywords from %s payloads', (_label, detailJson) => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({
      ...row,
      productName: 'Westpac Choice',
      cdrProductDetailJson: detailJson,
    })
    expect(verdict.ok).toBe(true)
  })

  it('rejects non-CDR savings rows with CDR-like category metadata when the quality flag is not CDR-gated', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({
      ...row,
      productName: 'Westpac Choice',
      cdrProductDetailJson: cdrDetailJson('TRANS_AND_SAVINGS_ACCOUNTS', 'Westpac Choice'),
      dataQualityFlag: 'legacy_import',
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_product_name_semantics')
  })

  it('rejects cdr savings rows when cdr detail category indicates a different dataset', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({
      ...row,
      productName: 'ANZ Plus',
      cdrProductDetailJson: cdrDetailJson('TERM_DEPOSITS', 'ANZ Plus'),
      dataQualityFlag: 'cdr_live',
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('cdr_category_mismatch_savings')
  })

  it('rejects blocked savings names even when CDR category metadata matches', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({
      ...row,
      productName: 'Privacy disclaimer text',
      cdrProductDetailJson: cdrDetailJson('TRANS_AND_SAVINGS_ACCOUNTS', 'Privacy disclaimer text'),
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_product_name_semantics')
  })

  it('rejects savings rows below the minimum confidence for the quality flag', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({ ...row, confidenceScore: 0.6 })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('confidence_below_required_threshold')
  })
})

describe('validateNormalizedTdRow', () => {
  it('accepts a valid TD row from real-data fixture', () => {
    const verdict = validateNormalizedTdRow(loadRealTdFixture())
    expect(verdict.ok).toBe(true)
  })

  it('accepts long term deposits beyond the old 120-month cap', () => {
    const row = loadRealTdFixture()
    const verdict = validateNormalizedTdRow({ ...row, termMonths: 240 })
    expect(verdict.ok).toBe(true)
  })

  it('rejects invalid interest_payment enum', () => {
    const row = loadRealTdFixture()
    const verdict = validateNormalizedTdRow({ ...row, interestPayment: 'invalid' as 'at_maturity' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_interest_payment')
  })

  it('rejects invalid source_url', () => {
    const row = loadRealTdFixture()
    const verdict = validateNormalizedTdRow({ ...row, sourceUrl: 'not-a-url' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_source_url')
  })

  it('rejects invalid optional published_at', () => {
    const row = loadRealTdFixture()
    const verdict = validateNormalizedTdRow({ ...row, publishedAt: 'not-a-date' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_published_at')
  })

  it('rejects TD rows that do not look like term-deposit products', () => {
    const row = loadRealTdFixture()
    const verdict = validateNormalizedTdRow({ ...row, productName: 'Privacy disclaimer text' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_product_name_semantics')
  })

  it.each([
    ['data.productCategory', cdrDetailJson('TERM_DEPOSITS', 'Business Investment Account')],
    ['root productCategory', cdrDetailJson('TERM_DEPOSITS', 'Business Investment Account', 'test-product-id', 'rootProductCategory')],
    ['root category', cdrDetailJson('TERM_DEPOSITS', 'Business Investment Account', 'test-product-id', 'rootCategory')],
    ['root type', cdrDetailJson('TERM_DEPOSITS', 'Business Investment Account', 'test-product-id', 'rootType')],
  ])('accepts live CDR term deposits whose names do not include term keywords from %s payloads', (_label, detailJson) => {
    const row = loadRealTdFixture()
    const verdict = validateNormalizedTdRow({
      ...row,
      productName: 'Business Investment Account',
      cdrProductDetailJson: detailJson,
    })
    expect(verdict.ok).toBe(true)
  })

  it('rejects blocked TD names even when CDR category metadata matches', () => {
    const row = loadRealTdFixture()
    const verdict = validateNormalizedTdRow({
      ...row,
      productName: 'Privacy disclaimer text',
      cdrProductDetailJson: cdrDetailJson('TERM_DEPOSITS', 'Privacy disclaimer text'),
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_product_name_semantics')
  })

  it('rejects cdr term-deposit rows when cdr detail category indicates a different dataset', () => {
    const row = loadRealTdFixture()
    const verdict = validateNormalizedTdRow({
      ...row,
      productName: 'Business Investment Account',
      cdrProductDetailJson: cdrDetailJson('TRANS_AND_SAVINGS_ACCOUNTS', 'Business Investment Account'),
      dataQualityFlag: 'cdr_live',
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('cdr_category_mismatch_term_deposits')
  })

  it('rejects TD rows below the minimum confidence for the quality flag', () => {
    const row = loadRealTdFixture()
    const verdict = validateNormalizedTdRow({ ...row, confidenceScore: 0.6 })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('confidence_below_required_threshold')
  })
})
