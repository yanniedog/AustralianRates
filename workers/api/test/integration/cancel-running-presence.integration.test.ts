import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { ensureLenderDatasetRun } from '../../src/db/lender-dataset-runs'
import { markProductsSeen } from '../../src/db/product-status'
import { cancelAllRunningRuns } from '../../src/pipeline/run-reconciliation'

async function resetTables(): Promise<void> {
  for (const table of [
    'run_seen_products',
    'run_seen_series',
    'product_presence_status',
    'product_catalog',
    'lender_dataset_runs',
    'run_reports',
  ]) {
    await env.DB.exec(`DELETE FROM ${table};`)
  }
}

describe('cancel-all-running presence safety', () => {
  it('does not remove active products when force-finalizing shell lender_dataset_runs', async () => {
    await resetTables()

    const runId = `daily:test:${crypto.randomUUID()}`
    const productId = `prod-${crypto.randomUUID()}`
    const bankName = 'ANZ'
    const collectionDate = '2026-07-04'

    await env.DB
      .prepare(
        `INSERT INTO run_reports (run_id, run_type, started_at, status, per_lender_json, errors_json)
         VALUES (?1, 'daily', ?2, 'running', '{}', '[]')`,
      )
      .bind(runId, '2026-07-04T00:00:00.000Z')
      .run()

    await ensureLenderDatasetRun(env.DB, {
      runId,
      lenderCode: 'anz',
      dataset: 'home_loans',
      bankName,
      collectionDate,
    })

    await markProductsSeen(env.DB, {
      section: 'home_loans',
      bankName,
      productIds: [productId],
      collectionDate,
      runId: 'prior-run',
    })

    const result = await cancelAllRunningRuns(env.DB)
    expect(result.cancelled).toBe(1)
    expect(result.errors).toEqual([])

    const presence = await env.DB
      .prepare(
        `SELECT is_removed
         FROM product_presence_status
         WHERE section = 'home_loans'
           AND bank_name = ?1
           AND product_id = ?2`,
      )
      .bind(bankName, productId)
      .first<{ is_removed: number }>()

    expect(presence?.is_removed).toBe(0)
  })
})
