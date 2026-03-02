import { nowIso } from '../../utils/time'
import type { HistoricalProductScope } from '../../types'
import { listDatesInclusive } from './dates'
import { deriveRunStatus, getTaskCounters } from './stats'
import { getHistoricalRunById, getHistoricalTaskById } from './reads'
import type { HistoricalRunRow, HistoricalTaskRow, HistoricalTriggerSource } from './types'

export async function createHistoricalRunWithTasks(
  db: D1Database,
  input: {
    runId: string
    triggerSource: HistoricalTriggerSource
    requestedBy?: string | null
    startDate: string
    endDate: string
    lenderCodes: string[]
    productScope?: HistoricalProductScope
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
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?7, 0, 0, 0, 0, 0, 0, ?8, ?9, ?9)`,
    )
    .bind(
      input.runId,
      input.triggerSource,
      input.productScope ?? 'all',
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

export async function claimHistoricalTaskById(
  db: D1Database,
  input: {
    runId: string
    taskId: number
    workerId: string
    claimTtlSeconds: number
  },
): Promise<HistoricalTaskRow | null> {
  const now = nowIso()
  const expiresAt = new Date(Date.now() + Math.max(30, input.claimTtlSeconds) * 1000).toISOString()

  const result = await db
    .prepare(
      `UPDATE client_historical_tasks
       SET status = 'claimed',
           claimed_by = ?1,
           claimed_at = ?2,
           claim_expires_at = ?3,
           attempt_count = attempt_count + CASE WHEN status = 'pending' THEN 1 ELSE 0 END,
           updated_at = ?2
       WHERE task_id = ?4
         AND run_id = ?5
         AND (
           status = 'pending'
           OR (status = 'claimed' AND claimed_by = ?1)
           OR (status = 'claimed' AND claim_expires_at IS NOT NULL AND claim_expires_at <= ?2)
         )`,
    )
    .bind(input.workerId, now, expiresAt, input.taskId, input.runId)
    .run()

  if (Number(result.meta?.changes ?? 0) <= 0) {
    return null
  }

  await refreshHistoricalRunStats(db, input.runId)
  return getHistoricalTaskById(db, input.taskId)
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

export async function markHistoricalRunFailed(db: D1Database, runId: string, message?: string | null): Promise<void> {
  const now = nowIso()
  await db
    .prepare(
      `UPDATE client_historical_runs
       SET status = 'failed',
           finished_at = ?1,
           updated_at = ?1
       WHERE run_id = ?2`,
    )
    .bind(now, runId)
    .run()

  if (message) {
    await db
      .prepare(
        `UPDATE client_historical_tasks
         SET status = CASE WHEN status = 'completed' THEN status ELSE 'failed' END,
             last_error = COALESCE(last_error, ?1),
             updated_at = ?2
         WHERE run_id = ?3`,
      )
      .bind(String(message).slice(0, 2000), now, runId)
      .run()
  }

  await refreshHistoricalRunStats(db, runId)
}
