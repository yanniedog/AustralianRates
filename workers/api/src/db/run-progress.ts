import { getRunReport } from './run-reports'
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

export type PublicRunProgress = {
  run_id: string
  status: 'running' | 'ok' | 'partial' | 'failed'
  started_at: string
  finished_at: string | null
  enqueued_total: number
  processed_total: number
  failed_total: number
  pending_total: number
  completed_total: number
  progress_pct: number
  per_lender: Record<string, LenderProgress>
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function asLenderProgress(input: unknown): LenderProgress {
  const now = nowIso()
  if (!input || typeof input !== 'object') {
    return {
      enqueued: 0,
      processed: 0,
      failed: 0,
      updated_at: now,
    }
  }
  const raw = input as Record<string, unknown>
  return {
    enqueued: Number(raw.enqueued) || 0,
    processed: Number(raw.processed) || 0,
    failed: Number(raw.failed) || 0,
    last_error: raw.last_error == null ? undefined : String(raw.last_error),
    updated_at: String(raw.updated_at || now),
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

function toPublicRunProgress(row: {
  run_id: string
  status: 'running' | 'ok' | 'partial' | 'failed'
  started_at: string
  finished_at: string | null
  per_lender_json: string
}): PublicRunProgress {
  const summary = asPerLenderSummary(parseJson<Record<string, unknown>>(row.per_lender_json, {}))
  const completedTotal = summary._meta.processed_total + summary._meta.failed_total
  const pendingTotal = Math.max(0, summary._meta.enqueued_total - completedTotal)
  const progressPct =
    summary._meta.enqueued_total > 0
      ? Math.max(0, Math.min(100, Math.round((completedTotal / summary._meta.enqueued_total) * 1000) / 10))
      : row.status === 'running'
        ? 0
        : 100

  const perLender: Record<string, LenderProgress> = {}
  for (const [lenderCode, value] of Object.entries(summary)) {
    if (lenderCode === '_meta') continue
    perLender[lenderCode] = asLenderProgress(value)
  }

  return {
    run_id: row.run_id,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    enqueued_total: summary._meta.enqueued_total,
    processed_total: summary._meta.processed_total,
    failed_total: summary._meta.failed_total,
    pending_total: pendingTotal,
    completed_total: completedTotal,
    progress_pct: progressPct,
    per_lender: perLender,
  }
}

export async function getPublicRunProgress(db: D1Database, runId: string): Promise<PublicRunProgress | null> {
  const row = await getRunReport(db, runId)
  if (!row) return null
  return toPublicRunProgress(row)
}

export async function addRunEnqueuedCounts(
  db: D1Database,
  runId: string,
  perLenderEnqueued: Record<string, number>,
): Promise<void> {
  const row = await getRunReport(db, runId)
  if (!row) return

  const summary = asPerLenderSummary(parseJson<Record<string, unknown>>(row.per_lender_json, {}))
  let addedTotal = 0
  const now = nowIso()

  for (const [lenderCode, rawCount] of Object.entries(perLenderEnqueued)) {
    const count = Math.max(0, Math.floor(Number(rawCount) || 0))
    if (count <= 0) continue
    const progress = asLenderProgress(summary[lenderCode])
    progress.enqueued += count
    progress.updated_at = now
    summary[lenderCode] = progress
    addedTotal += count
  }

  if (addedTotal <= 0) return

  summary._meta.enqueued_total += addedTotal
  summary._meta.updated_at = now

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
}
