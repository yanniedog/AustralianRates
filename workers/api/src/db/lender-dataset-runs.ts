import type { DatasetKind } from '../../../../packages/shared/src'
import { nowIso } from '../utils/time'

export type LenderDatasetRunRow = {
  run_id: string
  lender_code: string
  dataset_kind: DatasetKind
  bank_name: string
  collection_date: string
  expected_detail_count: number
  completed_detail_count: number
  failed_detail_count: number
  finalized_at: string | null
  last_error: string | null
  updated_at: string
}

export async function ensureLenderDatasetRun(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    dataset: DatasetKind
    bankName: string
    collectionDate: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO lender_dataset_runs (
         run_id, lender_code, dataset_kind, bank_name, collection_date, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(run_id, lender_code, dataset_kind) DO UPDATE SET
         bank_name = excluded.bank_name,
         collection_date = excluded.collection_date,
         updated_at = excluded.updated_at`,
    )
    .bind(input.runId, input.lenderCode, input.dataset, input.bankName, input.collectionDate, nowIso())
    .run()
}

export async function setLenderDatasetExpectedDetails(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    dataset: DatasetKind
    bankName: string
    collectionDate: string
    expectedDetailCount: number
  },
): Promise<void> {
  await ensureLenderDatasetRun(db, input)
  await db
    .prepare(
      `UPDATE lender_dataset_runs
       SET expected_detail_count = ?1,
           updated_at = ?2
       WHERE run_id = ?3
         AND lender_code = ?4
         AND dataset_kind = ?5`,
    )
    .bind(
      Math.max(0, Math.floor(input.expectedDetailCount)),
      nowIso(),
      input.runId,
      input.lenderCode,
      input.dataset,
    )
    .run()
}

export async function markLenderDatasetDetailProcessed(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    dataset: DatasetKind
    failed?: boolean
    errorMessage?: string | null
  },
): Promise<void> {
  const sql = input.failed
    ? `UPDATE lender_dataset_runs
       SET failed_detail_count = failed_detail_count + 1,
           last_error = ?1,
           updated_at = ?2
       WHERE run_id = ?3
         AND lender_code = ?4
         AND dataset_kind = ?5`
    : `UPDATE lender_dataset_runs
       SET completed_detail_count = completed_detail_count + 1,
           updated_at = ?1
       WHERE run_id = ?2
         AND lender_code = ?3
         AND dataset_kind = ?4`

  if (input.failed) {
    await db.prepare(sql).bind(input.errorMessage ?? null, nowIso(), input.runId, input.lenderCode, input.dataset).run()
    return
  }

  await db.prepare(sql).bind(nowIso(), input.runId, input.lenderCode, input.dataset).run()
}

export async function getLenderDatasetRun(
  db: D1Database,
  input: { runId: string; lenderCode: string; dataset: DatasetKind },
): Promise<LenderDatasetRunRow | null> {
  const row = await db
    .prepare(
      `SELECT
         run_id, lender_code, dataset_kind, bank_name, collection_date,
         expected_detail_count, completed_detail_count, failed_detail_count,
         finalized_at, last_error, updated_at
       FROM lender_dataset_runs
       WHERE run_id = ?1
         AND lender_code = ?2
         AND dataset_kind = ?3`,
    )
    .bind(input.runId, input.lenderCode, input.dataset)
    .first<LenderDatasetRunRow>()
  return row ?? null
}

export async function tryMarkLenderDatasetFinalized(
  db: D1Database,
  input: { runId: string; lenderCode: string; dataset: DatasetKind },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE lender_dataset_runs
       SET finalized_at = ?1,
           updated_at = ?1
       WHERE run_id = ?2
         AND lender_code = ?3
         AND dataset_kind = ?4
         AND finalized_at IS NULL`,
    )
    .bind(nowIso(), input.runId, input.lenderCode, input.dataset)
    .run()
  return Number(result.meta?.changes ?? 0) > 0
}
