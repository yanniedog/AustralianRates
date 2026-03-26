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
  register_brand_name: 'CommBank',
  seed_rate_urls: [],
  products_endpoint: 'https://api.commbank.com.au/public/cds-au/v1/banking/products',
}

const WESTPAC_LENDER: LenderConfig = {
  code: 'westpac',
  name: 'Westpac',
  canonical_bank_name: 'Westpac Banking Corporation',
  register_brand_name: 'Westpac',
  seed_rate_urls: [],
  products_endpoint: 'https://digital-api.westpac.com.au/cds-au/v1/banking/products',
}

// Real-shape Westpac term-deposit excerpt seen in production on 2026-03-21.
const WESTPAC_TD_DETAIL = {
  productId: 'TDTermDeposit',
  productCategory: 'TERM_DEPOSIT',
  name: 'Westpac Term Deposit',
  depositRates: [
    {
      rate: '0.0395',
      additionalValue: 'P12M',
      applicationType: 'MATURITY',
      additionalInfo: 'Interest paid at maturity.',
    },
    {
      rate: '0.001',
      additionalValue: 'P12M',
      applicationType: 'MATURITY',
      rateApplicabilityType: 'ONLINE_ONLY',
      additionalInfo: 'PLUS, an additional 0.10% p.a. online bonus applies when opened online.',
    },
  ],
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

  it('drops standalone online bonus rows so only the real td rate is stored', () => {
    const rows = parseTermDepositRatesFromDetail({
      lender: WESTPAC_LENDER,
      detail: WESTPAC_TD_DETAIL,
      sourceUrl: 'https://digital-api.westpac.com.au/cds-au/v1/banking/products/TDTermDeposit',
      collectionDate: '2026-03-21',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        productId: 'TDTermDeposit',
        termMonths: 12,
        interestRate: 3.95,
        interestPayment: 'at_maturity',
      }),
    )
  })
})
