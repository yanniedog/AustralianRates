import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
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

  it('accepts unusually high savings rates for anomaly review', () => {
    const row = loadRealSavingsFixture()
    const verdict = validateNormalizedSavingsRow({ ...row, interestRate: 20 })
    expect(verdict.ok).toBe(true)
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
})
