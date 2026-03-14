import type { DatasetKind } from '../../../../packages/shared/src'
import { assessLenderDatasetCoverage, isLenderDatasetCollectionComplete } from '../utils/lender-dataset-invariants'
import type { RunSource } from '../types'

export type DailyLenderDatasetStatusRow = {
  run_id: string
  run_source: RunSource | null
  lender_code: string
  dataset_kind: DatasetKind
  bank_name: string
  collection_date: string
  expected_detail_count: number
  index_fetch_succeeded: number
  accepted_row_count: number
  written_row_count: number
  detail_fetch_event_count: number
  lineage_error_count: number
  completed_detail_count: number
  failed_detail_count: number
  finalized_at: string | null
  updated_at: string
}

export type LenderDatasetGapRow = DailyLenderDatasetStatusRow & {
  severity: 'ok' | 'warn' | 'error'
  reasons: string[]
  processed_detail_count: number
}

function runSourceClause(runSource: RunSource): string {
  if (runSource === 'manual') return `rr.run_source = 'manual'`
  return `(rr.run_source IS NULL OR rr.run_source = 'scheduled')`
}

export async function listDailyLenderDatasetStatusRows(
  db: D1Database,
  input: {
    collectionDate?: string
    dataset?: DatasetKind
    lenderCode?: string
    runSource?: RunSource
    limit?: number
  } = {},
): Promise<DailyLenderDatasetStatusRow[]> {
  const where = [`rr.run_type = 'daily'`]
  if (input.runSource) where.push(runSourceClause(input.runSource))
  const binds: Array<string | number> = []
  if (input.collectionDate) {
    where.push(`ldr.collection_date = ?${binds.length + 1}`)
    binds.push(input.collectionDate)
  }
  if (input.dataset) {
    where.push(`ldr.dataset_kind = ?${binds.length + 1}`)
    binds.push(input.dataset)
  }
  if (input.lenderCode) {
    where.push(`ldr.lender_code = ?${binds.length + 1}`)
    binds.push(input.lenderCode)
  }
  const limit = Math.max(1, Math.min(2000, Math.floor(Number(input.limit) || 500)))
  binds.push(limit)

  const result = await db
    .prepare(
      `SELECT
         ldr.run_id,
         rr.run_source,
         ldr.lender_code,
         ldr.dataset_kind,
         ldr.bank_name,
         ldr.collection_date,
         ldr.expected_detail_count,
         ldr.index_fetch_succeeded,
         ldr.accepted_row_count,
         ldr.written_row_count,
         ldr.detail_fetch_event_count,
         ldr.lineage_error_count,
         ldr.completed_detail_count,
         ldr.failed_detail_count,
         ldr.finalized_at,
         ldr.updated_at
       FROM lender_dataset_runs ldr
       JOIN run_reports rr
         ON rr.run_id = ldr.run_id
       WHERE ${where.join(' AND ')}
       ORDER BY ldr.collection_date DESC, ldr.updated_at DESC, ldr.lender_code ASC
       LIMIT ?${binds.length}`,
    )
    .bind(...binds)
    .all<DailyLenderDatasetStatusRow>()

  return result.results ?? []
}

export async function getCompletedLenderCodesForDailyCollection(
  db: D1Database,
  input: { collectionDate: string; dataset: DatasetKind; runSource: RunSource },
): Promise<Set<string>> {
  const rows = await listDailyLenderDatasetStatusRows(db, {
    collectionDate: input.collectionDate,
    dataset: input.dataset,
    runSource: input.runSource,
    limit: 500,
  })
  const completed = new Set<string>()
  for (const row of rows) {
    if (isLenderDatasetCollectionComplete(row)) {
      completed.add(row.lender_code)
    }
  }
  return completed
}

export async function listCoverageGapRows(
  db: D1Database,
  input: {
    collectionDate?: string
    dataset?: DatasetKind
    lenderCode?: string
    runSource?: RunSource
    limit?: number
  } = {},
): Promise<LenderDatasetGapRow[]> {
  const rows = await listDailyLenderDatasetStatusRows(db, input)
  return rows
    .map((row) => {
      const assessment = assessLenderDatasetCoverage(row)
      return {
        ...row,
        severity: assessment.severity,
        reasons: assessment.reasons,
        processed_detail_count: assessment.processedDetails,
      }
    })
    .filter((row) => row.reasons.length > 0)
}
