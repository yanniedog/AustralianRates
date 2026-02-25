import {
  DEFAULT_RATE_CHECK_INTERVAL_MINUTES,
  MIN_RATE_CHECK_INTERVAL_MINUTES,
  SCHEDULE_CRON_EXPRESSION,
} from '../constants'
import { listAllAutoBackfillProgress } from './auto-backfill-progress'
import { type AdminRunProgress, listAdminRunProgress } from './run-progress'
import { nowIso } from '../utils/time'

type HistoricalRow = {
  lender_code: string
  next_collection_date: string
  empty_streak: number
  status: 'active' | 'completed_full_history'
  updated_at: string
  last_run_id: string | null
  claimed: boolean
}

type HistoricalSummary = {
  lenders_total: number
  active_lenders: number
  completed_lenders: number
  claimed_lenders: number
  earliest_next_collection_date: string | null
  latest_next_collection_date: string | null
}

type HistoricalSnapshot = {
  summary: HistoricalSummary
  rows: HistoricalRow[]
}

export type AdminRealtimeSnapshot = {
  ok: true
  server_time: string
  poll_interval_ms: number
  runs: {
    active_count: number
    active: AdminRunProgress[]
    recent: AdminRunProgress[]
  }
  historical: HistoricalSnapshot
  scheduler: {
    cron_expression: string
    default_interval_minutes: number
    effective_min_interval_minutes: number
  }
}

function summarizeHistorical(rows: HistoricalRow[]): HistoricalSummary {
  let activeLenders = 0
  let completedLenders = 0
  let claimedLenders = 0
  let earliestDate: string | null = null
  let latestDate: string | null = null

  for (const row of rows) {
    if (row.status === 'active') activeLenders += 1
    else completedLenders += 1
    if (row.claimed) claimedLenders += 1

    const date = row.next_collection_date || null
    if (!date) continue
    if (!earliestDate || date < earliestDate) earliestDate = date
    if (!latestDate || date > latestDate) latestDate = date
  }

  return {
    lenders_total: rows.length,
    active_lenders: activeLenders,
    completed_lenders: completedLenders,
    claimed_lenders: claimedLenders,
    earliest_next_collection_date: earliestDate,
    latest_next_collection_date: latestDate,
  }
}

export async function getAdminRealtimeSnapshot(
  db: D1Database,
  input?: { recentLimit?: number; pollIntervalMs?: number },
): Promise<AdminRealtimeSnapshot> {
  const pollIntervalMs = Math.max(1000, Math.min(60000, Number(input?.pollIntervalMs) || 10000))
  const recentLimit = Math.max(1, Math.min(50, Math.floor(Number(input?.recentLimit) || 15)))

  const [runs, autoBackfillResult] = await Promise.allSettled([
    listAdminRunProgress(db, { activeLimit: 100, recentLimit }),
    listAllAutoBackfillProgress(db),
  ])

  const runData =
    runs.status === 'fulfilled'
      ? runs.value
      : {
          active: [],
          recent: [],
        }
  const autoBackfillRows = autoBackfillResult.status === 'fulfilled' ? autoBackfillResult.value : []

  const historicalRows: HistoricalRow[] = autoBackfillRows.map((row) => ({
    lender_code: row.lender_code,
    next_collection_date: row.next_collection_date,
    empty_streak: Number(row.empty_streak || 0),
    status: row.status,
    updated_at: row.updated_at,
    last_run_id: row.last_run_id,
    claimed: Boolean(row.last_run_id && row.last_run_id.trim()),
  }))

  return {
    ok: true,
    server_time: nowIso(),
    poll_interval_ms: pollIntervalMs,
    runs: {
      active_count: runData.active.length,
      active: runData.active,
      recent: runData.recent,
    },
    historical: {
      summary: summarizeHistorical(historicalRows),
      rows: historicalRows,
    },
    scheduler: {
      cron_expression: SCHEDULE_CRON_EXPRESSION,
      default_interval_minutes: DEFAULT_RATE_CHECK_INTERVAL_MINUTES,
      effective_min_interval_minutes: MIN_RATE_CHECK_INTERVAL_MINUTES,
    },
  }
}
