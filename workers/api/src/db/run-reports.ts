import { deriveTerminalRunStatus, loadRunInvariantSummary } from './run-terminal-state'
import type { RunReportRow, RunSource, RunStatus, RunType } from '../types'
import { nowIso } from '../utils/time'

type LenderProgress = {
  enqueued: number
  processed: number
  failed: number
  last_error?: string
  updated_at: string
}

type PerLenderSummary = {
  _meta: {
    enqueued_total: number
    processed_total: number
    failed_total: number
    updated_at: string
  }
  [lenderCode: string]: unknown
}

function jsonPathForKey(key: string): string {
  return `$."${String(key).replace(/"/g, '\\"')}"`
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    if (!raw) {
      return fallback
    }
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function asPerLenderSummary(input: unknown): PerLenderSummary {
  const now = nowIso()
  if (!input || typeof input !== 'object') {
    return {
      _meta: {
        enqueued_total: 0,
        processed_total: 0,
        failed_total: 0,
        updated_at: now,
      },
    }
  }

  const raw = input as Record<string, unknown>
  const rawMeta = (raw._meta as Record<string, unknown> | undefined) || {}

  return {
    ...raw,
    _meta: {
      enqueued_total: Number(rawMeta.enqueued_total) || 0,
      processed_total: Number(rawMeta.processed_total) || 0,
      failed_total: Number(rawMeta.failed_total) || 0,
      updated_at: String(rawMeta.updated_at || now),
    },
  }
}

function summaryTotals(input: PerLenderSummary): { enqueuedTotal: number; processedTotal: number; failedTotal: number } {
  return {
    enqueuedTotal: input._meta.enqueued_total,
    processedTotal: input._meta.processed_total,
    failedTotal: input._meta.failed_total,
  }
}

async function refreshRunTerminalState(db: D1Database, row: RunReportRow | null): Promise<RunReportRow | null> {
  if (!row) return null

  const summary = asPerLenderSummary(parseJson<Record<string, unknown>>(row.per_lender_json, {}))
  const totals = summaryTotals(summary)
  const completedTotal = totals.processedTotal + totals.failedTotal
  const terminalReached = totals.enqueuedTotal > 0 && completedTotal >= totals.enqueuedTotal
  if (!terminalReached) {
    return row
  }

  const invariantSummary = await loadRunInvariantSummary(db, row.run_id)
  const nextStatus = deriveTerminalRunStatus(totals, invariantSummary)
  const finishedAt = row.finished_at || nowIso()

  if (row.status !== nextStatus || row.finished_at !== finishedAt) {
    await db
      .prepare(
        `UPDATE run_reports
         SET status = ?1,
             finished_at = ?2
         WHERE run_id = ?3`,
      )
      .bind(nextStatus, finishedAt, row.run_id)
      .run()
  }

  return getRunReport(db, row.run_id)
}

export function buildInitialPerLenderSummary(perLenderEnqueued: Record<string, number>): PerLenderSummary {
  const now = nowIso()
  const entries = Object.entries(perLenderEnqueued)
  const summary: PerLenderSummary = {
    _meta: {
      enqueued_total: entries.reduce((sum, [, count]) => sum + count, 0),
      processed_total: 0,
      failed_total: 0,
      updated_at: now,
    },
  }

  for (const [lenderCode, count] of entries) {
    summary[lenderCode] = {
      enqueued: count,
      processed: 0,
      failed: 0,
      updated_at: now,
    } satisfies LenderProgress
  }

  return summary
}

export async function getRunReport(db: D1Database, runId: string): Promise<RunReportRow | null> {
  const row = await db
    .prepare(
      `SELECT run_id, run_type, run_source, started_at, finished_at, status, per_lender_json, errors_json
       FROM run_reports
       WHERE run_id = ?1`,
    )
    .bind(runId)
    .first<RunReportRow>()

  return row ?? null
}

export async function listRunReports(db: D1Database, limit = 25): Promise<RunReportRow[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))
  const rows = await db
    .prepare(
      `SELECT run_id, run_type, run_source, started_at, finished_at, status, per_lender_json, errors_json
       FROM run_reports
       ORDER BY started_at DESC
       LIMIT ?1`,
    )
    .bind(safeLimit)
    .all<RunReportRow>()

  return rows.results ?? []
}

export async function createRunReport(
  db: D1Database,
  input: {
    runId: string
    runType: RunType
    runSource?: RunSource
    startedAt?: string
    perLenderSummary?: Record<string, unknown>
  },
): Promise<{ created: boolean; row: RunReportRow }> {
  const startedAt = input.startedAt || nowIso()
  const runSource = input.runSource ?? 'scheduled'
  const perLenderJson = JSON.stringify(
    asPerLenderSummary(input.perLenderSummary || {
      _meta: {
        enqueued_total: 0,
        processed_total: 0,
        failed_total: 0,
        updated_at: startedAt,
      },
    }),
  )

  const insert = await db
    .prepare(
      `INSERT INTO run_reports (run_id, run_type, run_source, started_at, status, per_lender_json, errors_json)
       VALUES (?1, ?2, ?3, ?4, 'running', ?5, '[]')
       ON CONFLICT(run_id) DO NOTHING`,
    )
    .bind(input.runId, input.runType, runSource, startedAt, perLenderJson)
    .run()

  const row = await getRunReport(db, input.runId)
  if (!row) {
    throw new Error(`Failed to load run report after create: ${input.runId}`)
  }

  return {
    created: Number(insert.meta?.changes || 0) > 0,
    row,
  }
}

export async function setRunEnqueuedSummary(
  db: D1Database,
  runId: string,
  perLenderSummary: Record<string, unknown>,
): Promise<RunReportRow | null> {
  const summary = asPerLenderSummary(perLenderSummary)
  summary._meta.updated_at = nowIso()

  await db
    .prepare(
      `UPDATE run_reports
       SET per_lender_json = ?1,
           status = 'running',
           finished_at = NULL
       WHERE run_id = ?2`,
    )
    .bind(JSON.stringify(summary), runId)
    .run()

  return getRunReport(db, runId)
}

export async function markRunFailed(db: D1Database, runId: string, errorMessage: string): Promise<RunReportRow | null> {
  const row = await getRunReport(db, runId)
  if (!row) {
    return null
  }

  const errors = parseJson<string[]>(row.errors_json, [])
  errors.push(`[${nowIso()}] ${errorMessage}`)

  await db
    .prepare(
      `UPDATE run_reports
       SET status = 'failed',
           finished_at = ?1,
           errors_json = ?2
       WHERE run_id = ?3`,
    )
    .bind(nowIso(), JSON.stringify(errors.slice(-200)), runId)
    .run()

  return getRunReport(db, runId)
}

export async function recordRunQueueOutcome(
  db: D1Database,
  input: { runId: string; lenderCode: string; success: boolean; errorMessage?: string },
): Promise<RunReportRow | null> {
  const now = nowIso()
  const lenderCode = input.lenderCode || '_unknown'
  const lenderPath = jsonPathForKey(lenderCode)
  const lenderProcessedPath = `${lenderPath}.processed`
  const lenderFailedPath = `${lenderPath}.failed`
  const lenderLastErrorPath = `${lenderPath}.last_error`
  const processedIncrement = input.success ? 1 : 0
  const failedIncrement = input.success ? 0 : 1
  const setLastError = !input.success && Boolean(input.errorMessage)
  const errorMessage = input.errorMessage ? String(input.errorMessage) : null
  const errorEntry = setLastError ? `[${now}] ${lenderCode}: ${errorMessage}` : null

  await db
    .prepare(
      `WITH snapshot AS (
         SELECT
           COALESCE(NULLIF(per_lender_json, ''), '{}') AS summary_raw,
           COALESCE(NULLIF(errors_json, ''), '[]') AS errors_raw,
           status AS status_before,
           finished_at AS finished_before
         FROM run_reports
         WHERE run_id = ?1
       ),
       summary_base AS (
         SELECT
           CASE WHEN json_valid(summary_raw) THEN summary_raw ELSE '{}' END AS summary_json,
           CASE WHEN json_valid(errors_raw) THEN errors_raw ELSE '[]' END AS errors_json,
           status_before,
           finished_before
         FROM snapshot
       ),
       summary_with_lender AS (
         SELECT
           json_set(
             summary_json,
             ?2,
             json_set(
               COALESCE(
                 json_extract(summary_json, ?2),
                 json_object('enqueued', 0, 'processed', 0, 'failed', 0, 'updated_at', ?3)
               ),
               '$.processed', COALESCE(json_extract(summary_json, ?4), 0) + ?5,
               '$.failed', COALESCE(json_extract(summary_json, ?6), 0) + ?7,
               '$.updated_at', ?3
             )
           ) AS summary_json,
           errors_json,
           status_before,
           finished_before
         FROM summary_base
       ),
       summary_with_meta AS (
         SELECT
           json_set(
             summary_json,
             '$._meta',
             json_set(
               COALESCE(
                 json_extract(summary_json, '$._meta'),
                 json_object('enqueued_total', 0, 'processed_total', 0, 'failed_total', 0, 'updated_at', ?3)
               ),
               '$.processed_total', COALESCE(json_extract(summary_json, '$._meta.processed_total'), 0) + ?5,
               '$.failed_total', COALESCE(json_extract(summary_json, '$._meta.failed_total'), 0) + ?7,
               '$.updated_at', ?3
             )
           ) AS summary_json,
           errors_json,
           status_before,
           finished_before
         FROM summary_with_lender
       ),
       summary_final AS (
         SELECT
           CASE WHEN ?8 = 1 THEN json_set(summary_json, ?9, ?10) ELSE summary_json END AS summary_json,
           CASE WHEN ?8 = 1 THEN json_insert(errors_json, '$[#]', ?11) ELSE errors_json END AS errors_json,
           status_before,
           finished_before
         FROM summary_with_meta
       )
       UPDATE run_reports
       SET
         per_lender_json = (SELECT summary_json FROM summary_final),
         errors_json = (SELECT errors_json FROM summary_final),
         status = (
           SELECT CASE
             WHEN COALESCE(json_extract(summary_json, '$._meta.enqueued_total'), 0) > 0
              AND COALESCE(json_extract(summary_json, '$._meta.processed_total'), 0)
                + COALESCE(json_extract(summary_json, '$._meta.failed_total'), 0)
                >= COALESCE(json_extract(summary_json, '$._meta.enqueued_total'), 0)
             THEN CASE
               WHEN COALESCE(json_extract(summary_json, '$._meta.failed_total'), 0) > 0 THEN 'partial'
               ELSE 'ok'
             END
             WHEN ?12 = 1 AND COALESCE(json_extract(summary_json, '$._meta.enqueued_total'), 0) = 0 THEN 'partial'
             ELSE status_before
           END
           FROM summary_final
         ),
         finished_at = (
           SELECT CASE
             WHEN COALESCE(json_extract(summary_json, '$._meta.enqueued_total'), 0) > 0
              AND COALESCE(json_extract(summary_json, '$._meta.processed_total'), 0)
                + COALESCE(json_extract(summary_json, '$._meta.failed_total'), 0)
                >= COALESCE(json_extract(summary_json, '$._meta.enqueued_total'), 0)
             THEN ?3
             ELSE finished_before
           END
           FROM summary_final
         )
       WHERE run_id = ?1`,
    )
    .bind(
      input.runId,
      lenderPath,
      now,
      lenderProcessedPath,
      processedIncrement,
      lenderFailedPath,
      failedIncrement,
      setLastError ? 1 : 0,
      lenderLastErrorPath,
      errorMessage,
      errorEntry,
      input.success ? 0 : 1,
    )
    .run()

  const row = await getRunReport(db, input.runId)
  return refreshRunTerminalState(db, row)
}

/**
 * Most recent finished_at among daily runs that completed (status='ok' or 'partial').
 * Used by the public snapshot freshness check so a fresh snapshot is invalidated
 * when ingest finalises after the snapshot was built.
 */
export async function getLatestCompletedDailyRunFinishedAt(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MAX(finished_at) AS finished_at
       FROM run_reports
       WHERE run_type = 'daily'
         AND status IN ('ok', 'partial')
         AND finished_at IS NOT NULL`,
    )
    .first<{ finished_at: string | null }>()
  return row?.finished_at ?? null
}

export async function getLastManualRunStartedAt(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT started_at FROM run_reports
       WHERE run_source = 'manual' AND run_type = 'daily'
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .first<{ started_at: string }>()

  return row?.started_at ?? null
}

export async function hasRunningManualRun(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT run_id FROM run_reports
       WHERE run_source = 'manual' AND run_type = 'daily' AND status = 'running'
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .first<{ run_id: string }>()

  return Boolean(row?.run_id)
}

export async function hasRunningDailyRunForCollectionDate(db: D1Database, collectionDate: string): Promise<boolean> {
  const baseRunId = `daily:${collectionDate}`
  const row = await db
    .prepare(
      `SELECT run_id FROM run_reports
       WHERE run_type = 'daily'
         AND status = 'running'
         AND (run_id = ?1 OR run_id LIKE ?2)
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .bind(baseRunId, `${baseRunId}:%`)
    .first<{ run_id: string }>()

  return Boolean(row?.run_id)
}
