import { finalizePresenceForRun } from '../db/presence-finalize'
import { tryMarkLenderDatasetFinalized } from '../db/lender-dataset-runs'
import { nowIso } from '../utils/time'

type ReconciliationOptions = {
  dryRun?: boolean
  idleMinutes?: number
  staleRunMinutes?: number
  maxRows?: number
}

type LenderDatasetFinalizeCandidate = {
  run_id: string
  lender_code: string
  dataset_kind: 'home_loans' | 'savings' | 'term_deposits'
  bank_name: string
  collection_date: string
  expected_detail_count: number
  completed_detail_count: number
  failed_detail_count: number
  updated_at: string
}

type StaleRunningRun = {
  run_id: string
  started_at: string
  finished_at: string | null
  per_lender_json: string
  errors_json: string
}

type SummaryTotals = {
  enqueuedTotal: number
  processedTotal: number
  failedTotal: number
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
  status_breakdown: {
    ok: number
    partial: number
  }
  errors: string[]
  dry_run: boolean
}

export type RunLifecycleReconciliationResult = {
  checked_at: string
  duration_ms: number
  dry_run: boolean
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

export function deriveTerminalRunStatus(totals: SummaryTotals): 'ok' | 'partial' {
  const completedTotal = totals.processedTotal + totals.failedTotal
  if (totals.enqueuedTotal > 0 && completedTotal >= totals.enqueuedTotal) {
    return totals.failedTotal > 0 ? 'partial' : 'ok'
  }
  return 'partial'
}

function cutoffIso(minutes: number): string {
  return new Date(Date.now() - Math.max(1, minutes) * 60 * 1000).toISOString()
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
         completed_detail_count,
         failed_detail_count,
         updated_at
       FROM lender_dataset_runs
       WHERE finalized_at IS NULL
         AND (
           expected_detail_count <= 0
           OR (completed_detail_count + failed_detail_count) >= expected_detail_count
         )
         AND updated_at <= ?1
       ORDER BY updated_at ASC
       LIMIT ?2`,
    )
    .bind(cutoff, maxRows)
    .all<LenderDatasetFinalizeCandidate>()

  for (const row of rows.results ?? []) {
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

  const rows = await db
    .prepare(
      `SELECT run_id, started_at, finished_at, per_lender_json, errors_json
       FROM run_reports
       WHERE status = 'running'
         AND started_at < ?1
       ORDER BY started_at ASC
       LIMIT ?2`,
    )
    .bind(cutoff, maxRows)
    .all<StaleRunningRun>()

  for (const row of rows.results ?? []) {
    const totals = asSummaryTotals(row.per_lender_json)
    const nextStatus = deriveTerminalRunStatus(totals)
    const reconciliationTime = nowIso()
    const note =
      `[${reconciliationTime}] reconciliation_autoclose: stale_running_run` +
      ` threshold_minutes=${staleMinutes}` +
      ` enqueued=${totals.enqueuedTotal}` +
      ` processed=${totals.processedTotal}` +
      ` failed=${totals.failedTotal}` +
      ` started_at=${row.started_at}`

    if (dryRun) {
      closedRuns += 1
      statusBreakdown[nextStatus] += 1
      continue
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
    status_breakdown: statusBreakdown,
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
  const staleRuns = await closeStaleRunningRuns(db, {
    dryRun,
    staleRunMinutes: options?.staleRunMinutes,
    maxRows: options?.maxRows,
  })

  return {
    checked_at: checkedAt,
    duration_ms: Date.now() - startedAt,
    dry_run: dryRun,
    ready_finalizations: readyFinalizations,
    stale_runs: staleRuns,
  }
}
