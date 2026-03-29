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

export function lenderDatasetStatusScopeKey(
  row: Pick<DailyLenderDatasetStatusRow, 'collection_date' | 'lender_code' | 'dataset_kind'>,
): string {
  return `${row.collection_date}|${row.lender_code}|${row.dataset_kind}`
}

function compareStatusRecency(a: DailyLenderDatasetStatusRow, b: DailyLenderDatasetStatusRow): number {
  return String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
}

export function pickBestDailyLenderDatasetStatusRows(
  rows: DailyLenderDatasetStatusRow[],
  limit = 500,
): DailyLenderDatasetStatusRow[] {
  const grouped = new Map<string, DailyLenderDatasetStatusRow[]>()
  for (const row of rows) {
    const key = lenderDatasetStatusScopeKey(row)
    const bucket = grouped.get(key) ?? []
    bucket.push(row)
    grouped.set(key, bucket)
  }

  const selected = Array.from(grouped.values()).map((group) => {
    const ordered = [...group].sort(compareStatusRecency)
    const healthyComplete = ordered.find((row) => isHealthyDailyLenderDatasetStatusRow(row))
    if (healthyComplete) return healthyComplete
    const complete = ordered.find((row) => isLenderDatasetCollectionComplete(row))
    if (complete) return complete
    const finalized = ordered.find((row) => Boolean(row.finalized_at))
    if (finalized) return finalized
    return ordered[0]
  })

  return selected
    .sort((a, b) => {
      const collectionCmp = String(b.collection_date || '').localeCompare(String(a.collection_date || ''))
      if (collectionCmp !== 0) return collectionCmp
      const lenderCmp = String(a.lender_code || '').localeCompare(String(b.lender_code || ''))
      if (lenderCmp !== 0) return lenderCmp
      const datasetCmp = String(a.dataset_kind || '').localeCompare(String(b.dataset_kind || ''))
      if (datasetCmp !== 0) return datasetCmp
      return compareStatusRecency(a, b)
    })
    .slice(0, Math.max(1, Math.min(2000, Math.floor(Number(limit) || 500))))
}

export function isHealthyDailyLenderDatasetStatusRow(row: DailyLenderDatasetStatusRow): boolean {
  return (
    isLenderDatasetCollectionComplete(row) &&
    Number(row.lineage_error_count ?? 0) === 0 &&
    Number(row.accepted_row_count ?? 0) <= Number(row.written_row_count ?? 0)
  )
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

/**
 * One row per (collection_date, lender_code, dataset_kind): the most recently updated
 * daily run among scheduled and manual. Used for coverage gaps so a successful manual
 * reconcile supersedes a stale failed scheduled run for the same calendar day.
 */
export async function listLatestDailyLenderDatasetStatusRows(
  db: D1Database,
  input: {
    collectionDate?: string
    dataset?: DatasetKind
    lenderCode?: string
    limit?: number
  } = {},
): Promise<DailyLenderDatasetStatusRow[]> {
  const where = [
    `rr.run_type = 'daily'`,
    `(rr.run_source IS NULL OR rr.run_source IN ('scheduled', 'manual'))`,
  ]
  const binds: Array<string | number> = []
  if (input.collectionDate) {
    where.push(`ldr.collection_date = ?`)
    binds.push(input.collectionDate)
  }
  if (input.dataset) {
    where.push(`ldr.dataset_kind = ?`)
    binds.push(input.dataset)
  }
  if (input.lenderCode) {
    where.push(`ldr.lender_code = ?`)
    binds.push(input.lenderCode)
  }
  const fetchLimit = Math.max(1, Math.min(10000, Math.floor(Number(input.limit) || 500) * 10))

  const result = await db
    .prepare(
      `SELECT
         ldr.run_id AS run_id,
         rr.run_source AS run_source,
         ldr.lender_code AS lender_code,
         ldr.dataset_kind AS dataset_kind,
         ldr.bank_name AS bank_name,
         ldr.collection_date AS collection_date,
         ldr.expected_detail_count AS expected_detail_count,
         ldr.index_fetch_succeeded AS index_fetch_succeeded,
         ldr.accepted_row_count AS accepted_row_count,
         ldr.written_row_count AS written_row_count,
         ldr.detail_fetch_event_count AS detail_fetch_event_count,
         ldr.lineage_error_count AS lineage_error_count,
         ldr.completed_detail_count AS completed_detail_count,
         ldr.failed_detail_count AS failed_detail_count,
         ldr.finalized_at AS finalized_at,
         ldr.updated_at AS updated_at
       FROM lender_dataset_runs ldr
       JOIN run_reports rr
         ON rr.run_id = ldr.run_id
       WHERE ${where.join(' AND ')}
       ORDER BY ldr.collection_date DESC, ldr.lender_code ASC, ldr.dataset_kind ASC, ldr.updated_at DESC
       LIMIT ?`,
    )
    .bind(...binds, fetchLimit)
    .all<DailyLenderDatasetStatusRow>()

  return pickBestDailyLenderDatasetStatusRows(result.results ?? [], input.limit)
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
    /** @deprecated Ignored; gaps use latest run per lender/day/dataset (scheduled or manual). */
    runSource?: RunSource
    limit?: number
  } = {},
): Promise<LenderDatasetGapRow[]> {
  const rows = await listLatestDailyLenderDatasetStatusRows(db, input)
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
