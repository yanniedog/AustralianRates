import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseTermDepositRatesFromDetail } from '../src/ingest/cdr-savings'
import type { LenderConfig } from '../src/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(__dirname, 'fixtures')

function loadRealCbaFarmManagementDetail(): Record<string, unknown> {
  const path = resolve(FIXTURES_DIR, 'real-cba-farm-management-td-detail.json')
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

const CBA_LENDER: LenderConfig = {
  code: 'cba',
  name: 'CBA',
  canonical_bank_name: 'Commonwealth Bank of Australia',
  register_brand_name: 'Commonwealth Bank of Australia',
  seed_rate_urls: [],
  products_endpoint: 'https://api.commbank.com.au/public/cds-au/v1/banking/products',
}

describe('parseTermDepositRatesFromDetail', () => {
  it('keeps short fixed terms at maturity when the payment interval is not shorter than the term', () => {
    const fixture = loadRealCbaFarmManagementDetail()
    const rows = parseTermDepositRatesFromDetail({
      lender: CBA_LENDER,
      detail: fixture.data as Record<string, unknown>,
      sourceUrl: 'https://api.commbank.com.au/public/cds-au/v1/banking/products/f889dd909d1d44858a2f2ad839dcda89',
      collectionDate: '2026-03-09',
    })

    expect(rows.find((row) => row.termMonths === 3)?.interestPayment).toBe('at_maturity')
    expect(rows.find((row) => row.termMonths === 6)?.interestPayment).toBe('at_maturity')
    expect(rows.find((row) => row.termMonths === 13)?.interestPayment).toBe('annually')
    expect(rows.find((row) => row.termMonths === 24)?.interestPayment).toBe('monthly')
  })
})
