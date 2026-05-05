import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { NormalizedSavingsRow, NormalizedTdRow } from '../../src/ingest/normalize-savings'
import { upsertSavingsRateRows } from '../../src/db/savings-rates'
import { upsertTdRateRows } from '../../src/db/td-rates'
import savingsFixtureRaw from '../fixtures/real-normalized-savings-row.json?raw'
import tdFixtureRaw from '../fixtures/real-normalized-td-row.json?raw'

function savingsFixture(): NormalizedSavingsRow {
  return JSON.parse(savingsFixtureRaw) as NormalizedSavingsRow
}

function tdFixture(): NormalizedTdRow {
  return JSON.parse(tdFixtureRaw) as NormalizedTdRow
}

async function resetWriteTables(): Promise<void> {
  const tables = [
    'download_change_feed',
    'savings_rate_events',
    'savings_rate_intervals',
    'td_rate_events',
    'td_rate_intervals',
    'latest_savings_series',
    'latest_td_series',
    'historical_savings_rates',
    'historical_term_deposit_rates',
    'product_catalog',
    'series_catalog',
    'series_presence_status',
    'product_presence_status',
  ]
  for (const table of tables) {
    await env.DB.exec(`DELETE FROM ${table};`)
  }
}

describe('batched savings and td writers', () => {
  it('preserves savings side effects when writing multiple rows in one batch', async () => {
    await resetWriteTables()

    const base = {
      ...savingsFixture(),
      bankName: 'ANZ',
      productId: `sav-batch-${crypto.randomUUID()}`,
      sourceUrl: 'https://api.anz/cds-au/v1/banking/products/sav-batch',
      productUrl: 'https://www.anz.com.au/personal/bank-accounts/savings-accounts/',
      runId: `daily:test:${crypto.randomUUID()}`,
      runSource: 'scheduled' as const,
      retrievalType: 'present_scrape_same_date' as const,
      fetchEventId: 101,
    }
    const rows: NormalizedSavingsRow[] = [
      {
        ...base,
        collectionDate: '2026-04-01',
        interestRate: 4.55,
      },
      {
        ...base,
        collectionDate: '2026-04-02',
        interestRate: 4.65,
        fetchEventId: 102,
      },
    ]

    const written = await upsertSavingsRateRows(env.DB, rows)
    expect(written.written).toBe(2)

    const historical = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM historical_savings_rates WHERE product_id = ?')
      .bind(base.productId)
      .first<{ n: number }>()
    const latest = await env.DB
      .prepare('SELECT collection_date, interest_rate FROM latest_savings_series WHERE product_id = ?')
      .bind(base.productId)
      .first<{ collection_date: string; interest_rate: number }>()
    const productCatalog = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM product_catalog WHERE dataset_kind = ? AND product_id = ?')
      .bind('savings', base.productId)
      .first<{ n: number }>()
    const seriesCatalog = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM series_catalog WHERE dataset_kind = ? AND product_id = ?')
      .bind('savings', base.productId)
      .first<{ n: number }>()
    const intervals = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM savings_rate_intervals WHERE product_id = ?')
      .bind(base.productId)
      .first<{ n: number }>()
    const events = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM savings_rate_events WHERE product_id = ?')
      .bind(base.productId)
      .first<{ n: number }>()
    const changeFeed = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM download_change_feed WHERE dataset_kind = ?')
      .bind('savings')
      .first<{ n: number }>()

    expect(Number(historical?.n || 0)).toBe(2)
    expect(latest?.collection_date).toBe('2026-04-02')
    expect(Number(latest?.interest_rate || 0)).toBe(4.65)
    expect(Number(productCatalog?.n || 0)).toBe(1)
    expect(Number(seriesCatalog?.n || 0)).toBe(1)
    expect(Number(intervals?.n || 0)).toBe(2)
    expect(Number(events?.n || 0)).toBe(2)
    expect(Number(changeFeed?.n || 0)).toBeGreaterThan(0)
  })

  it('preserves term-deposit side effects when writing multiple rows in one batch', async () => {
    await resetWriteTables()

    const base = {
      ...tdFixture(),
      bankName: 'ANZ',
      productId: `td-batch-${crypto.randomUUID()}`,
      sourceUrl: 'https://api.anz/cds-au/v1/banking/products/td-batch',
      productUrl: 'https://www.anz.com.au/personal/bank-accounts/term-deposits/',
      runId: `daily:test:${crypto.randomUUID()}`,
      runSource: 'scheduled' as const,
      retrievalType: 'present_scrape_same_date' as const,
      fetchEventId: 201,
    }
    const rows: NormalizedTdRow[] = [
      {
        ...base,
        collectionDate: '2026-04-01',
        interestRate: 4.1,
      },
      {
        ...base,
        collectionDate: '2026-04-02',
        interestRate: 4.2,
        fetchEventId: 202,
      },
    ]

    const written = await upsertTdRateRows(env.DB, rows)
    expect(written.written).toBe(2)

    const historical = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM historical_term_deposit_rates WHERE product_id = ?')
      .bind(base.productId)
      .first<{ n: number }>()
    const latest = await env.DB
      .prepare('SELECT collection_date, interest_rate FROM latest_td_series WHERE product_id = ?')
      .bind(base.productId)
      .first<{ collection_date: string; interest_rate: number }>()
    const productCatalog = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM product_catalog WHERE dataset_kind = ? AND product_id = ?')
      .bind('term_deposits', base.productId)
      .first<{ n: number }>()
    const seriesCatalog = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM series_catalog WHERE dataset_kind = ? AND product_id = ?')
      .bind('term_deposits', base.productId)
      .first<{ n: number }>()
    const intervals = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM td_rate_intervals WHERE product_id = ?')
      .bind(base.productId)
      .first<{ n: number }>()
    const events = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM td_rate_events WHERE product_id = ?')
      .bind(base.productId)
      .first<{ n: number }>()
    const changeFeed = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM download_change_feed WHERE dataset_kind = ?')
      .bind('term_deposits')
      .first<{ n: number }>()

    expect(Number(historical?.n || 0)).toBe(2)
    expect(latest?.collection_date).toBe('2026-04-02')
    expect(Number(latest?.interest_rate || 0)).toBe(4.2)
    expect(Number(productCatalog?.n || 0)).toBe(1)
    expect(Number(seriesCatalog?.n || 0)).toBe(1)
    expect(Number(intervals?.n || 0)).toBe(2)
    expect(Number(events?.n || 0)).toBe(2)
    expect(Number(changeFeed?.n || 0)).toBeGreaterThan(0)
  })

  it('advances savings current state when unchanged historical rows are skipped', async () => {
    await resetWriteTables()

    const base = {
      ...savingsFixture(),
      bankName: 'ANZ',
      productId: `sav-unchanged-${crypto.randomUUID()}`,
      sourceUrl: 'https://api.anz/cds-au/v1/banking/products/sav-unchanged',
      productUrl: 'https://www.anz.com.au/personal/bank-accounts/savings-accounts/',
      runSource: 'scheduled' as const,
      retrievalType: 'present_scrape_same_date' as const,
      interestRate: 4.65,
      fetchEventId: 301,
    }
    const first: NormalizedSavingsRow = {
      ...base,
      collectionDate: '2026-04-01',
      runId: `daily:test:${crypto.randomUUID()}`,
    }
    const second: NormalizedSavingsRow = {
      ...base,
      collectionDate: '2026-04-02',
      runId: `daily:test:${crypto.randomUUID()}`,
      fetchEventId: 302,
    }

    const initial = await upsertSavingsRateRows(env.DB, [first])
    const repeated = await upsertSavingsRateRows(env.DB, [second], { skipUnchangedRows: true })

    const historical = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM historical_savings_rates WHERE product_id = ?')
      .bind(base.productId)
      .first<{ n: number }>()
    const latest = await env.DB
      .prepare('SELECT collection_date, interest_rate FROM latest_savings_series WHERE product_id = ?')
      .bind(base.productId)
      .first<{ collection_date: string; interest_rate: number }>()
    const interval = await env.DB
      .prepare('SELECT effective_from_collection_date, last_confirmed_collection_date FROM savings_rate_intervals WHERE product_id = ?')
      .bind(base.productId)
      .first<{ effective_from_collection_date: string; last_confirmed_collection_date: string }>()
    const productPresence = await env.DB
      .prepare('SELECT last_seen_collection_date FROM product_presence_status WHERE section = ? AND bank_name = ? AND product_id = ?')
      .bind('savings', base.bankName, base.productId)
      .first<{ last_seen_collection_date: string }>()
    const seriesPresence = await env.DB
      .prepare('SELECT last_seen_collection_date FROM series_presence_status WHERE product_id = ?')
      .bind(base.productId)
      .first<{ last_seen_collection_date: string }>()

    expect(initial).toMatchObject({ written: 1, unchanged: 0 })
    expect(repeated).toMatchObject({ written: 0, unchanged: 1 })
    expect(Number(historical?.n || 0)).toBe(1)
    expect(latest?.collection_date).toBe('2026-04-02')
    expect(Number(latest?.interest_rate || 0)).toBe(4.65)
    expect(interval?.effective_from_collection_date).toBe('2026-04-01')
    expect(interval?.last_confirmed_collection_date).toBe('2026-04-02')
    expect(productPresence?.last_seen_collection_date).toBe('2026-04-02')
    expect(seriesPresence?.last_seen_collection_date).toBe('2026-04-02')
  })

  it('advances term-deposit current state when unchanged historical rows are skipped', async () => {
    await resetWriteTables()

    const base = {
      ...tdFixture(),
      bankName: 'ANZ',
      productId: `td-unchanged-${crypto.randomUUID()}`,
      sourceUrl: 'https://api.anz/cds-au/v1/banking/products/td-unchanged',
      productUrl: 'https://www.anz.com.au/personal/bank-accounts/term-deposits/',
      runSource: 'scheduled' as const,
      retrievalType: 'present_scrape_same_date' as const,
      interestRate: 4.2,
      fetchEventId: 301,
    }
    const first: NormalizedTdRow = {
      ...base,
      collectionDate: '2026-04-01',
      runId: `daily:test:${crypto.randomUUID()}`,
    }
    const second: NormalizedTdRow = {
      ...base,
      collectionDate: '2026-04-02',
      runId: `daily:test:${crypto.randomUUID()}`,
      fetchEventId: 302,
    }

    const initial = await upsertTdRateRows(env.DB, [first])
    const repeated = await upsertTdRateRows(env.DB, [second], { skipUnchangedRows: true })

    const historical = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM historical_term_deposit_rates WHERE product_id = ?')
      .bind(base.productId)
      .first<{ n: number }>()
    const latest = await env.DB
      .prepare('SELECT collection_date, interest_rate FROM latest_td_series WHERE product_id = ?')
      .bind(base.productId)
      .first<{ collection_date: string; interest_rate: number }>()
    const interval = await env.DB
      .prepare('SELECT effective_from_collection_date, last_confirmed_collection_date FROM td_rate_intervals WHERE product_id = ?')
      .bind(base.productId)
      .first<{ effective_from_collection_date: string; last_confirmed_collection_date: string }>()
    const events = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM td_rate_events WHERE product_id = ?')
      .bind(base.productId)
      .first<{ n: number }>()
    const productPresence = await env.DB
      .prepare('SELECT last_seen_collection_date FROM product_presence_status WHERE section = ? AND bank_name = ? AND product_id = ?')
      .bind('term_deposits', base.bankName, base.productId)
      .first<{ last_seen_collection_date: string }>()
    const seriesPresence = await env.DB
      .prepare('SELECT last_seen_collection_date FROM series_presence_status WHERE product_id = ?')
      .bind(base.productId)
      .first<{ last_seen_collection_date: string }>()

    expect(initial).toMatchObject({ written: 1, unchanged: 0 })
    expect(repeated).toMatchObject({ written: 0, unchanged: 1 })
    expect(Number(historical?.n || 0)).toBe(1)
    expect(latest?.collection_date).toBe('2026-04-02')
    expect(Number(latest?.interest_rate || 0)).toBe(4.2)
    expect(interval?.effective_from_collection_date).toBe('2026-04-01')
    expect(interval?.last_confirmed_collection_date).toBe('2026-04-02')
    expect(Number(events?.n || 0)).toBe(1)
    expect(productPresence?.last_seen_collection_date).toBe('2026-04-02')
    expect(seriesPresence?.last_seen_collection_date).toBe('2026-04-02')
  })
})
