import type { DatasetKind } from '../../../../packages/shared/src'
import { runWithD1Retry } from './d1-retry'
import { nowIso } from '../utils/time'

export type LenderDatasetRunRow = {
  run_id: string
  lender_code: string
  dataset_kind: DatasetKind
  bank_name: string
  collection_date: string
  expected_detail_count: number
  index_fetch_succeeded: number
  accepted_row_count: number
  written_row_count: number
  dropped_row_count: number
  detail_fetch_event_count: number
  lineage_error_count: number
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

export async function markLenderDatasetIndexFetchSucceeded(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    dataset: DatasetKind
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE lender_dataset_runs
       SET index_fetch_succeeded = 1,
           updated_at = ?1
       WHERE run_id = ?2
         AND lender_code = ?3
         AND dataset_kind = ?4`,
    )
    .bind(nowIso(), input.runId, input.lenderCode, input.dataset)
    .run()
}

export async function recordLenderDatasetWriteStats(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    dataset: DatasetKind
    acceptedRows?: number
    writtenRows?: number
    droppedRows?: number
    detailFetchEventCount?: number
    lineageErrors?: number
    errorMessage?: string | null
  },
): Promise<void> {
  await runWithD1Retry(async () => {
    await db
      .prepare(
        `UPDATE lender_dataset_runs
         SET accepted_row_count = accepted_row_count + ?1,
             written_row_count = written_row_count + ?2,
             dropped_row_count = dropped_row_count + ?3,
             detail_fetch_event_count = detail_fetch_event_count + ?4,
             lineage_error_count = lineage_error_count + ?5,
             last_error = COALESCE(?6, last_error),
             updated_at = ?7
         WHERE run_id = ?8
           AND lender_code = ?9
           AND dataset_kind = ?10`,
      )
      .bind(
        Math.max(0, Math.floor(input.acceptedRows ?? 0)),
        Math.max(0, Math.floor(input.writtenRows ?? 0)),
        Math.max(0, Math.floor(input.droppedRows ?? 0)),
        Math.max(0, Math.floor(input.detailFetchEventCount ?? 0)),
        Math.max(0, Math.floor(input.lineageErrors ?? 0)),
        input.errorMessage ?? null,
        nowIso(),
        input.runId,
        input.lenderCode,
        input.dataset,
      )
      .run()
  })
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
    await runWithD1Retry(async () => {
      await db.prepare(sql).bind(input.errorMessage ?? null, nowIso(), input.runId, input.lenderCode, input.dataset).run()
    })
    return
  }

  await runWithD1Retry(async () => {
    await db.prepare(sql).bind(nowIso(), input.runId, input.lenderCode, input.dataset).run()
  })
}

export async function getLenderDatasetRun(
  db: D1Database,
  input: { runId: string; lenderCode: string; dataset: DatasetKind },
): Promise<LenderDatasetRunRow | null> {
  const row = await db
    .prepare(
      `SELECT
         run_id, lender_code, dataset_kind, bank_name, collection_date,
         expected_detail_count, index_fetch_succeeded, accepted_row_count, written_row_count,
         dropped_row_count, detail_fetch_event_count, lineage_error_count,
         completed_detail_count, failed_detail_count,
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
  const before = await db
    .prepare(
      `SELECT finalized_at
       FROM lender_dataset_runs
       WHERE run_id = ?1
         AND lender_code = ?2
         AND dataset_kind = ?3`,
    )
    .bind(input.runId, input.lenderCode, input.dataset)
    .first<{ finalized_at: string | null }>()
  if (before?.finalized_at) {
    return false
  }

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
  if (Number(result.meta?.changes ?? 0) > 0) {
    return true
  }

  // Defensive fallback for runtimes where D1 update metadata can be omitted.
  const after = await db
    .prepare(
      `SELECT finalized_at
       FROM lender_dataset_runs
       WHERE run_id = ?1
         AND lender_code = ?2
         AND dataset_kind = ?3`,
    )
    .bind(input.runId, input.lenderCode, input.dataset)
    .first<{ finalized_at: string | null }>()
  return Boolean(after?.finalized_at)
}
