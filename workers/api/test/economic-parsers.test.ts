import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFedTargetHistoryHtml, parseFredChinaGdpProxyCsv, parseRbnzOcrText } from '../src/economic/external-parsers'
import { parseRbaTableCsv, extractRbaSeriesObservations } from '../src/economic/rba-table'

function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'test/fixtures/economic', name), 'utf8')
}

const RBA_CASES = [
  ['rba-h5.csv', 'unemployment_rate', 'GLFSURSA', '1978-02-28'],
  ['rba-h5.csv', 'participation_rate', 'GLFSPRSA', '1978-02-28'],
  ['rba-g1.csv', 'trimmed_mean_cpi', 'GCPIOCPMTMYP', '1983-03-31'],
  ['rba-g3.csv', 'inflation_expectations', 'GCONEXP', '2022-03-31'],
  ['rba-h2.csv', 'household_consumption', 'GGDPECCVPSH', '1985-09-30'],
  ['rba-h2.csv', 'public_demand', 'GGDPECCVPD', '1985-09-30'],
  ['rba-h3.csv', 'dwelling_approvals', 'GISPSDA', '2010-01-31'],
  ['rba-h3.csv', 'consumer_sentiment', 'GICWMICS', '2010-01-31'],
  ['rba-h3.csv', 'business_conditions', 'GICNBC', '2010-01-31'],
  ['rba-h4.csv', 'wage_growth', 'GWPIYP', '1998-09-30'],
  ['rba-d1.csv', 'housing_credit_growth', 'DGFACH12', '1977-08-31'],
  ['rba-f1.csv', 'bank_bill_90d', 'FIRMMBAB90D', '2011-01-04'],
  ['rba-f5.csv', 'major_bank_lending_rates', 'FILRHLBVD', '2004-06-30'],
  ['rba-f7.csv', 'major_bank_lending_rates', 'FLRBFOSBT', '2019-07-31'],
  ['rba-f11.csv', 'aud_twi', 'FXRTWI', '2010-01-29'],
  ['rba-i2.csv', 'commodity_prices', 'GRCPBCSDR', '1982-07-31'],
  ['rba-j1.csv', 'neutral_rate', 'JSVNNIREMED', '2024-05-01'],
  ['rba-j1.csv', 'capacity_utilisation_proxy', 'JSVOGMED', '2024-05-01'],
] as const

describe('economic parsers', () => {
  it.each(RBA_CASES)('extracts %s -> %s', (fileName, publicId, sourceSeriesId, expectedDate) => {
    const table = parseRbaTableCsv(fixture(fileName), `https://example.com/${fileName}`)
    const rows = extractRbaSeriesObservations(table, publicId, sourceSeriesId, publicId.indexOf('proxy') >= 0)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].seriesId).toBe(publicId)
    expect(rows[0].observationDate).toBe(expectedDate)
  })

  it('parses RBNZ OCR history from real captured text', () => {
    const rows = parseRbnzOcrText(
      fixture('rbnz-ocr.txt'),
      'rbnz_ocr',
      'https://www.rbnz.govt.nz/monetary-policy/monetary-policy-decisions',
      false,
    )
    expect(rows.length).toBeGreaterThanOrEqual(7)
    expect(rows[0].observationDate).toBe('2026-02-18')
    expect(rows[0].value).toBe(2.25)
  })

  it('parses Fed target history from real captured HTML', () => {
    const rows = parseFedTargetHistoryHtml(
      fixture('fed-open-market.html'),
      'fed_funds_proxy',
      'https://www.federalreserve.gov/monetarypolicy/openmarket.htm?os=shmmfp',
      true,
    )
    expect(rows.length).toBe(3)
    expect(rows[0].observationDate).toBe('2025-12-11')
    expect(rows[0].value).toBe(3.625)
  })

  it('parses China GDP proxy from real captured FRED CSV', () => {
    const rows = parseFredChinaGdpProxyCsv(
      fixture('fred-china-gdp.csv'),
      'major_trading_partner_growth_proxy',
      'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CHNGDPNQDSMEI',
      true,
    )
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(rows[0].observationDate).toBe('1993-01-01')
    expect(rows[0].value).toBeCloseTo(29.867, 3)
  })
})
