import { describe, expect, it } from 'vitest'
import { extractLenderRatesFromHtml } from '../src/ingest/html-rate-parser'

const lender = {
  code: 'anz',
  name: 'ANZ',
  canonical_bank_name: 'ANZ',
  register_brand_name: 'ANZ',
  seed_rate_urls: ['https://www.anz.com.au/personal/home-loans/interest-rates/'],
}

describe('html rate parser strictness', () => {
  it('drops LVR-only percentage text', () => {
    const html = `
      <html>
        <body>
          <p>Estimated LVR 80% and 90% example only</p>
          <p>Disclaimer terms and conditions 60%</p>
        </body>
      </html>
    `
    const parsed = extractLenderRatesFromHtml({
      lender,
      html,
      sourceUrl: lender.seed_rate_urls[0],
      collectionDate: '2026-02-23',
      mode: 'daily',
      qualityFlag: 'scraped_fallback_strict',
    })
    expect(parsed.rows.length).toBe(0)
  })

  it('extracts a plausible home-loan row with confidence', () => {
    const html = `
      <table>
        <tr><td>ANZ Variable Home Loan Owner Occupied Rate</td><td>6.19%</td></tr>
        <tr><td>Comparison Rate</td><td>6.25%</td></tr>
      </table>
    `
    const parsed = extractLenderRatesFromHtml({
      lender,
      html,
      sourceUrl: lender.seed_rate_urls[0],
      collectionDate: '2026-02-23',
      mode: 'historical',
      qualityFlag: 'parsed_from_wayback_strict',
    })
    expect(parsed.rows.length).toBeGreaterThan(0)
    expect(parsed.rows[0].interestRate).toBe(6.19)
    expect(parsed.rows[0].confidenceScore).toBeGreaterThanOrEqual(0.85)
  })
})
