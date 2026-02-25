import { nowIso } from '../utils/time'

export type CoverageDataset = 'mortgage' | 'savings' | 'term_deposits'
export type CoverageStatus = 'pending' | 'active' | 'completed_lower_bound'

export type DatasetCoverageRow = {
  dataset_key: CoverageDataset
  first_coverage_date: string | null
  cursor_date: string | null
  status: CoverageStatus
  empty_streak: number
  last_tick_at: string | null
  last_tick_status: string | null
  last_tick_run_id: string | null
  last_tick_message: string | null
  last_result_run_id: string | null
  created_at: string
  updated_at: string
}

export const COVERAGE_DATASETS: CoverageDataset[] = ['mortgage', 'savings', 'term_deposits']

function asInt(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

function trimOrNull(value: unknown): string | null {
  if (value == null) return null
  const out = String(value).trim()
  return out ? out : null
}

export function addUtcDays(dateOnly: string, days: number): string {
  const [year, month, day] = String(dateOnly || '').split('-').map((part) => Number(part))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`invalid_date_only:${dateOnly}`)
  }
  const cursor = new Date(Date.UTC(year, month - 1, day))
  cursor.setUTCDate(cursor.getUTCDate() + Math.floor(days))
  return cursor.toISOString().slice(0, 10)
}

export async function ensureDatasetCoverageRows(db: D1Database): Promise<void> {
  for (const dataset of COVERAGE_DATASETS) {
    await db
      .prepare(
        `INSERT INTO dataset_coverage_progress (dataset_key, status, updated_at)
         VALUES (?1, 'pending', ?2)
         ON CONFLICT(dataset_key) DO NOTHING`,
      )
      .bind(dataset, nowIso())
      .run()
  }
}

export async function getDatasetCoverageProgressRows(db: D1Database): Promise<DatasetCoverageRow[]> {
  await ensureDatasetCoverageRows(db)
  const result = await db
    .prepare(
      `SELECT
         dataset_key, first_coverage_date, cursor_date, status, empty_streak,
         last_tick_at, last_tick_status, last_tick_run_id, last_tick_message, last_result_run_id,
         created_at, updated_at
       FROM dataset_coverage_progress
       ORDER BY CASE dataset_key
         WHEN 'mortgage' THEN 1
         WHEN 'savings' THEN 2
         WHEN 'term_deposits' THEN 3
         ELSE 99
       END`,
    )
    .all<Record<string, unknown>>()

  return (result.results ?? []).map((row) => ({
    dataset_key: String(row.dataset_key || 'mortgage') as CoverageDataset,
    first_coverage_date: trimOrNull(row.first_coverage_date),
    cursor_date: trimOrNull(row.cursor_date),
    status: String(row.status || 'pending') as CoverageStatus,
    empty_streak: asInt(row.empty_streak),
    last_tick_at: trimOrNull(row.last_tick_at),
    last_tick_status: trimOrNull(row.last_tick_status),
    last_tick_run_id: trimOrNull(row.last_tick_run_id),
    last_tick_message: trimOrNull(row.last_tick_message),
    last_result_run_id: trimOrNull(row.last_result_run_id),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  }))
}

export async function getDatasetCoverageProgressRow(
  db: D1Database,
  dataset: CoverageDataset,
): Promise<DatasetCoverageRow | null> {
  await ensureDatasetCoverageRows(db)
  const row = await db
    .prepare(
      `SELECT
         dataset_key, first_coverage_date, cursor_date, status, empty_streak,
         last_tick_at, last_tick_status, last_tick_run_id, last_tick_message, last_result_run_id,
         created_at, updated_at
       FROM dataset_coverage_progress
       WHERE dataset_key = ?1`,
    )
    .bind(dataset)
    .first<Record<string, unknown>>()

  if (!row) return null
  return {
    dataset_key: String(row.dataset_key || dataset) as CoverageDataset,
    first_coverage_date: trimOrNull(row.first_coverage_date),
    cursor_date: trimOrNull(row.cursor_date),
    status: String(row.status || 'pending') as CoverageStatus,
    empty_streak: asInt(row.empty_streak),
    last_tick_at: trimOrNull(row.last_tick_at),
    last_tick_status: trimOrNull(row.last_tick_status),
    last_tick_run_id: trimOrNull(row.last_tick_run_id),
    last_tick_message: trimOrNull(row.last_tick_message),
    last_result_run_id: trimOrNull(row.last_result_run_id),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  }
}

export async function getGlobalDatasetFirstCoverageDates(db: D1Database): Promise<Record<CoverageDataset, string | null>> {
  const [mortgage, savings, td] = await Promise.all([
    db.prepare(`SELECT MIN(collection_date) AS first_date FROM historical_loan_rates`).first<{ first_date: string | null }>(),
    db.prepare(`SELECT MIN(collection_date) AS first_date FROM historical_savings_rates`).first<{ first_date: string | null }>(),
    db.prepare(`SELECT MIN(collection_date) AS first_date FROM historical_term_deposit_rates`).first<{ first_date: string | null }>(),
  ])

  return {
    mortgage: trimOrNull(mortgage?.first_date),
    savings: trimOrNull(savings?.first_date),
    term_deposits: trimOrNull(td?.first_date),
  }
}

export async function setDatasetCoverageState(
  db: D1Database,
  input: {
    dataset: CoverageDataset
    firstCoverageDate: string | null
    cursorDate: string | null
    status: CoverageStatus
    lastTickStatus?: string | null
    lastTickRunId?: string | null
    lastTickMessage?: string | null
  },
): Promise<void> {
  await ensureDatasetCoverageRows(db)
  const updatedAt = nowIso()
  await db
    .prepare(
      `UPDATE dataset_coverage_progress
       SET first_coverage_date = ?1,
           cursor_date = ?2,
           status = ?3,
           last_tick_at = ?4,
           last_tick_status = ?5,
           last_tick_run_id = ?6,
           last_tick_message = ?7,
           updated_at = ?4
       WHERE dataset_key = ?8`,
    )
    .bind(
      input.firstCoverageDate,
      input.cursorDate,
      input.status,
      updatedAt,
      input.lastTickStatus ?? null,
      input.lastTickRunId ?? null,
      input.lastTickMessage ?? null,
      input.dataset,
    )
    .run()
}

export async function recordDatasetCoverageRunOutcome(
  db: D1Database,
  input: {
    dataset: CoverageDataset
    runId: string
    runStatus: 'completed' | 'partial' | 'failed'
    rowsWritten: number
    message?: string | null
  },
): Promise<boolean> {
  const existing = await getDatasetCoverageProgressRow(db, input.dataset)
  if (!existing) return false
  if (existing.last_result_run_id && existing.last_result_run_id === input.runId) {
    return false
  }

  const written = Math.max(0, Math.floor(Number(input.rowsWritten) || 0))
  const nextEmptyStreak = written > 0 ? 0 : existing.empty_streak + 1
  const tickStatus =
    input.runStatus === 'failed'
      ? 'task_failed'
      : written > 0
        ? 'completed_with_rows'
        : 'completed_empty'
  const defaultMessage =
    input.runStatus === 'failed'
      ? 'Historical task run failed.'
      : written > 0
        ? `Historical task run completed with ${written} rows.`
        : 'Historical task run completed with zero rows.'
  const updatedAt = nowIso()

  await db
    .prepare(
      `UPDATE dataset_coverage_progress
       SET empty_streak = ?1,
           last_tick_at = ?2,
           last_tick_status = ?3,
           last_tick_run_id = ?4,
           last_tick_message = ?5,
           last_result_run_id = ?4,
           updated_at = ?2
       WHERE dataset_key = ?6`,
    )
    .bind(nextEmptyStreak, updatedAt, tickStatus, input.runId, input.message ?? defaultMessage, input.dataset)
    .run()

  return true
}
