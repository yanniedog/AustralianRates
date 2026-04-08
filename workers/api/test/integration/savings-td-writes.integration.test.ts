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
    expect(written).toBe(2)

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
    expect(written).toBe(2)

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
})
