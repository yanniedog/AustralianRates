import { nowIso } from '../utils/time'

export type HistoricalTriggerSource = 'public' | 'admin'
export type HistoricalRunStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed'
export type HistoricalTaskStatus = 'pending' | 'claimed' | 'completed' | 'failed'

export type HistoricalRunRow = {
  run_id: string
  trigger_source: HistoricalTriggerSource
  product_scope: string
  run_source: 'scheduled' | 'manual'
  start_date: string
  end_date: string
  status: HistoricalRunStatus
  total_tasks: number
  pending_tasks: number
  claimed_tasks: number
  completed_tasks: number
  failed_tasks: number
  mortgage_rows: number
  savings_rows: number
  td_rows: number
  requested_by: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
}

export type HistoricalTaskRow = {
  task_id: number
  run_id: string
  lender_code: string
  collection_date: string
  status: HistoricalTaskStatus
  claimed_by: string | null
  claimed_at: string | null
  claim_expires_at: string | null
  completed_at: string | null
  attempt_count: number
  mortgage_rows: number
  savings_rows: number
  td_rows: number
  had_signals: number
  last_error: string | null
  updated_at: string
}

export type HistoricalRunDetail = {
  run: HistoricalRunRow
  progress_pct: number
  rows_total: number
  tasks_recent: HistoricalTaskRow[]
}

function parseDateOnly(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  if (!start || !end || end < start) return 0
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
}

function listDatesInclusive(startDate: string, endDate: string): string[] {
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  if (!start || !end || end < start) return []
  const out: string[] = []
  const cursor = new Date(start.getTime())
  while (cursor <= end) {
    out.push(formatDateOnly(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

function asInt(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

function toProgressPct(completed: number, failed: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round(((completed + failed) / total) * 1000) / 10))
}

function deriveRunStatus(counts: {
  total: number
  pending: number
  claimed: number
  completed: number
  failed: number
}): HistoricalRunStatus {
  if (counts.total <= 0) return 'failed'
  if (counts.pending > 0 || counts.claimed > 0) {
    return counts.claimed > 0 || counts.completed > 0 || counts.failed > 0 ? 'running' : 'pending'
  }
  if (counts.failed > 0 && counts.completed > 0) return 'partial'
  if (counts.failed > 0) return 'failed'
  return 'completed'
}

async function getTaskCounters(db: D1Database, runId: string): Promise<{
  total: number
  pending: number
  claimed: number
  completed: number
  failed: number
  mortgageRows: number
  savingsRows: number
  tdRows: number
}> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(mortgage_rows) AS mortgage_rows,
         SUM(savings_rows) AS savings_rows,
         SUM(td_rows) AS td_rows
       FROM client_historical_tasks
       WHERE run_id = ?1`,
    )
    .bind(runId)
    .first<Record<string, unknown>>()

  return {
    total: asInt(row?.total),
    pending: asInt(row?.pending),
    claimed: asInt(row?.claimed),
    completed: asInt(row?.completed),
    failed: asInt(row?.failed),
    mortgageRows: asInt(row?.mortgage_rows),
    savingsRows: asInt(row?.savings_rows),
    tdRows: asInt(row?.td_rows),
  }
}

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

export async function createHistoricalRunWithTasks(
  db: D1Database,
  input: {
    runId: string
    triggerSource: HistoricalTriggerSource
    requestedBy?: string | null
    startDate: string
    endDate: string
    lenderCodes: string[]
    runSource?: 'scheduled' | 'manual'
  },
): Promise<{ run: HistoricalRunRow; tasksCreated: number }> {
  const dates = listDatesInclusive(input.startDate, input.endDate)
  const lenders = Array.from(new Set(input.lenderCodes.map((x) => String(x || '').trim()).filter(Boolean)))
  const now = nowIso()
  const totalTasks = dates.length * lenders.length

  await db
    .prepare(
      `INSERT INTO client_historical_runs (
         run_id, trigger_source, product_scope, run_source, start_date, end_date, status,
         total_tasks, pending_tasks, claimed_tasks, completed_tasks, failed_tasks,
         mortgage_rows, savings_rows, td_rows, requested_by, created_at, updated_at
       ) VALUES (?1, ?2, 'all', ?3, ?4, ?5, 'pending', ?6, ?6, 0, 0, 0, 0, 0, 0, ?7, ?8, ?8)`,
    )
    .bind(
      input.runId,
      input.triggerSource,
      input.runSource ?? 'manual',
      input.startDate,
      input.endDate,
      totalTasks,
      input.requestedBy ?? null,
      now,
    )
    .run()

  for (const lenderCode of lenders) {
    for (const collectionDate of dates) {
      await db
        .prepare(
          `INSERT INTO client_historical_tasks (
             run_id, lender_code, collection_date, status, updated_at
           ) VALUES (?1, ?2, ?3, 'pending', ?4)`,
        )
        .bind(input.runId, lenderCode, collectionDate, now)
        .run()
    }
  }

  const run = await getHistoricalRunById(db, input.runId)
  if (!run) {
    throw new Error(`historical_run_create_failed:${input.runId}`)
  }

  return { run, tasksCreated: totalTasks }
}

export async function refreshHistoricalRunStats(db: D1Database, runId: string): Promise<HistoricalRunRow | null> {
  const existing = await getHistoricalRunById(db, runId)
  if (!existing) return null

  const counters = await getTaskCounters(db, runId)
  const status = deriveRunStatus({
    total: counters.total,
    pending: counters.pending,
    claimed: counters.claimed,
    completed: counters.completed,
    failed: counters.failed,
  })
  const now = nowIso()
  const startedAt = existing.started_at || (status === 'running' || status === 'completed' || status === 'partial' || status === 'failed' ? now : null)
  const finishedAt = status === 'completed' || status === 'partial' || status === 'failed' ? now : null

  await db
    .prepare(
      `UPDATE client_historical_runs
       SET status = ?1,
           total_tasks = ?2,
           pending_tasks = ?3,
           claimed_tasks = ?4,
           completed_tasks = ?5,
           failed_tasks = ?6,
           mortgage_rows = ?7,
           savings_rows = ?8,
           td_rows = ?9,
           started_at = ?10,
           finished_at = ?11,
           updated_at = ?12
       WHERE run_id = ?13`,
    )
    .bind(
      status,
      counters.total,
      counters.pending,
      counters.claimed,
      counters.completed,
      counters.failed,
      counters.mortgageRows,
      counters.savingsRows,
      counters.tdRows,
      startedAt,
      finishedAt,
      now,
      runId,
    )
    .run()

  return getHistoricalRunById(db, runId)
}

export async function claimHistoricalTask(
  db: D1Database,
  input: {
    runId: string
    workerId: string
    claimTtlSeconds: number
  },
): Promise<HistoricalTaskRow | null> {
  const now = nowIso()
  const expiresAt = new Date(Date.now() + Math.max(30, input.claimTtlSeconds) * 1000).toISOString()

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = await db
      .prepare(
        `SELECT
           task_id, run_id, lender_code, collection_date, status, claimed_by, claimed_at, claim_expires_at,
           completed_at, attempt_count, mortgage_rows, savings_rows, td_rows, had_signals, last_error, updated_at
         FROM client_historical_tasks
         WHERE run_id = ?1
           AND (
             status = 'pending'
             OR (status = 'claimed' AND claim_expires_at IS NOT NULL AND claim_expires_at <= ?2)
           )
         ORDER BY collection_date DESC, lender_code ASC
         LIMIT 1`,
      )
      .bind(input.runId, now)
      .first<HistoricalTaskRow>()

    if (!candidate) {
      await refreshHistoricalRunStats(db, input.runId)
      return null
    }

    const claimed = await db
      .prepare(
        `UPDATE client_historical_tasks
         SET status = 'claimed',
             claimed_by = ?1,
             claimed_at = ?2,
             claim_expires_at = ?3,
             attempt_count = attempt_count + 1,
             updated_at = ?2
         WHERE task_id = ?4
           AND run_id = ?5
           AND (
             status = 'pending'
             OR (status = 'claimed' AND claim_expires_at IS NOT NULL AND claim_expires_at <= ?2)
           )`,
      )
      .bind(input.workerId, now, expiresAt, candidate.task_id, input.runId)
      .run()

    if (Number(claimed.meta?.changes ?? 0) > 0) {
      await refreshHistoricalRunStats(db, input.runId)
      return getHistoricalTaskById(db, candidate.task_id)
    }
  }

  return null
}

export async function registerHistoricalBatch(
  db: D1Database,
  input: {
    batchId: string
    runId: string
    taskId: number
    workerId: string | null
    payloadHash: string
    rowCount: number
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO client_historical_batches (
         batch_id, run_id, task_id, worker_id, payload_hash, row_count, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(batch_id) DO NOTHING`,
    )
    .bind(input.batchId, input.runId, input.taskId, input.workerId, input.payloadHash, Math.max(0, input.rowCount), nowIso())
    .run()
  return Number(result.meta?.changes ?? 0) > 0
}

export async function addHistoricalTaskBatchCounts(
  db: D1Database,
  input: {
    taskId: number
    runId: string
    mortgageRows: number
    savingsRows: number
    tdRows: number
    hadSignals: boolean
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE client_historical_tasks
       SET mortgage_rows = mortgage_rows + ?1,
           savings_rows = savings_rows + ?2,
           td_rows = td_rows + ?3,
           had_signals = CASE WHEN had_signals = 1 OR ?4 = 1 THEN 1 ELSE 0 END,
           updated_at = ?5
       WHERE task_id = ?6
         AND run_id = ?7`,
    )
    .bind(
      Math.max(0, input.mortgageRows),
      Math.max(0, input.savingsRows),
      Math.max(0, input.tdRows),
      input.hadSignals ? 1 : 0,
      nowIso(),
      input.taskId,
      input.runId,
    )
    .run()
}

export async function finalizeHistoricalTask(
  db: D1Database,
  input: {
    taskId: number
    runId: string
    workerId?: string | null
    status: 'completed' | 'failed'
    lastError?: string | null
    hadSignals?: boolean
  },
): Promise<HistoricalTaskRow | null> {
  const now = nowIso()
  const status = input.status
  const lastError = input.lastError ? String(input.lastError).slice(0, 2000) : null

  const result = await db
    .prepare(
      `UPDATE client_historical_tasks
       SET status = ?1,
           completed_at = ?2,
           claim_expires_at = NULL,
           had_signals = CASE WHEN had_signals = 1 OR ?3 = 1 THEN 1 ELSE 0 END,
           last_error = ?4,
           updated_at = ?2
       WHERE task_id = ?5
         AND run_id = ?6
         AND status IN ('claimed', ?1)
         AND (?7 IS NULL OR claimed_by = ?7 OR claimed_by IS NULL)`,
    )
    .bind(status, now, input.hadSignals ? 1 : 0, lastError, input.taskId, input.runId, input.workerId ?? null)
    .run()

  if (Number(result.meta?.changes ?? 0) > 0) {
    await refreshHistoricalRunStats(db, input.runId)
  }

  return getHistoricalTaskById(db, input.taskId)
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
