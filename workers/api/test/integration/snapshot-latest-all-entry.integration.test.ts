import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { NormalizedRateRow } from '../../src/ingest/normalize'
import { upsertHistoricalRateRows } from '../../src/db/historical-rates'
import { buildLatestAllEntry } from '../../src/routes/snapshot-public'
import homeFixtureRaw from '../fixtures/real-normalized-home-loan-row.json?raw'

function homeFixture(): NormalizedRateRow {
  return JSON.parse(homeFixtureRaw) as NormalizedRateRow
}

async function resetHomeLatestTables(): Promise<void> {
  const tables = [
    'latest_home_loan_series',
    'historical_loan_rates',
    'home_loan_rate_events',
    'home_loan_rate_intervals',
    'product_presence_status',
    'series_presence_status',
  ]
  for (const table of tables) {
    await env.DB.exec(`DELETE FROM ${table};`)
  }
}

describe('snapshot latestAll entry coverage metadata', () => {
  it('includes universe total and limited flag when row cap is below total', async () => {
    await resetHomeLatestTables()

    const rows = Array.from({ length: 5 }, (_, index) => {
      const productId = `snapshot-latest-all-${index}-${crypto.randomUUID()}`
      return {
        ...homeFixture(),
        bankName: 'ANZ',
        productId,
        productName: `ANZ Variable Home Loan ${index + 1}`,
        sourceUrl: `https://api.anz/cds-au/v1/banking/products/${productId}`,
        productUrl: 'https://www.anz.com.au/personal/home-loans/',
        collectionDate: '2026-04-01',
        runId: `daily:test:${crypto.randomUUID()}`,
        runSource: 'scheduled' as const,
        retrievalType: 'present_scrape_same_date' as const,
        fetchEventId: 900 + index,
      } satisfies NormalizedRateRow
    })

    for (const row of rows) {
      await upsertHistoricalRateRows(env.DB, [row])
    }

    const entry = await buildLatestAllEntry(
      env.DB,
      'home_loans',
      {
        startDate: '2025-04-01',
        endDate: '2026-04-01',
        mode: 'all',
        includeRemoved: false,
        sourceMode: 'all',
      },
      { rowLimit: 3 },
    )

    expect(entry.count).toBe(3)
    expect(entry.total).toBe(5)
    const meta = entry.meta as { coverage?: { total_rows?: number; returned_rows?: number; limited?: boolean } }
    expect(meta.coverage?.total_rows).toBe(5)
    expect(meta.coverage?.returned_rows).toBe(3)
    expect(meta.coverage?.limited).toBe(true)
  })
})
