import type { HistoricalRunDetail, HistoricalRunRow, HistoricalTaskRow, HistoricalTriggerSource } from './types'
import { toProgressPct } from './stats'

export async function getHistoricalRunById(db: D1Database, runId: string): Promise<HistoricalRunRow | null> {
  return (
    (await db
      .prepare(
        `SELECT
           run_id, trigger_source, product_scope, run_source, start_date, end_date, status,
           total_tasks, pending_tasks, claimed_tasks, completed_tasks, failed_tasks,
           mortgage_rows, savings_rows, td_rows, requested_by, created_at, updated_at,
           started_at, finished_at
         FROM client_historical_runs
         WHERE run_id = ?1`,
      )
      .bind(runId)
      .first<HistoricalRunRow>()) ?? null
  )
}

export async function getHistoricalTaskById(db: D1Database, taskId: number): Promise<HistoricalTaskRow | null> {
  return (
    (await db
      .prepare(
        `SELECT
           task_id, run_id, lender_code, collection_date, status, claimed_by, claimed_at, claim_expires_at,
           completed_at, attempt_count, mortgage_rows, savings_rows, td_rows, had_signals, last_error, updated_at
         FROM client_historical_tasks
         WHERE task_id = ?1`,
      )
      .bind(taskId)
      .first<HistoricalTaskRow>()) ?? null
  )
}

export async function listHistoricalTaskIds(db: D1Database, runId: string): Promise<number[]> {
  const rows = await db
    .prepare(
      `SELECT task_id
       FROM client_historical_tasks
       WHERE run_id = ?1
       ORDER BY task_id ASC`,
    )
    .bind(runId)
    .all<{ task_id: number }>()
  return (rows.results ?? []).map((row) => Number(row.task_id)).filter((taskId) => Number.isFinite(taskId))
}

export async function findActiveHistoricalRun(
  db: D1Database,
  triggerSource: HistoricalTriggerSource,
): Promise<HistoricalRunRow | null> {
  return (
    (await db
      .prepare(
        `SELECT
           run_id, trigger_source, product_scope, run_source, start_date, end_date, status,
           total_tasks, pending_tasks, claimed_tasks, completed_tasks, failed_tasks,
           mortgage_rows, savings_rows, td_rows, requested_by, created_at, updated_at,
           started_at, finished_at
         FROM client_historical_runs
         WHERE trigger_source = ?1 AND status IN ('pending', 'running')
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(triggerSource)
      .first<HistoricalRunRow>()) ?? null
  )
}

export async function getLastHistoricalRunCreatedAt(
  db: D1Database,
  triggerSource: HistoricalTriggerSource,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT created_at
       FROM client_historical_runs
       WHERE trigger_source = ?1
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(triggerSource)
    .first<{ created_at: string }>()
  return row?.created_at ?? null
}

export async function getHistoricalRunDetail(
  db: D1Database,
  runId: string,
  taskLimit = 30,
): Promise<HistoricalRunDetail | null> {
  const run = await getHistoricalRunById(db, runId)
  if (!run) return null

  const tasks = await db
    .prepare(
      `SELECT
         task_id, run_id, lender_code, collection_date, status, claimed_by, claimed_at, claim_expires_at,
         completed_at, attempt_count, mortgage_rows, savings_rows, td_rows, had_signals, last_error, updated_at
       FROM client_historical_tasks
       WHERE run_id = ?1
       ORDER BY collection_date DESC, lender_code ASC
       LIMIT ?2`,
    )
    .bind(runId, Math.max(1, Math.min(200, Math.floor(taskLimit))))
    .all<HistoricalTaskRow>()

  const rowsTotal = Math.max(0, run.mortgage_rows) + Math.max(0, run.savings_rows) + Math.max(0, run.td_rows)
  const progressPct = toProgressPct(run.completed_tasks, run.failed_tasks, run.total_tasks)

  return {
    run,
    progress_pct: progressPct,
    rows_total: rowsTotal,
    tasks_recent: tasks.results ?? [],
  }
}
