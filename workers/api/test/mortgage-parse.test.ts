import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRatesFromDetail } from '../src/ingest/cdr/mortgage-parse'
import type { JsonRecord } from '../src/ingest/cdr/primitives'
import type { LenderConfig } from '../src/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(__dirname, 'fixtures')

const WESTPAC_LENDER: LenderConfig = {
  code: 'westpac',
  name: 'Westpac',
  canonical_bank_name: 'Westpac Banking Corporation',
  register_brand_name: 'Westpac',
  products_endpoint: 'https://digital-api.westpac.com.au/cds-au/v1/banking/products',
  seed_rate_urls: [],
}

const ANZ_LENDER: LenderConfig = {
  code: 'anz',
  name: 'ANZ',
  canonical_bank_name: 'ANZ',
  register_brand_name: 'ANZ',
  products_endpoint: 'https://api.anz/cds-au/v1/banking/products',
  seed_rate_urls: [],
}

// Real CDR detail excerpt captured from ANZ on 2026-03-09.
const ANZ_SIMPLICITY_PLUS_DETAIL: JsonRecord = {
  productId: '544ad5cb-7e52-4a30-b1d7-a080abafbfac',
  productCategory: 'RESIDENTIAL_MORTGAGES',
  name: 'ANZ Simplicity PLUS',
  description: 'A residential mortgage product offered by ANZ.',
  lendingRates: [
    {
      additionalInfo: 'Principal and interest, owner occupier',
      additionalInfoUri: 'https://www.anz.com.au/personal/home-loans/your-loan/interest-rates/?CID=af:obank:hl',
      applicationFrequency: 'P1M',
      applicationType: 'PERIODIC',
      calculationFrequency: 'P1D',
      comparisonRate: '0.0749',
      interestPaymentDue: 'IN_ARREARS',
      lendingRateType: 'VARIABLE',
      loanPurpose: 'OWNER_OCCUPIED',
      rate: '0.0749',
      repaymentType: 'PRINCIPAL_AND_INTEREST',
      tiers: [
        {
          additionalInfo: 'Eligibility criteria apply to special offer discount rates including $50,000 or more in new or additional ANZ lending.',
          maximumValue: '49999.99',
          minimumValue: '0.00',
          name: 'Loan Amount',
          rateApplicationMethod: 'WHOLE_BALANCE',
          unitOfMeasure: 'DOLLAR',
        },
      ],
    },
  ],
}

function loadRealWestpacMortgageDetail(): JsonRecord {
  const path = resolve(FIXTURES_DIR, 'real-westpac-mortgage-detail.json')
  return JSON.parse(readFileSync(path, 'utf8')) as JsonRecord
}

describe('mortgage detail parsing', () => {
  it('keeps valid CDR rates even when LVR text is present in structured detail metadata', () => {
    const detail = loadRealWestpacMortgageDetail()
    const rows = parseRatesFromDetail({
      lender: WESTPAC_LENDER,
      detail,
      sourceUrl: 'https://digital-api.westpac.com.au/cds-au/v1/banking/products/HLVariableOffsetOwnerOccupied',
      collectionDate: '2026-03-09',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        productId: 'HLVariableOffsetOwnerOccupied',
        productName: 'Rocket Loan : Variable Home Loan with Offset (Owner Occupied)',
        securityPurpose: 'owner_occupied',
        repaymentType: 'principal_and_interest',
        rateStructure: 'variable',
        lvrTier: 'lvr_60-70%',
        interestRate: 5.89,
        comparisonRate: 6.27,
        annualFee: 395,
        featureSet: 'premium',
      }),
    )
  })

  it('accepts residential mortgage products whose names do not contain generic loan keywords', () => {
    const rows = parseRatesFromDetail({
      lender: ANZ_LENDER,
      detail: ANZ_SIMPLICITY_PLUS_DETAIL,
      sourceUrl: 'https://api.anz/cds-au/v1/banking/products/544ad5cb-7e52-4a30-b1d7-a080abafbfac',
      collectionDate: '2026-03-09',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        productId: '544ad5cb-7e52-4a30-b1d7-a080abafbfac',
        productName: 'ANZ Simplicity PLUS',
        securityPurpose: 'owner_occupied',
        repaymentType: 'principal_and_interest',
        rateStructure: 'variable',
        interestRate: 7.49,
        comparisonRate: 7.49,
      }),
    )
  })
})
