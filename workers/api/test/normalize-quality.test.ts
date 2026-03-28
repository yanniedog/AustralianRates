import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  parseComparisonRate,
  parseInterestRate,
  validateNormalizedRow,
  type NormalizedRateRow,
} from '../src/ingest/normalize'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(__dirname, 'fixtures')

function loadRealHomeLoanFixture(): NormalizedRateRow {
  const path = resolve(FIXTURES_DIR, 'real-normalized-home-loan-row.json')
  return JSON.parse(readFileSync(path, 'utf8')) as NormalizedRateRow
}

describe('strict numeric parsing', () => {
  it('parses CDR decimal fractions as percentages', () => {
    expect(parseInterestRate('0.0594')).toBe(5.94)
    expect(parseComparisonRate(0.061)).toBe(6.1)
  })

  it('rejects ambiguous parsing and implausibly high rates', () => {
    expect(parseInterestRate('LVR 80 to 90%')).toBeNull()
    expect(parseInterestRate('80%')).toBeNull()
    expect(parseComparisonRate('1.20% and 1.40%')).toBeNull()
  })
})

describe('row validation', () => {
  it('accepts a valid home loan row from real-data fixture', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow(row)
    expect(verdict.ok).toBe(true)
  })

  it('rejects weak product names that look like page chrome instead of products', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, productName: 'Tooltip disclaimer text' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_product_name_semantics')
  })

  it('rejects invalid collection_date', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, collectionDate: 'not-a-date' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_collection_date')
  })

  it('rejects invalid source_url', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, sourceUrl: 'not-a-url' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_source_url')
  })

  it('accepts valid optional product_url and published_at', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({
      ...row,
      productUrl: 'https://example.com/product',
      publishedAt: '2026-02-25T06:17:08.000Z',
    })
    expect(verdict.ok).toBe(true)
  })

  it('rejects invalid optional product_url', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, productUrl: 'not-a-url' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_product_url')
  })

  it('rejects invalid optional published_at', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, publishedAt: 'not-a-date' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_published_at')
  })

  it('rejects invalid data_quality_flag', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, dataQualityFlag: 'unknown_flag' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_data_quality_flag')
  })

  it('rejects invalid run_source', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, runSource: 'invalid' as 'scheduled' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_run_source')
  })

  it('rejects implausibly high home-loan rates', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, interestRate: 100 })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('interest_rate_out_of_bounds')
  })

  it('rejects anomalous comparison-rate gaps', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, interestRate: 5, comparisonRate: 20 })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('comparison_rate_gap_out_of_bounds')
  })

  it('rejects confidence below the minimum for the quality flag', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, confidenceScore: 0.7 })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('confidence_below_required_threshold')
  })

  it('rejects empty bank_name', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, bankName: '  ' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('invalid_bank_name')
  })

  it('rejects missing product_id', () => {
    const row = loadRealHomeLoanFixture()
    const verdict = validateNormalizedRow({ ...row, productId: '' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('missing_product_id')
  })
})
