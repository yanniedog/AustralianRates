import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { upsertEconomicObservations, upsertEconomicStatus } from '../../src/db/economic-series'
import { parseAbsIndicatorCsv } from '../../src/economic/abs-indicator'
import { parseFedTargetHistoryHtml } from '../../src/economic/external-parsers'
import { parseRbaTableCsv, extractRbaSeriesObservations } from '../../src/economic/rba-table'
import absIndicatorFixture from '../fixtures/economic/abs-indicator-sample.csv?raw'
import fedFixture from '../fixtures/economic/fed-open-market.html?raw'
import d1Fixture from '../fixtures/economic/rba-d1.csv?raw'
import f11Fixture from '../fixtures/economic/rba-f1-1.csv?raw'
import g1Fixture from '../fixtures/economic/rba-g1.csv?raw'
import h3Fixture from '../fixtures/economic/rba-h3.csv?raw'
import h4Fixture from '../fixtures/economic/rba-h4.csv?raw'
import h5Fixture from '../fixtures/economic/rba-h5.csv?raw'

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM economic_series_observations').run()
  await env.DB.prepare('DELETE FROM economic_series_status').run()
})

describe('economic data routes', () => {
  it('accepts debug-log traffic under the economic namespace', async () => {
    const postResponse = await SELF.fetch('https://example.com/api/economic-data/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'economic-debug-test',
        level: 'warn',
        message: 'Economic chart render degraded',
        url: 'https://example.com/economic-data/',
        data: { section: 'economic-data', code: 'chart_render_degraded' },
      }),
    })
    expect(postResponse.status).toBe(200)
    const postJson = await postResponse.json() as { ok: boolean; count: number }
    expect(postJson.ok).toBe(true)
    expect(postJson.count).toBeGreaterThan(0)

    const getResponse = await SELF.fetch('https://example.com/api/economic-data/debug-log?session=economic-debug-test')
    expect(getResponse.status).toBe(200)
    const getJson = await getResponse.json() as { entries: Array<{ message?: string; data?: { code?: string } }> }
    expect(getJson.entries.some((entry) => entry.message === 'Economic chart render degraded')).toBe(true)
    expect(getJson.entries.some((entry) => entry.data?.code === 'chart_render_degraded')).toBe(true)
  })

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
    const json = await response.json() as { presets: Array<{ id: string }>; categories: Array<{ series: Array<{ id: string; proxy: boolean; freshness: { last_observation_date: string } | null }> }> }
    const flat = json.categories.flatMap((category) => category.series)
    const bankBill = flat.find((series) => series.id === 'bank_bill_90d')
    const fedFunds = flat.find((series) => series.id === 'fed_funds_proxy')
    const absMonthly = flat.find((series) => series.id === 'monthly_cpi_indicator')
    const derivedSignal = flat.find((series) => series.id === 'rba_signal_index')
    expect(json.presets.some((preset) => preset.id === 'rba_signal_dashboard')).toBe(true)
    expect(bankBill?.freshness?.last_observation_date).toBe('2026-03-24')
    expect(fedFunds?.proxy).toBe(true)
    expect(absMonthly?.freshness).toBeNull()
    expect(derivedSignal?.proxy).toBe(true)
  })

  it('returns step-filled normalized series payloads', async () => {
    const table = parseRbaTableCsv(h3Fixture, 'https://example.com/rba-h3.csv')
    const sentimentRows = extractRbaSeriesObservations(table, 'consumer_sentiment', 'GICWMICS', false)
    const conditionsRows = extractRbaSeriesObservations(table, 'business_conditions', 'GICNBC', false)
    const fedRows = parseFedTargetHistoryHtml(
      fedFixture,
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

  it('returns derived economic series without stored derived rows', async () => {
    const f11Table = parseRbaTableCsv(f11Fixture, 'https://www.rba.gov.au/statistics/tables/csv/f1.1-data.csv')
    const bankBillRows = extractRbaSeriesObservations(f11Table, 'bank_bill_90d', 'FIRMMBAB90', false)
    await upsertEconomicObservations(env.DB, bankBillRows)
    await upsertEconomicStatus(env.DB, {
      seriesId: 'bank_bill_90d',
      lastCheckedAt: '2026-04-01T00:00:00.000Z',
      lastSuccessAt: '2026-04-01T00:00:00.000Z',
      lastObservationDate: '2026-03-31',
      lastValue: 4.19,
      status: 'ok',
      message: 'Loaded from fixture.',
      sourceUrl: 'https://www.rba.gov.au/statistics/tables/csv/f1.1-data.csv',
      proxy: false,
    })

    const response = await SELF.fetch(
      'https://example.com/api/economic-data/series?ids=market_implied_cash_rate_gap&start_date=2026-03-01&end_date=2026-03-31',
    )
    expect(response.status).toBe(200)
    const json = await response.json() as { series: Array<{ id: string; points: Array<{ raw_value: number | null }> }> }
    const derived = json.series.find((series) => series.id === 'market_implied_cash_rate_gap')
    expect(derived?.points.some((point) => point.raw_value != null)).toBe(true)
  })

  it('keeps ABS-backed series unavailable without failing the public series route', async () => {
    const response = await SELF.fetch(
      'https://example.com/api/economic-data/series?ids=monthly_cpi_indicator&start_date=2026-01-01&end_date=2026-01-03',
    )
    expect(response.status).toBe(200)
    const json = await response.json() as { series: Array<{ id: string; freshness: unknown; points: Array<{ raw_value: number | null }> }> }
    expect(json.series[0]?.id).toBe('monthly_cpi_indicator')
    expect(json.series[0]?.freshness).toBeNull()
    expect(json.series[0]?.points.every((point) => point.raw_value == null)).toBe(true)
  })


  it('returns deterministic RBA signal component scores from real fixtures', async () => {
    const fixtureRows = [
      ...extractRbaSeriesObservations(parseRbaTableCsv(f11Fixture, 'https://www.rba.gov.au/statistics/tables/csv/f1.1-data.csv'), 'bank_bill_90d', 'FIRMMBAB90', false),
      ...extractRbaSeriesObservations(parseRbaTableCsv(g1Fixture, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv'), 'trimmed_mean_cpi', 'GCPIOCPMTMYP', false),
      ...extractRbaSeriesObservations(parseRbaTableCsv(h5Fixture, 'https://www.rba.gov.au/statistics/tables/csv/h5-data.csv'), 'unemployment_rate', 'GLFSURSA', false),
      ...extractRbaSeriesObservations(parseRbaTableCsv(h4Fixture, 'https://www.rba.gov.au/statistics/tables/csv/h4-data.csv'), 'wage_growth', 'GWPIYP', false),
      ...extractRbaSeriesObservations(parseRbaTableCsv(d1Fixture, 'https://www.rba.gov.au/statistics/tables/csv/d1-data.csv'), 'housing_credit_growth', 'DGFACH12', false),
      ...parseAbsIndicatorCsv(absIndicatorFixture, {
        seriesId: 'monthly_trimmed_mean_cpi',
        sourceUrl: 'https://indicator.api.abs.gov.au',
        frequency: 'monthly',
        proxy: false,
        filters: { MEASURE: 'trimmed_mean_annual_movement', REGION: 'AUS' },
      }),
      ...parseFedTargetHistoryHtml(
        fedFixture,
        'fed_funds_proxy',
        'https://www.federalreserve.gov/monetarypolicy/openmarket.htm?os=shmmfp',
        true,
      ),
    ]
    await upsertEconomicObservations(env.DB, fixtureRows)
    for (const seriesId of Array.from(new Set(fixtureRows.map((row) => row.seriesId)))) {
      const latest = fixtureRows.filter((row) => row.seriesId === seriesId).sort((a, b) => b.observationDate.localeCompare(a.observationDate))[0]
      await upsertEconomicStatus(env.DB, {
        seriesId,
        lastCheckedAt: '2026-04-01T00:00:00.000Z',
        lastSuccessAt: '2026-04-01T00:00:00.000Z',
        lastObservationDate: latest.observationDate,
        lastValue: latest.value,
        status: 'ok',
        message: 'Loaded from fixture.',
        sourceUrl: latest.sourceUrl,
        proxy: latest.proxy,
      })
    }

    const response = await SELF.fetch('https://example.com/api/economic-data/signals')
    expect(response.status).toBe(200)
    const json = await response.json() as { overall_bias: string; components: Array<{ key: string; score: number | null }> }
    expect(['hike', 'hold', 'cut']).toContain(json.overall_bias)
    expect(json.components.find((row) => row.key === 'inflation')?.score).not.toBeNull()
    expect(json.components.find((row) => row.key === 'market')?.score).not.toBeNull()
  })
})
