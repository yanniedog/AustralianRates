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

const GREAT_SOUTHERN_LENDER: LenderConfig = {
  code: 'great_southern',
  name: 'Great Southern Bank',
  canonical_bank_name: 'Great Southern Bank',
  register_brand_name: 'Great Southern Bank',
  products_endpoint: 'https://api.open-banking.greatsouthernbank.com.au/cds-au/v1/banking/products',
  seed_rate_urls: [],
}

const CBA_LENDER: LenderConfig = {
  code: 'cba',
  name: 'Commonwealth Bank of Australia',
  canonical_bank_name: 'Commonwealth Bank of Australia',
  register_brand_name: 'CommBank',
  products_endpoint: 'https://api.commbank.com.au/public/cds-au/v1/banking/products',
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

// Real CDR detail excerpt captured from ANZ on 2026-03-30.
const ANZ_FIXED_RATE_DETAIL: JsonRecord = {
  productId: '3a86f9e4-1b41-4222-9091-5934d1fc9178',
  productCategory: 'RESIDENTIAL_MORTGAGES',
  name: 'ANZ Fixed Rate home loan',
  description: 'Our fixed rate home loan gives you the certainty of knowing what your repayments will be during the fixed period.',
  lendingRates: [
    {
      additionalInfo: 'Fixed for 1 year, principal and interest, owner occupied, index rate.',
      additionalValue: 'P1Y',
      applicationFrequency: 'P1M',
      applicationType: 'PERIODIC',
      calculationFrequency: 'P1D',
      comparisonRate: '0.0818',
      interestPaymentDue: 'IN_ARREARS',
      lendingRateType: 'FIXED',
      loanPurpose: 'OWNER_OCCUPIED',
      rate: '0.0644',
      repaymentType: 'PRINCIPAL_AND_INTEREST',
      tiers: [],
    },
    {
      additionalInfo: 'Fixed for 1 year, principal and interest, owner occupied, LVR > 80%',
      additionalValue: 'P1Y',
      applicationFrequency: 'P1M',
      applicationType: 'PERIODIC',
      calculationFrequency: 'P1D',
      comparisonRate: '0.0764',
      interestPaymentDue: 'IN_ARREARS',
      lendingRateType: 'FIXED',
      loanPurpose: 'OWNER_OCCUPIED',
      rate: '0.0649',
      repaymentType: 'PRINCIPAL_AND_INTEREST',
      tiers: [
        {
          additionalInfo: 'Borrowing over 80% of the property value',
          minimumValue: '0.8001',
          name: 'Loan-to-Value Ratio (LVR)',
          rateApplicationMethod: 'WHOLE_BALANCE',
          unitOfMeasure: 'PERCENT',
        },
      ],
    },
  ],
}

// Real-shape Great Southern CDR excerpt seen in production on 2026-03-09.
const GREAT_SOUTHERN_DETAIL: JsonRecord = {
  productId: '4200-0211',
  productCategory: 'RESIDENTIAL_MORTGAGES',
  name: 'Basic Home Loan',
  description: 'Residential mortgage product.',
  lendingRates: [
    {
      lendingRateType: 'VARIABLE',
      rate: '0.075',
      comparisonRate: '0.056',
      loanPurpose: 'OWNER_OCCUPIED',
      repaymentType: 'PRINCIPAL_AND_INTEREST',
      additionalInfo: 'Principal and interest or construction interest only repayments.',
    },
    {
      lendingRateType: 'DISCOUNT',
      rate: '0.0196',
      comparisonRate: null,
      loanPurpose: 'OWNER_OCCUPIED',
      repaymentType: 'PRINCIPAL_AND_INTEREST',
      additionalInfo: 'Discount off standard variable rate.',
    },
  ],
}

const WESTPAC_SUSTAINABLE_DETAIL: JsonRecord = {
  productId: 'HLSustainableUpgradesOwnersOccupied',
  productCategory: 'RESIDENTIAL_MORTGAGES',
  name: 'Sustainable Upgrades Home Loan',
  description: 'Basic variable rate loan for eligible sustainable upgrade lending.',
  applicationUri: 'https://www.westpac.com.au/personal-banking/home-loans/sustainable-upgrades-home-loan/',
  lendingRates: [
    {
      lendingRateType: 'VARIABLE',
      rate: '0.0399',
      comparisonRate: '0.0399',
      loanPurpose: 'OWNER_OCCUPIED',
      repaymentType: 'PRINCIPAL_AND_INTEREST',
      additionalInfo: 'Eligible sustainable upgrades home loan.',
    },
  ],
}

// Real CDR detail excerpt captured from HSBC on 2026-03-30.
const HSBC_HOME_EQUITY_PACKAGE_DETAIL: JsonRecord = {
  productId: 'HOME EQUITY P',
  productCategory: 'RESIDENTIAL_MORTGAGES',
  name: 'Home Equity (Package)',
  description: 'Line of Credit loan',
  constraints: [
    { constraintType: 'MIN_LVR', additionalValue: '0.0001' },
    { constraintType: 'MAX_LVR', additionalValue: '0.80' },
  ],
  lendingRates: [
    {
      lendingRateType: 'VARIABLE',
      rate: '0.0687',
      calculationFrequency: 'P1D',
      applicationFrequency: 'P1M',
      interestPaymentDue: 'IN_ARREARS',
      repaymentType: 'INTEREST_ONLY',
      loanPurpose: 'OWNER_OCCUPIED',
      tiers: [
        {
          name: 'LVR',
          unitOfMeasure: 'PERCENT',
          minimumValue: '0.0001',
          maximumValue: '0.8',
          rateApplicationMethod: 'WHOLE_BALANCE',
          additionalInfo: 'OO Package Home Equity IO (LVR<=80%)',
        },
      ],
      additionalInfo: 'OO Package Home Equity IO (LVR<=80%)',
      applicationType: 'PERIODIC',
    },
  ],
}

// Real CDR detail excerpt captured from CBA anomaly diagnostics on 2026-03-30.
const CBA_FIXED_OWNER_OCCUPIED_DETAIL_WITHOUT_LVR: JsonRecord = {
  productId: 'fd78e9e7382848d4b5e4386febef30a7',
  productCategory: 'RESIDENTIAL_MORTGAGES',
  name: '4 Year Fixed Rate Home Loan (Owner Occupied)',
  description: 'An owner occupied home loan where the interest rate is fixed for 4 years.',
  constraints: [
    {
      constraintType: 'OPENING_BALANCE',
      additionalValue: '10000.00',
      additionalInfo: 'For a Fixed Rate Loan, there is a minimum loan amount of $10,000 for new loans.',
    },
  ],
  lendingRates: [
    {
      lendingRateType: 'FIXED',
      rate: '0.0664',
      comparisonRate: '0.0775',
      repaymentType: 'PRINCIPAL_AND_INTEREST',
      loanPurpose: 'OWNER_OCCUPIED',
      additionalValue: 'P4Y',
      additionalInfo: 'Owner Occupied with Principal and Interest repayment type with Package',
      tiers: [
        {
          name: 'BALANCE',
          unitOfMeasure: 'DOLLAR',
          minimumValue: 10000,
          maximumValue: 99999999,
          rateApplicationMethod: 'WHOLE_BALANCE',
        },
      ],
    },
    {
      lendingRateType: 'FIXED',
      rate: '0.0709',
      comparisonRate: '0.0791',
      repaymentType: 'INTEREST_ONLY',
      loanPurpose: 'OWNER_OCCUPIED',
      additionalValue: 'P4Y',
      additionalInfo: 'Owner Occupied - Interest Only payment type with Package',
      tiers: [
        {
          name: 'BALANCE',
          unitOfMeasure: 'DOLLAR',
          minimumValue: 10000,
          maximumValue: 99999999,
          rateApplicationMethod: 'WHOLE_BALANCE',
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

  it('prefers structured repayment type over freeform eligibility text and drops discount rows', () => {
    const rows = parseRatesFromDetail({
      lender: GREAT_SOUTHERN_LENDER,
      detail: GREAT_SOUTHERN_DETAIL,
      sourceUrl: 'https://api.open-banking.greatsouthernbank.com.au/cds-au/v1/banking/products/4200-0211',
      collectionDate: '2026-03-09',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        productId: '4200-0211',
        repaymentType: 'principal_and_interest',
        rateStructure: 'variable',
        interestRate: 7.5,
        comparisonRate: 5.6,
      }),
    )
  })

  it('stores single-rate CDR products without explicit LVR tiers as lvr_unspecified', () => {
    const rows = parseRatesFromDetail({
      lender: WESTPAC_LENDER,
      detail: WESTPAC_SUSTAINABLE_DETAIL,
      sourceUrl: 'https://digital-api.westpac.com.au/cds-au/v1/banking/products/HLSustainableUpgradesOwnersOccupied',
      collectionDate: '2026-03-29',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        productId: 'HLSustainableUpgradesOwnersOccupied',
        productName: 'Sustainable Upgrades Home Loan',
        interestRate: 3.99,
        comparisonRate: 3.99,
        confidenceScore: 0.95,
        lvrTier: 'lvr_unspecified',
      }),
    )
  })

  it('infers the base <=80% tier from sibling ANZ rates with explicit >80% variants', () => {
    const rows = parseRatesFromDetail({
      lender: ANZ_LENDER,
      detail: ANZ_FIXED_RATE_DETAIL,
      sourceUrl: 'https://api.anz/cds-au/v1/banking/products/3a86f9e4-1b41-4222-9091-5934d1fc9178',
      collectionDate: '2026-03-30',
    })

    const baseRow = rows.find((row) => row.interestRate === 6.44 && row.repaymentType === 'principal_and_interest')
    expect(baseRow).toEqual(
      expect.objectContaining({
        productId: '3a86f9e4-1b41-4222-9091-5934d1fc9178',
        lvrTier: 'lvr_70-80%',
        confidenceScore: 0.95,
      }),
    )
  })

  it('keeps strong structured HSBC line-of-credit mortgage rows above the write contract without comparison rates', () => {
    const rows = parseRatesFromDetail({
      lender: {
        code: 'hsbc',
        name: 'HSBC',
        canonical_bank_name: 'HSBC Australia',
        register_brand_name: 'HSBC',
        products_endpoint: 'https://public.ob.hsbc.com.au/cds-au/v1/banking/products',
        seed_rate_urls: [],
      },
      detail: HSBC_HOME_EQUITY_PACKAGE_DETAIL,
      sourceUrl: 'https://public.ob.hsbc.com.au/cds-au/v1/banking/products/HOME%20EQUITY%20P',
      collectionDate: '2026-03-30',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        productId: 'HOME EQUITY P',
        lvrTier: 'lvr_70-80%',
        comparisonRate: null,
        confidenceScore: 0.93,
      }),
    )
  })

  it('stores absent CBA fixed-rate LVR as lvr_unspecified instead of guessing a band', () => {
    const rows = parseRatesFromDetail({
      lender: CBA_LENDER,
      detail: CBA_FIXED_OWNER_OCCUPIED_DETAIL_WITHOUT_LVR,
      sourceUrl: 'https://api.commbank.com.au/public/cds-au/v1/banking/products/fd78e9e7382848d4b5e4386febef30a7',
      collectionDate: '2026-03-30',
    })

    const principalAndInterest = rows.find(
      (row) =>
        row.productId === 'fd78e9e7382848d4b5e4386febef30a7' &&
        row.repaymentType === 'principal_and_interest' &&
        row.rateStructure === 'fixed_4yr',
    )

    expect(principalAndInterest).toEqual(
      expect.objectContaining({
        lvrTier: 'lvr_unspecified',
        confidenceScore: 0.95,
        interestRate: 6.64,
        comparisonRate: 7.75,
      }),
    )
  })
})
