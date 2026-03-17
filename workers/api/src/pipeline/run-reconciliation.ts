import { deriveTerminalRunStatus, loadRunInvariantSummary, type SummaryTotals } from '../db/run-terminal-state'
import { finalizePresenceForRun } from '../db/presence-finalize'
import { tryMarkLenderDatasetFinalized } from '../db/lender-dataset-runs'
import { isLenderDatasetReadyForFinalization } from '../utils/lender-dataset-invariants'
import { nowIso } from '../utils/time'
import { log } from '../utils/logger'

export { deriveTerminalRunStatus } from '../db/run-terminal-state'

/** After this many minutes unfinalized, lender_dataset_runs are force-closed so they stop causing reconciliation stall. */
const STALE_UNFINALIZED_MINUTES = 6 * 60

type ReconciliationOptions = {
  dryRun?: boolean
  idleMinutes?: number
  staleRunMinutes?: number
  staleUnfinalizedMinutes?: number
  maxRows?: number
}

type LenderDatasetFinalizeCandidate = {
  run_id: string
  lender_code: string
  dataset_kind: 'home_loans' | 'savings' | 'term_deposits'
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

type StaleRunningRun = {
  run_id: string
  started_at: string
  finished_at: string | null
  per_lender_json: string
  errors_json: string
}

export type ReadyFinalizationReconciliation = {
  cutoff_iso: string
  idle_minutes: number
  scanned_rows: number
  finalized_rows: number
  skipped_rows: number
  errors: string[]
  dry_run: boolean
  pass_count?: number
  passes?: Array<ReadyFinalizationReconciliation & { pass: number }>
  stopped_reason?: 'dry_run' | 'exhausted' | 'max_passes'
  stalled?: boolean
}

export type StaleRunClosureReconciliation = {
  cutoff_iso: string
  stale_minutes: number
  scanned_runs: number
  closed_runs: number
  /** Runs closed because they did not complete by 23:59 on their start day. */
  abandoned_eod: number
  status_breakdown: {
    ok: number
    partial: number
  }
  errors: string[]
  dry_run: boolean
}

export type StaleUnfinalizedClosureReconciliation = {
  cutoff_iso: string
  stale_minutes: number
  scanned_rows: number
  force_closed_rows: number
  errors: string[]
  dry_run: boolean
}

export type RunLifecycleReconciliationResult = {
  checked_at: string
  duration_ms: number
  dry_run: boolean
  stale_unfinalized: StaleUnfinalizedClosureReconciliation
  ready_finalizations: ReadyFinalizationReconciliation
  stale_runs: StaleRunClosureReconciliation
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function asSummaryTotals(rawSummary: string | null | undefined): SummaryTotals {
  const parsed = parseJson<Record<string, unknown>>(rawSummary, {})
  const meta = parsed._meta as Record<string, unknown> | undefined
  return {
    enqueuedTotal: Number(meta?.enqueued_total) || 0,
    processedTotal: Number(meta?.processed_total) || 0,
    failedTotal: Number(meta?.failed_total) || 0,
  }
}

function cutoffIso(minutes: number): string {
  return new Date(Date.now() - Math.max(1, minutes) * 60 * 1000).toISOString()
}

/** True if now is past 23:59 on the calendar day of started_at (UTC). Used for same-day abandonment. */
function isPastEndOfStartDay(startedAtIso: string): boolean {
  const s = String(startedAtIso || '').trim()
  if (!s) return false
  const day = s.slice(0, 10)
  const endOfDay = `${day}T23:59:59.999Z`
  return new Date().toISOString() > endOfDay
}

type UnfinalizedLenderDatasetRow = {
  run_id: string
  lender_code: string
  dataset_kind: 'home_loans' | 'savings' | 'term_deposits'
  bank_name: string
  collection_date: string
}

/**
 * Force-finalize all unfinalized lender_dataset_runs for a run (retain as much info as possible when abandoning).
 */
async function forceFinalizeAllUnfinalizedForRun(
  db: D1Database,
  runId: string,
): Promise<{ finalized: number; errors: string[] }> {
  const errors: string[] = []
  let finalized = 0
  const rows = await db
    .prepare(
      `SELECT run_id, lender_code, dataset_kind, bank_name, collection_date
       FROM lender_dataset_runs
       WHERE run_id = ?1 AND finalized_at IS NULL`,
    )
    .bind(runId)
    .all<UnfinalizedLenderDatasetRow>()

  for (const row of rows.results ?? []) {
    try {
      await finalizePresenceForRun(db, {
        runId: row.run_id,
        lenderCode: row.lender_code,
        dataset: row.dataset_kind,
        bankName: row.bank_name,
        collectionDate: row.collection_date,
      })
    } catch (e) {
      pushError(errors, `${row.lender_code}:${row.dataset_kind}:presence:${(e as Error)?.message || String(e)}`)
    }
    try {
      const updated = await tryMarkLenderDatasetFinalized(db, {
        runId: row.run_id,
        lenderCode: row.lender_code,
        dataset: row.dataset_kind,
      })
      if (updated) finalized += 1
    } catch (e) {
      pushError(errors, `${row.lender_code}:${row.dataset_kind}:mark:${(e as Error)?.message || String(e)}`)
    }
  }
  return { finalized, errors }
}

function pushError(target: string[], value: string): void {
  target.push(value)
  if (target.length > 20) {
    target.shift()
  }
}

function isTransientDbError(error: unknown): boolean {
  const message = ((error as Error)?.message || String(error)).toLowerCase()
  return (
    message.includes('d1_error') ||
    message.includes('sqlite_busy') ||
    message.includes('database is locked') ||
    message.includes('temporarily unavailable') ||
    message.includes('timed out') ||
    message.includes('timeout')
  )
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function runWithTransientRetry<T>(task: () => Promise<T>): Promise<T> {
  const maxAttempts = 3
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (!isTransientDbError(error) || attempt >= maxAttempts) break
      await sleep(50 * attempt)
    }
  }
  throw lastError
}

export async function reconcileReadyFinalizations(
  db: D1Database,
  options?: { dryRun?: boolean; idleMinutes?: number; maxRows?: number },
): Promise<ReadyFinalizationReconciliation> {
  const dryRun = Boolean(options?.dryRun)
  const idleMinutes = Math.max(1, Math.floor(Number(options?.idleMinutes) || 5))
  const maxRows = Math.max(1, Math.min(5000, Math.floor(Number(options?.maxRows) || 2000)))
  const cutoff = cutoffIso(idleMinutes)
  const errors: string[] = []
  let finalizedRows = 0
  let skippedRows = 0

  const rows = await db
    .prepare(
      `SELECT
         run_id,
         lender_code,
         dataset_kind,
         bank_name,
         collection_date,
         expected_detail_count,
         index_fetch_succeeded,
         accepted_row_count,
         written_row_count,
         detail_fetch_event_count,
         lineage_error_count,
         completed_detail_count,
         failed_detail_count,
         finalized_at,
         updated_at
       FROM lender_dataset_runs
       WHERE finalized_at IS NULL
         AND updated_at <= ?1
       ORDER BY updated_at ASC
       LIMIT ?2`,
    )
    .bind(cutoff, maxRows)
    .all<LenderDatasetFinalizeCandidate>()

  for (const row of rows.results ?? []) {
    const readiness = isLenderDatasetReadyForFinalization(row)
    if (!readiness.ready) {
      skippedRows += 1
      log.debug('run_reconciliation', 'Skipped unfinalized row (not ready)', {
        runId: row.run_id,
        lenderCode: row.lender_code,
        context: { dataset: row.dataset_kind, reason: readiness.reason ?? 'unknown' },
      })
      continue
    }

    if (dryRun) {
      finalizedRows += 1
      continue
    }

    try {
      const expected = Number(row.expected_detail_count || 0)
      if (expected > 0) {
        await runWithTransientRetry(async () =>
          finalizePresenceForRun(db, {
            runId: row.run_id,
            lenderCode: row.lender_code,
            dataset: row.dataset_kind,
            bankName: row.bank_name,
            collectionDate: row.collection_date,
          }),
        )
      }

      const marked = await runWithTransientRetry(async () =>
        tryMarkLenderDatasetFinalized(db, {
          runId: row.run_id,
          lenderCode: row.lender_code,
          dataset: row.dataset_kind,
        }),
      )
      if (!marked) {
        skippedRows += 1
        continue
      }
      finalizedRows += 1
    } catch (error) {
      skippedRows += 1
      pushError(
        errors,
        `${row.run_id}:${row.lender_code}:${row.dataset_kind}:${(error as Error)?.message || String(error)}`,
      )
    }
  }

  return {
    cutoff_iso: cutoff,
    idle_minutes: idleMinutes,
    scanned_rows: (rows.results ?? []).length,
    finalized_rows: finalizedRows,
    skipped_rows: skippedRows,
    errors,
    dry_run: dryRun,
  }
}

export async function closeStaleRunningRuns(
  db: D1Database,
  options?: { dryRun?: boolean; staleRunMinutes?: number; maxRows?: number },
): Promise<StaleRunClosureReconciliation> {
  const dryRun = Boolean(options?.dryRun)
  const staleMinutes = Math.max(1, Math.floor(Number(options?.staleRunMinutes) || 120))
  const maxRows = Math.max(1, Math.min(5000, Math.floor(Number(options?.maxRows) || 2000)))
  const cutoff = cutoffIso(staleMinutes)
  const errors: string[] = []
  const statusBreakdown = { ok: 0, partial: 0 }
  let closedRuns = 0
  let abandonedEod = 0

  // Select runs that are (a) stale by time, or (b) past 23:59 on their start day (same-day abandonment).
  const rows = await db
    .prepare(
      `SELECT run_id, started_at, finished_at, per_lender_json, errors_json
       FROM run_reports
       WHERE status = 'running'
         AND (
           started_at < ?1
           OR datetime('now') > (strftime('%Y-%m-%d', started_at) || ' 23:59:59')
         )
       ORDER BY started_at ASC
       LIMIT ?2`,
    )
    .bind(cutoff, maxRows)
    .all<StaleRunningRun>()

  for (const row of rows.results ?? []) {
    const totals = asSummaryTotals(row.per_lender_json)
    const invariantSummary = await loadRunInvariantSummary(db, row.run_id)
    const nextStatus = deriveTerminalRunStatus(totals, invariantSummary)
    const reconciliationTime = nowIso()
    const eodAbandon = isPastEndOfStartDay(row.started_at)
    const note = eodAbandon
      ? `[${reconciliationTime}] reconciliation_autoclose: abandoned_run_not_completed_by_2359_same_day` +
        ` started_at=${row.started_at}` +
        ` enqueued=${totals.enqueuedTotal} processed=${totals.processedTotal} failed=${totals.failedTotal}` +
        ` invariant_problem_rows=${invariantSummary.problematic_rows}`
      : `[${reconciliationTime}] reconciliation_autoclose: stale_running_run` +
        ` threshold_minutes=${staleMinutes}` +
        ` enqueued=${totals.enqueuedTotal}` +
        ` processed=${totals.processedTotal}` +
        ` failed=${totals.failedTotal}` +
        ` invariant_problem_rows=${invariantSummary.problematic_rows}` +
        ` started_at=${row.started_at}`

    if (dryRun) {
      closedRuns += 1
      if (eodAbandon) abandonedEod += 1
      statusBreakdown[nextStatus] += 1
      continue
    }

    if (eodAbandon) {
      const { finalized: nFinalized, errors: eodErrors } = await forceFinalizeAllUnfinalizedForRun(db, row.run_id)
      abandonedEod += 1
      if (eodErrors.length > 0) {
        eodErrors.forEach((e) => pushError(errors, `${row.run_id}:${e}`))
      }
      log.info('run_reconciliation', 'Run abandoned past 23:59 same day; force-finalized lender_dataset_runs', {
        runId: row.run_id,
        context: { started_at: row.started_at, finalized_lender_datasets: nFinalized },
      })
    }

    try {
      const errorsJson = parseJson<string[]>(row.errors_json, [])
      errorsJson.push(note)
      const update = await db
        .prepare(
          `UPDATE run_reports
           SET status = ?1,
               finished_at = ?2,
               errors_json = ?3
           WHERE run_id = ?4
             AND status = 'running'`,
        )
        .bind(nextStatus, row.finished_at || reconciliationTime, JSON.stringify(errorsJson.slice(-400)), row.run_id)
        .run()

      if (Number(update.meta?.changes ?? 0) > 0) {
        closedRuns += 1
        statusBreakdown[nextStatus] += 1
      }
    } catch (error) {
      pushError(errors, `${row.run_id}:${(error as Error)?.message || String(error)}`)
    }
  }

  return {
    cutoff_iso: cutoff,
    stale_minutes: staleMinutes,
    scanned_runs: (rows.results ?? []).length,
    closed_runs: closedRuns,
    abandoned_eod: abandonedEod,
    status_breakdown: statusBreakdown,
    errors,
    dry_run: dryRun,
  }
}

export type CancelAllRunningRunsResult = {
  cancelled: number
  run_ids: string[]
  errors: string[]
  dry_run: boolean
}

/**
 * Cancel all run_reports that are still status = 'running'. Force-finalizes their unfinalized
 * lender_dataset_runs first to retain as much info as possible, then marks each run terminal.
 */
export async function cancelAllRunningRuns(
  db: D1Database,
  options?: { dryRun?: boolean },
): Promise<CancelAllRunningRunsResult> {
  const dryRun = Boolean(options?.dryRun)
  const errors: string[] = []
  const runIds: string[] = []
  let cancelled = 0

  const rows = await db
    .prepare(
      `SELECT run_id, started_at, finished_at, per_lender_json, errors_json
       FROM run_reports
       WHERE status = 'running'
       ORDER BY started_at ASC`,
    )
    .all<StaleRunningRun>()

  for (const row of rows.results ?? []) {
    runIds.push(row.run_id)
    const totals = asSummaryTotals(row.per_lender_json)
    const invariantSummary = await loadRunInvariantSummary(db, row.run_id)
    const nextStatus = deriveTerminalRunStatus(totals, invariantSummary)
    const reconciliationTime = nowIso()
    const note =
      `[${reconciliationTime}] cancelled: admin_cancel_all_running` +
      ` enqueued=${totals.enqueuedTotal} processed=${totals.processedTotal} failed=${totals.failedTotal}` +
      ` invariant_problem_rows=${invariantSummary.problematic_rows} started_at=${row.started_at}`

    if (dryRun) {
      cancelled += 1
      continue
    }

    const { errors: eodErrors } = await forceFinalizeAllUnfinalizedForRun(db, row.run_id)
    if (eodErrors.length > 0) {
      eodErrors.forEach((e) => pushError(errors, `${row.run_id}:${e}`))
    }
    log.info('run_reconciliation', 'Run cancelled (cancel-all-running); force-finalized lender_dataset_runs', {
      runId: row.run_id,
      context: { started_at: row.started_at },
    })

    try {
      const errorsJson = parseJson<string[]>(row.errors_json, [])
      errorsJson.push(note)
      const update = await db
        .prepare(
          `UPDATE run_reports
           SET status = ?1,
               finished_at = ?2,
               errors_json = ?3
           WHERE run_id = ?4
             AND status = 'running'`,
        )
        .bind(nextStatus, row.finished_at || reconciliationTime, JSON.stringify(errorsJson.slice(-400)), row.run_id)
        .run()

      if (Number(update.meta?.changes ?? 0) > 0) {
        cancelled += 1
      }
    } catch (error) {
      pushError(errors, `${row.run_id}:${(error as Error)?.message || String(error)}`)
    }
  }

  return {
    cancelled,
    run_ids: runIds,
    errors,
    dry_run: dryRun,
  }
}

type StaleUnfinalizedRow = {
  run_id: string
  lender_code: string
  dataset_kind: 'home_loans' | 'savings' | 'term_deposits'
  bank_name: string
  collection_date: string
}

/**
 * Force-close lender_dataset_runs that have been unfinalized longer than staleUnfinalizedMinutes.
 * Prevents reconciliation stall when rows never become "ready" (e.g. index_fetch_not_succeeded, failed_detail_fetches).
 */
export async function forceCloseStaleUnfinalizedLenderDatasets(
  db: D1Database,
  options?: { dryRun?: boolean; staleUnfinalizedMinutes?: number; maxRows?: number },
): Promise<StaleUnfinalizedClosureReconciliation> {
  const dryRun = Boolean(options?.dryRun)
  const staleMinutes = Math.max(
    60,
    Math.floor(Number(options?.staleUnfinalizedMinutes) || STALE_UNFINALIZED_MINUTES),
  )
  const maxRows = Math.max(1, Math.min(5000, Math.floor(Number(options?.maxRows) || 500)))
  const cutoff = cutoffIso(staleMinutes)
  const errors: string[] = []
  let forceClosedRows = 0

  const rows = await db
    .prepare(
      `SELECT run_id, lender_code, dataset_kind, bank_name, collection_date
       FROM lender_dataset_runs
       WHERE finalized_at IS NULL
         AND updated_at < ?1
       ORDER BY updated_at ASC
       LIMIT ?2`,
    )
    .bind(cutoff, maxRows)
    .all<StaleUnfinalizedRow>()

  for (const row of rows.results ?? []) {
    if (dryRun) {
      forceClosedRows += 1
      continue
    }
    try {
      await finalizePresenceForRun(db, {
        runId: row.run_id,
        lenderCode: row.lender_code,
        dataset: row.dataset_kind,
        bankName: row.bank_name,
        collectionDate: row.collection_date,
      })
    } catch (presenceError) {
      pushError(
        errors,
        `${row.run_id}:${row.lender_code}:${row.dataset_kind}:presence:${(presenceError as Error)?.message || String(presenceError)}`,
      )
    }
    try {
      const updated = await tryMarkLenderDatasetFinalized(db, {
        runId: row.run_id,
        lenderCode: row.lender_code,
        dataset: row.dataset_kind,
      })
      if (updated) {
        forceClosedRows += 1
        log.info('run_reconciliation', 'Stale unfinalized lender_dataset force-closed', {
          runId: row.run_id,
          lenderCode: row.lender_code,
          context: { dataset: row.dataset_kind, updated_at_cutoff: cutoff },
        })
      }
    } catch (markError) {
      pushError(
        errors,
        `${row.run_id}:${row.lender_code}:${row.dataset_kind}:mark:${(markError as Error)?.message || String(markError)}`,
      )
    }
  }

  return {
    cutoff_iso: cutoff,
    stale_minutes: staleMinutes,
    scanned_rows: (rows.results ?? []).length,
    force_closed_rows: forceClosedRows,
    errors,
    dry_run: dryRun,
  }
}

export async function runLifecycleReconciliation(
  db: D1Database,
  options?: ReconciliationOptions,
): Promise<RunLifecycleReconciliationResult> {
  const startedAt = Date.now()
  const dryRun = Boolean(options?.dryRun)
  const checkedAt = nowIso()

  // 1. Close run_reports stuck in 'running' so they do not linger indefinitely.
  const staleRuns = await closeStaleRunningRuns(db, {
    dryRun,
    staleRunMinutes: options?.staleRunMinutes,
    maxRows: options?.maxRows,
  })

  // 2. Force-close lender_dataset_runs that have been unfinalized too long (prevents reconciliation stall).
  const staleUnfinalized = await forceCloseStaleUnfinalizedLenderDatasets(db, {
    dryRun,
    staleUnfinalizedMinutes: options?.staleUnfinalizedMinutes,
    maxRows: options?.maxRows,
  })

  // 3. Normal finalization for rows that are ready (idle past cutoff).
  const maxPasses = dryRun ? 1 : 10
  const readyPasses: Array<ReadyFinalizationReconciliation & { pass: number }> = []
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const result = await reconcileReadyFinalizations(db, {
      dryRun,
      idleMinutes: options?.idleMinutes,
      maxRows: options?.maxRows,
    })
    readyPasses.push({
      ...result,
      pass,
    })
    if (dryRun || result.scanned_rows === 0) {
      break
    }
  }

  const readyFinalizations: ReadyFinalizationReconciliation = {
    cutoff_iso: readyPasses[readyPasses.length - 1]?.cutoff_iso || checkedAt,
    idle_minutes: readyPasses[0]?.idle_minutes || Math.max(1, Math.floor(Number(options?.idleMinutes) || 5)),
    scanned_rows: readyPasses.reduce((sum, pass) => sum + pass.scanned_rows, 0),
    finalized_rows: readyPasses.reduce((sum, pass) => sum + pass.finalized_rows, 0),
    skipped_rows: readyPasses.reduce((sum, pass) => sum + pass.skipped_rows, 0),
    errors: readyPasses.flatMap((pass) => pass.errors).slice(-20),
    dry_run: dryRun,
    pass_count: readyPasses.length,
    passes: readyPasses,
    stopped_reason: dryRun
      ? 'dry_run'
      : readyPasses[readyPasses.length - 1]?.scanned_rows === 0
        ? 'exhausted'
        : 'max_passes',
    stalled:
      !dryRun &&
      readyPasses.reduce((sum, pass) => sum + pass.scanned_rows, 0) > 0 &&
      readyPasses.reduce((sum, pass) => sum + pass.finalized_rows, 0) === 0,
  }

  return {
    checked_at: checkedAt,
    duration_ms: Date.now() - startedAt,
    dry_run: dryRun,
    stale_unfinalized: staleUnfinalized,
    ready_finalizations: readyFinalizations,
    stale_runs: staleRuns,
  }
}
