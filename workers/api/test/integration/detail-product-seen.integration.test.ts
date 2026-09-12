import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { NormalizedRateRow } from '../../src/ingest/normalize'
import { upsertHistoricalRateRows } from '../../src/db/historical-rates'
import { finalizePresenceForRun } from '../../src/db/presence-finalize'
import {
  markProductsSeenForRun,
  productIdsSeenFromDetailFetch,
} from '../../src/queue/consumer/series-tracking'
import homeFixtureRaw from '../fixtures/real-normalized-home-loan-row.json?raw'

function homeFixture(): NormalizedRateRow {
  return JSON.parse(homeFixtureRaw) as NormalizedRateRow
}

async function resetPresenceTables(): Promise<void> {
  const tables = [
    'run_seen_products',
    'run_seen_series',
    'product_presence_status',
    'product_catalog',
    'latest_home_loan_series',
    'historical_loan_rates',
    'home_loan_rate_events',
    'home_loan_rate_intervals',
    'cdr_detail_payload_store',
    'series_catalog',
    'series_presence_status',
  ]
  for (const table of tables) {
    await env.DB.exec(`DELETE FROM ${table};`)
  }
}

async function seedActiveHomeLoanProduct(collectionDate: string): Promise<{
  productId: string
  bankName: string
}> {
  const productId = `shell-${crypto.randomUUID()}`
  const bankName = 'ANZ'
  const row: NormalizedRateRow = {
    ...homeFixture(),
    bankName,
    productId,
    collectionDate,
    runId: `daily:test:${crypto.randomUUID()}`,
    sourceUrl: 'https://api.anz/cds-au/v1/banking/products/detail-seen-shell',
    productUrl: 'https://www.anz.com.au/personal/home-loans/',
    runSource: 'scheduled',
    retrievalType: 'present_scrape_same_date',
    fetchEventId: 901,
  }
  await upsertHistoricalRateRows(env.DB, [row])
  return { productId, bankName }
}

describe('detail product seen tracking', () => {
  it('productIdsSeenFromDetailFetch always includes the detail job product id', () => {
    expect(productIdsSeenFromDetailFetch('P123', [])).toEqual(['P123'])
    expect(productIdsSeenFromDetailFetch('P123', ['P123', 'P456'])).toEqual(['P123', 'P456'])
  })

  it('keeps catalog-supplement products active when detail job fails after supplement enqueue', async () => {
    await resetPresenceTables()

    const collectionDate = '2026-06-28'
    const runId = `daily:test:${crypto.randomUUID()}`
    const { productId, bankName } = await seedActiveHomeLoanProduct(collectionDate)

    // Index missed this product; catalog supplement enqueues detail and records presence.
    await markProductsSeenForRun(env.DB, {
      runId,
      lenderCode: 'anz',
      dataset: 'home_loans',
      bankName,
      collectionDate,
      productIds: [productId],
    })

    const result = await finalizePresenceForRun(env.DB, {
      runId,
      lenderCode: 'anz',
      dataset: 'home_loans',
      bankName,
      collectionDate,
    })

    expect(result.removedProducts).toBe(0)
    expect(result.removedSeries).toBe(0)
  })

  it('keeps shell catalog products active when detail fetch returns zero ingestible rows', async () => {
    await resetPresenceTables()

    const collectionDate = '2026-06-28'
    const runId = `daily:test:${crypto.randomUUID()}`
    const { productId, bankName } = await seedActiveHomeLoanProduct(collectionDate)

    await markProductsSeenForRun(env.DB, {
      runId,
      lenderCode: 'anz',
      dataset: 'home_loans',
      bankName,
      collectionDate,
      productIds: productIdsSeenFromDetailFetch(productId, []),
    })

    const result = await finalizePresenceForRun(env.DB, {
      runId,
      lenderCode: 'anz',
      dataset: 'home_loans',
      bankName,
      collectionDate,
    })

    expect(result.removedProducts).toBe(0)
    const presence = await env.DB
      .prepare(
        `SELECT is_removed
         FROM product_presence_status
         WHERE section = 'home_loans' AND bank_name = ?1 AND product_id = ?2`,
      )
      .bind(bankName, productId)
      .first<{ is_removed: number }>()
    expect(Number(presence?.is_removed ?? 1)).toBe(0)
  })

  it('keeps active series when detail fetch returns zero ingestible rows', async () => {
    await resetPresenceTables()

    const collectionDate = '2026-06-28'
    const runId = `daily:test:${crypto.randomUUID()}`
    const { productId, bankName } = await seedActiveHomeLoanProduct(collectionDate)

    await markProductsSeenForRun(env.DB, {
      runId,
      lenderCode: 'anz',
      dataset: 'home_loans',
      bankName,
      collectionDate,
      productIds: productIdsSeenFromDetailFetch(productId, []),
    })

    const result = await finalizePresenceForRun(env.DB, {
      runId,
      lenderCode: 'anz',
      dataset: 'home_loans',
      bankName,
      collectionDate,
    })

    expect(result.removedSeries).toBe(0)
    const seriesPresence = await env.DB
      .prepare(
        `SELECT is_removed
         FROM series_presence_status
         WHERE dataset_kind = 'home_loans' AND bank_name = ?1 AND product_id = ?2`,
      )
      .bind(bankName, productId)
      .first<{ is_removed: number }>()
    expect(Number(seriesPresence?.is_removed ?? 1)).toBe(0)
  })

  it('removes active catalog products that never reached run_seen_products', async () => {
    await resetPresenceTables()

    const collectionDate = '2026-06-28'
    const runId = `daily:test:${crypto.randomUUID()}`
    const { productId, bankName } = await seedActiveHomeLoanProduct(collectionDate)

    const result = await finalizePresenceForRun(env.DB, {
      runId,
      lenderCode: 'anz',
      dataset: 'home_loans',
      bankName,
      collectionDate,
    })

    expect(result.removedProducts).toBe(1)
    expect(result.removedSeries).toBeGreaterThan(0)
    const presence = await env.DB
      .prepare(
        `SELECT is_removed
         FROM product_presence_status
         WHERE section = 'home_loans' AND bank_name = ?1 AND product_id = ?2`,
      )
      .bind(bankName, productId)
      .first<{ is_removed: number }>()
    expect(Number(presence?.is_removed ?? 0)).toBe(1)
  })

  it('performRemovals:false keeps active catalog products not in run_seen_products', async () => {
    await resetPresenceTables()

    const collectionDate = '2026-06-28'
    const runId = `repair:test:${crypto.randomUUID()}`
    const { productId, bankName } = await seedActiveHomeLoanProduct(collectionDate)

    const result = await finalizePresenceForRun(
      env.DB,
      {
        runId,
        lenderCode: 'anz',
        dataset: 'home_loans',
        bankName,
        collectionDate,
      },
      { performRemovals: false },
    )

    expect(result.removedProducts).toBe(0)
    expect(result.removedSeries).toBe(0)
    const presence = await env.DB
      .prepare(
        `SELECT is_removed
         FROM product_presence_status
         WHERE section = 'home_loans' AND bank_name = ?1 AND product_id = ?2`,
      )
      .bind(bankName, productId)
      .first<{ is_removed: number }>()
    expect(Number(presence?.is_removed ?? 1)).toBe(0)
  })
})
