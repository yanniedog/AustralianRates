import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAmpMortgageVariables } from '../src/ingest/amp-mortgage-variables'
import type { LenderConfig } from '../src/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(__dirname, 'fixtures')

const AMP_LENDER: LenderConfig = {
  code: 'amp',
  name: 'AMP',
  canonical_bank_name: 'AMP Bank',
  register_brand_name: 'AMP',
  seed_rate_urls: ['https://www.amp.com.au/home-loans/interest-rates-fees'],
}

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), 'utf8'))
}

describe('AMP mortgage variable parsing', () => {
  it('parses structured AMP mortgage variables into deduped normalized rows', () => {
    const parsed = parseAmpMortgageVariables({
      lender: AMP_LENDER,
      payload: loadFixture('real-amp-mortgage-variables.json'),
      sourceUrl: AMP_LENDER.seed_rate_urls[0],
      collectionDate: '2026-03-09',
      qualityFlag: 'scraped_fallback_strict',
    })

    expect(parsed.rows).toHaveLength(8)
    expect(parsed.inspected).toBe(9)
    expect(parsed.deduped).toBe(1)

    expect(parsed.rows).toContainEqual(
      expect.objectContaining({
        productId: 'amp-variable-essential_gteq_250k_lt_750k_gt50_to_lteg60_lvr_oo_p_i',
        productName: 'AMP Essential Home Loan - $250,000 to <$750,000',
        securityPurpose: 'owner_occupied',
        repaymentType: 'principal_and_interest',
        rateStructure: 'variable',
        lvrTier: 'lvr_=60%',
        interestRate: 5.84,
        comparisonRate: 5.87,
      }),
    )
    expect(parsed.rows).toContainEqual(
      expect.objectContaining({
        productName: 'Professional Package 10 Year IO - $1,000,000+',
        securityPurpose: 'owner_occupied',
        repaymentType: 'interest_only',
        rateStructure: 'variable',
        lvrTier: 'lvr_=60%',
        interestRate: 5.99,
        comparisonRate: 6.23,
        featureSet: 'premium',
      }),
    )
    expect(parsed.rows).toContainEqual(
      expect.objectContaining({
        productName: 'Professional Package Construction - $500,000 to <$1,000,000',
        securityPurpose: 'owner_occupied',
        repaymentType: 'interest_only',
        rateStructure: 'variable',
        lvrTier: 'lvr_85-90%',
        interestRate: 6.64,
        comparisonRate: 6.58,
      }),
    )
    expect(parsed.rows).toContainEqual(
      expect.objectContaining({
        productName: 'AMP First Home Loan',
        securityPurpose: 'owner_occupied',
        repaymentType: 'principal_and_interest',
        rateStructure: 'fixed_1yr',
        interestRate: 5.82,
        comparisonRate: 5.65,
      }),
    )
    expect(parsed.rows).toContainEqual(
      expect.objectContaining({
        productName: 'SMSF Loan',
        securityPurpose: 'investment',
        repaymentType: 'principal_and_interest',
        rateStructure: 'variable',
        lvrTier: 'lvr_70-80%',
        interestRate: 6.74,
        comparisonRate: 7.11,
      }),
    )
  })
})
