import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  ensureLenderDatasetRun,
  setLenderDatasetExpectedDetails,
  tryMarkLenderDatasetFinalized,
} from '../../src/db/lender-dataset-runs'
import { finalizePresenceForRun } from '../../src/db/presence-finalize'
import { markProductsSeen } from '../../src/db/product-status'
import { createRunReport } from '../../src/db/run-reports'
import { isLenderDatasetReadyForFinalization } from '../../src/utils/lender-dataset-invariants'

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

/**
 * Mirrors POST /admin/runs/lender-dataset/force-finalize presence guard:
 * only finalize presence when detail collection is ready (not mid-fanout).
 */
async function forceFinalizePresenceLikeAdmin(run: {
  run_id: string
  lender_code: string
  dataset_kind: 'home_loans'
  bank_name: string
  collection_date: string
  expected_detail_count: number
  index_fetch_succeeded: number
  accepted_row_count: number
  written_row_count: number
  unchanged_row_count: number
  detail_fetch_event_count: number
  lineage_error_count: number
  completed_detail_count: number
  failed_detail_count: number
}): Promise<void> {
  const readiness = isLenderDatasetReadyForFinalization(run)
  if (readiness.ready && Number(run.expected_detail_count ?? 0) > 0) {
    await finalizePresenceForRun(env.DB, {
      runId: run.run_id,
      lenderCode: run.lender_code,
      dataset: run.dataset_kind,
      bankName: run.bank_name,
      collectionDate: run.collection_date,
    })
  }
  await tryMarkLenderDatasetFinalized(env.DB, {
    runId: run.run_id,
    lenderCode: run.lender_code,
    dataset: run.dataset_kind,
  })
}

describe('force-finalize presence safety', () => {
  it('does not remove active products when detail fanout is incomplete', async () => {
    await resetTables()

    const runId = `daily:test:${crypto.randomUUID()}`
    const productId = `prod-${crypto.randomUUID()}`
    const bankName = 'ANZ'
    const collectionDate = '2026-07-04'
    const lenderCode = 'anz'

    await createRunReport(env.DB, {
      runId,
      runType: 'daily',
      startedAt: '2026-07-04T00:00:00.000Z',
    })

    await ensureLenderDatasetRun(env.DB, {
      runId,
      lenderCode,
      dataset: 'home_loans',
      bankName,
      collectionDate,
    })
    await setLenderDatasetExpectedDetails(env.DB, {
      runId,
      lenderCode,
      dataset: 'home_loans',
      bankName,
      collectionDate,
      expectedDetailCount: 3,
    })

    await env.DB
      .prepare(
        `UPDATE lender_dataset_runs
         SET index_fetch_succeeded = 1,
             completed_detail_count = 1,
             accepted_row_count = 5,
             written_row_count = 5,
             detail_fetch_event_count = 1
         WHERE run_id = ?1 AND lender_code = ?2 AND dataset_kind = 'home_loans'`,
      )
      .bind(runId, lenderCode)
      .run()

    await markProductsSeen(env.DB, {
      section: 'home_loans',
      bankName,
      productIds: [productId],
      collectionDate,
      runId: 'prior-run',
    })

    const row = await env.DB
      .prepare(
        `SELECT run_id, lender_code, dataset_kind, bank_name, collection_date,
                expected_detail_count, index_fetch_succeeded, accepted_row_count, written_row_count,
                unchanged_row_count, detail_fetch_event_count, lineage_error_count,
                completed_detail_count, failed_detail_count
         FROM lender_dataset_runs
         WHERE run_id = ?1 AND lender_code = ?2`,
      )
      .bind(runId, lenderCode)
      .first<{
        run_id: string
        lender_code: string
        dataset_kind: 'home_loans'
        bank_name: string
        collection_date: string
        expected_detail_count: number
        index_fetch_succeeded: number
        accepted_row_count: number
        written_row_count: number
        unchanged_row_count: number
        detail_fetch_event_count: number
        lineage_error_count: number
        completed_detail_count: number
        failed_detail_count: number
      }>()

    expect(row).toBeTruthy()
    expect(isLenderDatasetReadyForFinalization(row!).ready).toBe(false)

    await forceFinalizePresenceLikeAdmin(row!)

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
