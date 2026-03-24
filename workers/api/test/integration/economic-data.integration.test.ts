import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { upsertEconomicObservations, upsertEconomicStatus } from '../../src/db/economic-series'
import { parseFedTargetHistoryHtml } from '../../src/economic/external-parsers'
import { parseRbaTableCsv, extractRbaSeriesObservations } from '../../src/economic/rba-table'

function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'test/fixtures/economic', name), 'utf8')
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM economic_series_observations').run()
  await env.DB.prepare('DELETE FROM economic_series_status').run()
})

describe('economic data routes', () => {
  it('returns grouped catalog metadata with freshness and proxy flags', async () => {
    await upsertEconomicStatus(env.DB, {
      seriesId: 'bank_bill_90d',
      lastCheckedAt: '2026-03-25T00:00:00.000Z',
      lastSuccessAt: '2026-03-25T00:00:00.000Z',
      lastObservationDate: '2026-03-24',
      lastValue: 4.12,
      status: 'ok',
      message: 'Source checked; no new observations.',
      sourceUrl: 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv',
      proxy: false,
    })
    await upsertEconomicStatus(env.DB, {
      seriesId: 'fed_funds_proxy',
      lastCheckedAt: '2026-03-25T00:00:00.000Z',
      lastSuccessAt: '2026-03-25T00:00:00.000Z',
      lastObservationDate: '2025-12-11',
      lastValue: 3.625,
      status: 'ok',
      message: 'Parsed official target history.',
      sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm?os=shmmfp',
      proxy: true,
    })

    const response = await SELF.fetch('https://example.com/api/economic-data/catalog')
    expect(response.status).toBe(200)
    const json = await response.json() as { categories: Array<{ series: Array<{ id: string; proxy: boolean; freshness: { last_observation_date: string } | null }> }> }
    const flat = json.categories.flatMap((category) => category.series)
    const bankBill = flat.find((series) => series.id === 'bank_bill_90d')
    const fedFunds = flat.find((series) => series.id === 'fed_funds_proxy')
    expect(bankBill?.freshness?.last_observation_date).toBe('2026-03-24')
    expect(fedFunds?.proxy).toBe(true)
  })

  it('returns step-filled normalized series payloads', async () => {
    const table = parseRbaTableCsv(fixture('rba-h3.csv'), 'https://example.com/rba-h3.csv')
    const sentimentRows = extractRbaSeriesObservations(table, 'consumer_sentiment', 'GICWMICS', false)
    const conditionsRows = extractRbaSeriesObservations(table, 'business_conditions', 'GICNBC', false)
    const fedRows = parseFedTargetHistoryHtml(
      fixture('fed-open-market.html'),
      'fed_funds_proxy',
      'https://www.federalreserve.gov/monetarypolicy/openmarket.htm?os=shmmfp',
      true,
    )

    await upsertEconomicObservations(env.DB, [...sentimentRows, ...conditionsRows, ...fedRows])
    for (const [seriesId, observationDate, value, proxy] of [
      ['consumer_sentiment', '2010-04-30', 116.1, false],
      ['business_conditions', '2010-04-30', 3.9, false],
      ['fed_funds_proxy', '2025-12-11', 3.625, true],
    ] as const) {
      await upsertEconomicStatus(env.DB, {
        seriesId,
        lastCheckedAt: '2026-03-25T00:00:00.000Z',
        lastSuccessAt: '2026-03-25T00:00:00.000Z',
        lastObservationDate: observationDate,
        lastValue: value,
        status: 'ok',
        message: 'Loaded from fixture.',
        sourceUrl: 'https://example.com',
        proxy,
      })
    }

    const response = await SELF.fetch(
      'https://example.com/api/economic-data/series?ids=consumer_sentiment,business_conditions&start_date=2010-02-02&end_date=2010-03-02',
    )
    expect(response.status).toBe(200)
    const json = await response.json() as {
      series: Array<{
        id: string
        proxy: boolean
        baseline_date: string | null
        points: Array<{ date: string; raw_value: number | null; normalized_value: number | null }>
      }>
    }
    const sentiment = json.series.find((series) => series.id === 'consumer_sentiment')
    expect(sentiment?.proxy).toBe(false)
    expect(sentiment?.baseline_date).toBe('2010-02-02')
    expect(sentiment?.points[0]).toMatchObject({
      date: '2010-02-02',
      raw_value: 120.1,
      normalized_value: 100,
    })
    const monthEnd = sentiment?.points.find((point) => point.date === '2010-02-28')
    expect(monthEnd?.raw_value).toBe(117)
    expect(monthEnd?.normalized_value).toBeCloseTo(97.419, 3)
  })
})
