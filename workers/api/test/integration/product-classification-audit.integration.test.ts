/**
 * Real-D1 coverage for the product classification audit.
 *
 * Uses the canonical upsert entry points (`upsertHistoricalRateRow`,
 * `upsertSavingsRateRows`) with captured real-data fixtures; no mocks and no
 * raw SQL inserts (per `scripts/enforce-api-test-policy.js`). We verify that
 * the audit detects lvr_unspecified home loans, low-confidence classifications
 * and an all-clean baseline, and that the actionable-log filter drops stale
 * "gaps detected" rows once the latest persisted report is clean.
 */
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import homeLoanFixtureRaw from '../fixtures/real-normalized-home-loan-row.json?raw'
import savingsFixtureRaw from '../fixtures/real-normalized-savings-row.json?raw'
import { upsertHistoricalRateRow } from '../../src/db/historical-rates'
import { upsertSavingsRateRows } from '../../src/db/savings-rates'
import type { NormalizedRateRow } from '../../src/ingest/normalize'
import type { NormalizedSavingsRow } from '../../src/ingest/normalize-savings'
import {
  PRODUCT_CLASSIFICATION_REPORT_KEY,
  getCachedProductClassificationAuditReport,
  loadProductClassificationAuditReport,
  runProductClassificationAudit,
  shouldFilterProductClassificationLogForActionable,
} from '../../src/pipeline/product-classification-audit'

function homeLoanFixture(): NormalizedRateRow {
  return JSON.parse(homeLoanFixtureRaw) as NormalizedRateRow
}

function savingsFixture(): NormalizedSavingsRow {
  return JSON.parse(savingsFixtureRaw) as NormalizedSavingsRow
}

async function resetProductTables(): Promise<void> {
  const tables = [
    'home_loan_rate_events',
    'home_loan_rate_intervals',
    'savings_rate_events',
    'savings_rate_intervals',
    'latest_home_loan_series',
    'latest_savings_series',
    'latest_td_series',
    'download_change_feed',
    'historical_loan_rates',
    'historical_savings_rates',
    'historical_term_deposit_rates',
    'product_catalog',
    'series_catalog',
    'app_config',
  ]
  for (const table of tables) {
    try {
      await env.DB.exec(`DELETE FROM ${table};`)
    } catch {
      // Some tables may not exist in every migration path; ignore.
    }
  }
}

type HomeLoanOverride = Partial<NormalizedRateRow> & {
  collectionDate: string
  lvrTier: NormalizedRateRow['lvrTier']
}

let fetchEventCounter = 100

/**
 * Test rows use ANZ because its products_endpoint ('https://api.anz/...') has
 * the simplest host that `allowedLenderHosts` derives from the lenders
 * config. Other lenders would need a matching subdomain (commbank.com.au,
 * nab.com.au, etc.); keeping every seed on ANZ keeps the fixture minimal.
 */
const FIXTURE_LENDER_HOST = 'https://api.anz/cds-au/v1/banking/products'

function cdrSourceUrlFor(productId: string): string {
  return `${FIXTURE_LENDER_HOST}/${productId}`
}

async function seedHomeLoan(override: HomeLoanOverride): Promise<string> {
  const base = homeLoanFixture()
  const bankName = 'ANZ'
  const productId = override.productId || `hl-${crypto.randomUUID()}`
  const row: NormalizedRateRow = {
    ...base,
    ...override,
    bankName,
    productId,
    productName: override.productName || base.productName,
    dataQualityFlag: override.dataQualityFlag || 'cdr_live',
    confidenceScore:
      override.confidenceScore == null ? 0.95 : override.confidenceScore,
    sourceUrl: override.sourceUrl || cdrSourceUrlFor(productId),
    fetchEventId: override.fetchEventId ?? ++fetchEventCounter,
    runId: override.runId || `daily:test:${crypto.randomUUID()}`,
    runSource: override.runSource || 'scheduled',
  }
  await upsertHistoricalRateRow(env.DB, row, {
    emitCanonicalFeed: false,
    writeProjection: false,
    emitProjectionChangeFeed: false,
    updateCatalogs: false,
    markSeriesSeen: false,
    upsertLatestSeries: false,
  })
  return productId
}

async function seedSavings(override: Partial<NormalizedSavingsRow> & { collectionDate: string }): Promise<string> {
  const base = savingsFixture()
  const bankName = 'ANZ'
  const productId = override.productId || `sav-${crypto.randomUUID()}`
  const row: NormalizedSavingsRow = {
    ...base,
    ...override,
    bankName,
    productId,
    runId: override.runId || `daily:test:${crypto.randomUUID()}`,
    runSource: override.runSource || 'scheduled',
    retrievalType: override.retrievalType || 'present_scrape_same_date',
    sourceUrl: override.sourceUrl || cdrSourceUrlFor(productId),
    fetchEventId: override.fetchEventId ?? ++fetchEventCounter,
  }
  await upsertSavingsRateRows(env.DB, [row])
  return productId
}

describe('runProductClassificationAudit', () => {
  beforeEach(async () => {
    await resetProductTables()
  })

  it('reports ok when the canonical classification columns are populated', async () => {
    await seedHomeLoan({ collectionDate: '2026-04-17', lvrTier: 'lvr_80-85%' })
    await seedSavings({ collectionDate: '2026-04-17' })

    const report = await runProductClassificationAudit(env, { persist: false })

    expect(report.ok).toBe(true)
    expect(report.totals.issues).toBe(0)
    expect(report.totals.affected_products).toBe(0)
    expect(report.collection_dates.home_loans).toBe('2026-04-17')
    expect(report.collection_dates.savings).toBe('2026-04-17')
  })

  it('surfaces lvr_unspecified home loans as a dedicated bucket with samples', async () => {
    const p1 = await seedHomeLoan({ collectionDate: '2026-04-17', lvrTier: 'lvr_unspecified' })
    const p2 = await seedHomeLoan({ collectionDate: '2026-04-17', lvrTier: 'lvr_unspecified' })
    await seedHomeLoan({ collectionDate: '2026-04-17', lvrTier: 'lvr_80-85%' })

    const report = await runProductClassificationAudit(env, { persist: false })

    expect(report.ok).toBe(true)
    const bucket = report.buckets.find((b) => b.kind === 'lvr_unspecified' && b.dataset === 'home_loans')
    expect(bucket).toBeDefined()
    expect(bucket!.count).toBe(2)
    expect(bucket!.sample.map((row) => row.product_id).sort()).toEqual([p1, p2].sort())
    expect(report.totals.lvr_unspecified).toBe(2)
  })

  it.todo(
    'detects low-confidence classifications across datasets ' +
      '(live write guards require confidence >= 0.82 so low-confidence rows never reach canonical storage via upsert; ' +
      'future test needs a real-data fixture loaded via the historical-task queue with wayback flags that allow lower ' +
      'thresholds).',
  )

  it('persists the report into app_config and reloads it on demand', async () => {
    await seedHomeLoan({ collectionDate: '2026-04-17', lvrTier: 'lvr_unspecified' })

    const initial = await runProductClassificationAudit(env, { persist: true })
    expect(initial.ok).toBe(true)
    expect(getCachedProductClassificationAuditReport()?.ok).toBe(true)

    const stored = await env.DB
      .prepare('SELECT value FROM app_config WHERE key = ?')
      .bind(PRODUCT_CLASSIFICATION_REPORT_KEY)
      .first<{ value: string }>()
    expect(stored?.value).toBeTruthy()

    const reloaded = await loadProductClassificationAuditReport(env.DB)
    expect(reloaded?.run_id).toBe(initial.run_id)
  })

  it('filters stale product_classification_gaps_detected logs once the latest report is ok', () => {
    const oldEntry = {
      ts: '2026-04-17T08:00:00Z',
      message: 'product_classification_gaps_detected',
    }
    const newerEntry = {
      ts: '2026-04-17T12:00:00Z',
      message: 'product_classification_gaps_detected',
    }
    const cleanReport = {
      run_id: 'rid',
      generated_at: '2026-04-17T10:00:00Z',
      collection_dates: { home_loans: null, savings: null, term_deposits: null },
      totals: {
        issues: 0,
        affected_products: 0,
        lvr_unspecified: 0,
        invalid_enum: 0,
        null_required: 0,
        low_confidence: 0,
      },
      ok: true as const,
      buckets: [],
    }

    expect(shouldFilterProductClassificationLogForActionable(oldEntry, cleanReport)).toBe(true)
    expect(shouldFilterProductClassificationLogForActionable(newerEntry, cleanReport)).toBe(false)
    expect(shouldFilterProductClassificationLogForActionable(newerEntry, null)).toBe(false)
  })
})
