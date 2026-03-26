import { tryMarkLenderDatasetFinalized } from '../db/lender-dataset-runs'
import { log } from '../utils/logger'
import type { DatasetKind } from '../../../../packages/shared/src'

type StaleUbankRow = {
  run_id: string
  lender_code: string
  dataset_kind: string
}

function asDatasetKind(raw: string): DatasetKind | null {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'home_loans' || v === 'savings' || v === 'term_deposits') return v
  return null
}

/**
 * Finalizes lender_dataset_runs left stuck after the UBank fallback bug where
 * expected_detail_count stayed 0 and index_fetch_succeeded was never set, so
 * scheduled reconciliation could never mark finalized_at.
 *
 * Same end state as POST /admin/runs/lender-dataset/force-finalize for each row
 * (expected 0: no presence pass; only finalized_at).
 */
export async function healStaleUbankZeroExpectedUnindexedLenderDatasets(
  db: D1Database,
  options?: { dryRun?: boolean },
): Promise<{ dry_run: boolean; scanned: number; finalized: number; errors: string[] }> {
  const dryRun = Boolean(options?.dryRun)
  const errors: string[] = []

  const rows = await db
    .prepare(
      `SELECT run_id, lender_code, dataset_kind
       FROM lender_dataset_runs
       WHERE lender_code = 'ubank'
         AND finalized_at IS NULL
         AND expected_detail_count = 0
         AND completed_detail_count = 0
         AND failed_detail_count = 0
         AND COALESCE(index_fetch_succeeded, 0) = 0
         AND updated_at < datetime('now', '-2 hour')`,
    )
    .all<StaleUbankRow>()

  const list = rows.results ?? []
  let finalized = 0

  for (const row of list) {
    const dataset = asDatasetKind(row.dataset_kind)
    if (!dataset) {
      errors.push(`${row.run_id}:invalid_dataset_kind:${row.dataset_kind}`)
      if (errors.length > 30) break
      continue
    }
    if (dryRun) {
      finalized += 1
      continue
    }
    try {
      const marked = await tryMarkLenderDatasetFinalized(db, {
        runId: row.run_id,
        lenderCode: row.lender_code,
        dataset,
      })
      if (marked) {
        finalized += 1
        log.info('admin', 'heal_stale_ubank_lender_dataset_finalized', {
          runId: row.run_id,
          lenderCode: row.lender_code,
          context: `dataset=${dataset}`,
        })
      }
    } catch (e) {
      const msg = `${row.run_id}:${row.dataset_kind}:${(e as Error)?.message ?? String(e)}`
      errors.push(msg)
      if (errors.length > 30) break
    }
  }

  return { dry_run: dryRun, scanned: list.length, finalized, errors }
}
