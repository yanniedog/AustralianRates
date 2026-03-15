import { describe, expect, it } from 'vitest'
import { TARGET_LENDERS } from '../src/constants'
import { parseGreatSouthernHomeLoanRatesFromHtml } from '../src/ingest/great-southern-html'
import { parseUbankHomeLoanRatesFromHtml, parseUbankSavingsRows } from '../src/ingest/ubank-fallback'

describe('UBank and Great Southern fallback parsers', () => {
  const ubank = TARGET_LENDERS.find((lender) => lender.code === 'ubank')
  const greatSouthern = TARGET_LENDERS.find((lender) => lender.code === 'great_southern')

  it('maps UBank home-loan fallback rows onto canonical product ids', () => {
    if (!ubank) throw new Error('missing ubank lender')
    const html = [
      '"tableCaption":"Neat Owner occupier variable P&I home loan rates","table":{"__typename":"Table","body":',
      '[["\\u003Cstrong>Up to 60%\\u003C/strong>","5.59%","5.61%"],["\\u003Cstrong>Up to 70%\\u003C/strong>","5.59%","5.61%"]]}',
      '"tableCaption":"Flex Investor fixed IO home loan rates up to 60% LVR","table":{"__typename":"Table","body":',
      '[["\\u003Cstrong>1 year\\u003C/strong>","6.44%","6.85%"],["\\u003Cstrong>5 year\\u003C/strong>","6.89%","7.10%"]]}',
    ].join('')

    const parsed = parseUbankHomeLoanRatesFromHtml({
      lender: ubank,
      html,
      sourceUrl: 'https://www.ubank.com.au/home-loans/neat-variable-rate-home-loans',
      collectionDate: '2026-03-15',
      qualityFlag: 'scraped_fallback_strict',
    })

    expect(parsed.rows.map((row) => row.productId)).toEqual(['11', '11', '10', '10'])
    expect(parsed.rows.map((row) => row.rateStructure)).toEqual(['variable', 'variable', 'fixed_1yr', 'fixed_5yr'])
    expect(parsed.rows[0]?.comparisonRate).toBe(5.61)
    expect(parsed.rows[2]?.securityPurpose).toBe('investment')
    expect(parsed.rows[2]?.repaymentType).toBe('interest_only')
  })

  it('parses UBank savings fallback rows from official help-page snippets', () => {
    if (!ubank) throw new Error('missing ubank lender')
    const parsed = parseUbankSavingsRows({
      lender: ubank,
      saveOverviewHtml:
        'rateSolution":"\\u003Cp>\\u003Cspan class=\\"h1\\">5.35%\\u003C/span> \\u003Cstrong>p.a.\\u003C/strong>\\u003C/p>" $0 $100k $250k $1M',
      saveRateHelpHtml:
        "What's my current Save account interest rate? Tier 1 $0 to $100,000 N/A 4.35% p.a. 4.60% p.a. Tier 2 $100,000.01 to $250,000 N/A 4.35% p.a. 4.60% p.a. Tier 3 $250,000.01 to $1,000,000 N/A 4.35% p.a. 4.60% p.a. Tier 4 $1,000,000.01 and over N/A 0.00% p.a. 0.00% p.a.",
      bonusCriteriaHtml:
        "How do I earn bonus interest? From 1 October 2025, to earn bonus interest, you'll need to: Have a Spend account, and Grow your combined balance across all your Save accounts by at least $1 each month.",
      billsHelpHtml: 'Do I earn interest on my Bills account? Bills account is a transaction account and earns zero interest.',
      collectionDate: '2026-03-15',
      qualityFlag: 'scraped_fallback_strict',
    })

    expect(parsed.rows).toHaveLength(6)
    expect(parsed.rows.filter((row) => row.productId === '1' && row.rateType === 'bonus')).toHaveLength(4)
    expect(parsed.rows.find((row) => row.rateType === 'introductory')?.interestRate).toBe(5.35)
    expect(parsed.rows.find((row) => row.productId === '14')?.interestRate).toBe(0)
    expect(parsed.rows.find((row) => row.rateType === 'bonus')?.conditions).toContain('Have a Spend account')
  })

  it('maps Great Southern html rows onto canonical product ids', () => {
    if (!greatSouthern) throw new Error('missing Great Southern lender')
    const html = `
      <h3 class="rates-module_h3">Basic Variable Home Loan</h3>
      <div class="rates-module_table">
        <div class="rates-module_tr">
          <div class="rates-module_td">Up to 70%</div>
          <div class="rates-module_td">
            <div class="rates-module_rate" data-purpose="Owner Occupied" data-type="principal and interest">5.54%</div>
            <div class="rates-module_rate" data-purpose="Investment" data-type="principal and interest">5.74%</div>
          </div>
          <div class="rates-module_td">
            <div class="rates-module_rate" data-purpose="Owner Occupied" data-type="principal and interest">5.60%</div>
            <div class="rates-module_rate" data-purpose="Investment" data-type="principal and interest">5.80%</div>
          </div>
        </div>
      </div>
    `

    const parsed = parseGreatSouthernHomeLoanRatesFromHtml({
      lender: greatSouthern,
      html,
      sourceUrl: 'https://www.greatsouthernbank.com.au/home-loans/interest-rates',
      collectionDate: '2026-03-15',
      qualityFlag: 'scraped_fallback_strict',
    })

    expect(parsed.rows.map((row) => row.productId)).toEqual(['4200-0211', '4300-0211'])
    expect(parsed.rows[0]?.comparisonRate).toBe(5.6)
    expect(parsed.rows[1]?.securityPurpose).toBe('investment')
  })
})
