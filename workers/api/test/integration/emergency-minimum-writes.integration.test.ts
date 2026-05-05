import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { NormalizedRateRow } from '../../src/ingest/normalize'
import { upsertHistoricalRateRows } from '../../src/db/historical-rates'
import homeFixtureRaw from '../fixtures/real-normalized-home-loan-row.json?raw'

function homeFixture(): NormalizedRateRow {
  return JSON.parse(homeFixtureRaw) as NormalizedRateRow
}

async function resetHomeWriteTables(): Promise<void> {
  const tables = [
    'download_change_feed',
    'home_loan_rate_events',
    'home_loan_rate_intervals',
    'latest_home_loan_series',
    'historical_loan_rates',
    'product_catalog',
    'series_catalog',
    'series_presence_status',
    'product_presence_status',
  ]
  for (const table of tables) {
    await env.DB.exec(`DELETE FROM ${table};`)
  }
}

describe('emergency minimum write mode', () => {
  it('skips an identical next-day home-loan row when change-aware writes are enabled', async () => {
    await resetHomeWriteTables()

    const base = {
      ...homeFixture(),
      bankName: 'ANZ',
      productId: `home-emergency-${crypto.randomUUID()}`,
      sourceUrl: 'https://api.anz/cds-au/v1/banking/products/home-emergency',
      productUrl: 'https://www.anz.com.au/personal/home-loans/',
      runSource: 'scheduled' as const,
      retrievalType: 'present_scrape_same_date' as const,
      fetchEventId: 301,
    }
    const first: NormalizedRateRow = {
      ...base,
      collectionDate: '2026-04-01',
      runId: `daily:test:${crypto.randomUUID()}`,
    }
    const second: NormalizedRateRow = {
      ...base,
      collectionDate: '2026-04-02',
      runId: `daily:test:${crypto.randomUUID()}`,
      fetchEventId: 302,
    }

    const initial = await upsertHistoricalRateRows(env.DB, [first])
    const repeated = await upsertHistoricalRateRows(env.DB, [second], { skipUnchangedRows: true })

    const historical = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM historical_loan_rates WHERE product_id = ?')
      .bind(base.productId)
      .first<{ n: number }>()
    const events = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM home_loan_rate_events WHERE product_id = ?')
      .bind(base.productId)
      .first<{ n: number }>()
    const latest = await env.DB
      .prepare('SELECT collection_date, interest_rate FROM latest_home_loan_series WHERE product_id = ?')
      .bind(base.productId)
      .first<{ collection_date: string; interest_rate: number }>()
    const interval = await env.DB
      .prepare('SELECT effective_from_collection_date, last_confirmed_collection_date FROM home_loan_rate_intervals WHERE product_id = ?')
      .bind(base.productId)
      .first<{ effective_from_collection_date: string; last_confirmed_collection_date: string }>()
    const productPresence = await env.DB
      .prepare('SELECT last_seen_collection_date FROM product_presence_status WHERE section = ? AND bank_name = ? AND product_id = ?')
      .bind('home_loans', base.bankName, base.productId)
      .first<{ last_seen_collection_date: string }>()
    const seriesPresence = await env.DB
      .prepare('SELECT last_seen_collection_date FROM series_presence_status WHERE product_id = ?')
      .bind(base.productId)
      .first<{ last_seen_collection_date: string }>()

    expect(initial).toMatchObject({ written: 1, unchanged: 0 })
    expect(repeated).toMatchObject({ written: 0, unchanged: 1 })
    expect(Number(historical?.n || 0)).toBe(1)
    expect(Number(events?.n || 0)).toBe(1)
    expect(latest?.collection_date).toBe('2026-04-02')
    expect(interval?.effective_from_collection_date).toBe('2026-04-01')
    expect(interval?.last_confirmed_collection_date).toBe('2026-04-02')
    expect(productPresence?.last_seen_collection_date).toBe('2026-04-02')
    expect(seriesPresence?.last_seen_collection_date).toBe('2026-04-02')
  })
})
