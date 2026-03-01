import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractLenderRatesFromHtml } from '../src/ingest/html-rate-parser'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(__dirname, 'fixtures')

const lender = {
  code: 'anz',
  name: 'ANZ',
  canonical_bank_name: 'ANZ',
  register_brand_name: 'ANZ',
  seed_rate_urls: ['https://www.anz.com.au/personal/home-loans/interest-rates/'],
}

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES_DIR, name), 'utf8')
}

describe('html rate parser strictness', () => {
  it('drops LVR-only percentage text when using real-data fixture', () => {
    const html = loadFixture('real-lender-rate-page-no-rates.html')
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

  it('extracts a plausible home-loan row with confidence from real-data fixture', () => {
    const html = loadFixture('real-lender-rate-page-with-rates.html')
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
