import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertHistoricalWriteAllowed,
  HistoricalWriteContractError,
} from '../src/db/historical-write-guard'
import type { NormalizedRateRow } from '../src/ingest/normalize'
import type { NormalizedSavingsRow, NormalizedTdRow } from '../src/ingest/normalize-savings'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(__dirname, 'fixtures')

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), 'utf8')) as T
}

function validHomeLoanRow(): NormalizedRateRow {
  return {
    ...loadFixture<NormalizedRateRow>('real-normalized-home-loan-row.json'),
    bankName: 'ANZ',
    sourceUrl: 'https://api.anz/cds-au/v1/banking/products/anz-1',
    productUrl: 'https://www.anz.com.au/personal/home-loans/interest-rates/',
    runId: 'daily:test-run',
    runSource: 'scheduled',
    retrievalType: 'present_scrape_same_date',
    fetchEventId: 123,
  }
}

function validSavingsRow(): NormalizedSavingsRow {
  return {
    ...loadFixture<NormalizedSavingsRow>('real-normalized-savings-row.json'),
    bankName: 'ANZ',
    sourceUrl: 'https://api.anz/cds-au/v1/banking/products/sav-1',
    productUrl: 'https://www.anz.com.au/personal/bank-accounts/savings-accounts/',
    runId: 'daily:test-run',
    runSource: 'scheduled',
    retrievalType: 'present_scrape_same_date',
    fetchEventId: 456,
  }
}

function validTdRow(): NormalizedTdRow {
  return {
    ...loadFixture<NormalizedTdRow>('real-normalized-td-row.json'),
    bankName: 'ANZ',
    sourceUrl: 'https://api.anz/cds-au/v1/banking/products/td-1',
    productUrl: 'https://www.anz.com.au/personal/bank-accounts/term-deposits/',
    runId: 'daily:test-run',
    runSource: 'scheduled',
    retrievalType: 'present_scrape_same_date',
    fetchEventId: 789,
  }
}

describe('assertHistoricalWriteAllowed', () => {
  it('accepts a valid scheduled home-loan row with lineage', () => {
    expect(assertHistoricalWriteAllowed('home_loans', validHomeLoanRow()).lenderCode).toBe('anz')
  })

  it('allows manual historical rows without fetch-event lineage', () => {
    const row = { ...validHomeLoanRow(), runSource: 'manual' as const, retrievalType: 'historical_scrape' as const, fetchEventId: null }
    expect(assertHistoricalWriteAllowed('home_loans', row).lenderCode).toBe('anz')
  })

  it('blocks scheduled writes without fetch-event lineage', () => {
    const row = { ...validHomeLoanRow(), fetchEventId: null }
    expect(() => assertHistoricalWriteAllowed('home_loans', row)).toThrowError(HistoricalWriteContractError)
    expect(() => assertHistoricalWriteAllowed('home_loans', row)).toThrow('write_contract_violation:missing_fetch_event_lineage')
  })

  it('blocks writes whose source host does not match the lender provenance contract', () => {
    const row = { ...validHomeLoanRow(), sourceUrl: 'https://garbage.example.com/not-anz.json' }
    expect(() => assertHistoricalWriteAllowed('home_loans', row)).toThrow('write_contract_violation:source_url_host_mismatch')
  })

  it('blocks rows whose bank name does not map to a configured lender', () => {
    const row = { ...validHomeLoanRow(), bankName: 'Unknown Bank Name' }
    expect(() => assertHistoricalWriteAllowed('home_loans', row)).toThrow('write_contract_violation:unknown_lender_identity')
  })

  it('blocks home-loan rows below lender playbook confidence', () => {
    const row = { ...validHomeLoanRow(), confidenceScore: 0.8 }
    expect(() => assertHistoricalWriteAllowed('home_loans', row)).toThrow('write_contract_violation:confidence_below_write_contract')
  })

  it('blocks home-loan rows outside the lender playbook rate range', () => {
    const row = { ...validHomeLoanRow(), interestRate: 24 }
    expect(() => assertHistoricalWriteAllowed('home_loans', row)).toThrow('write_contract_violation:interest_rate_outside_lender_playbook')
  })

  it('blocks CDR payloads whose product id does not match the row identity', () => {
    const row = {
      ...validHomeLoanRow(),
      bankName: 'Westpac',
      sourceUrl: 'https://digital-api.westpac.com.au/cds-au/v1/banking/products/HLVariableOffsetOwnerOccupied',
      productUrl: 'https://www.westpac.com.au/personal-banking/home-loans/variable/variable-loan-with-offset/',
      productId: 'wrong-product-id',
      cdrProductDetailJson: readFileSync(resolve(FIXTURES_DIR, 'real-westpac-mortgage-detail.json'), 'utf8'),
    }
    expect(() => assertHistoricalWriteAllowed('home_loans', row)).toThrow('write_contract_violation:cdr_detail_product_id_mismatch')
  })

  it('accepts valid savings and term-deposit rows with lineage', () => {
    expect(assertHistoricalWriteAllowed('savings', validSavingsRow()).lenderCode).toBe('anz')
    expect(assertHistoricalWriteAllowed('term_deposits', validTdRow()).lenderCode).toBe('anz')
  })
})
