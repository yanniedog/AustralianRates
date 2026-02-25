import {
  DAILY_SCHEDULE_CRON_EXPRESSION,
  DEFAULT_RATE_CHECK_INTERVAL_MINUTES,
  HOURLY_WAYBACK_CRON_EXPRESSION,
  MIN_RATE_CHECK_INTERVAL_MINUTES,
} from '../constants'
import { getDatasetCoverageProgressRows, type DatasetCoverageRow } from './dataset-coverage'
import { type AdminRunProgress, listAdminRunProgress } from './run-progress'
import { nowIso } from '../utils/time'

type CoverageSummary = {
  datasets_total: number
  active_datasets: number
  pending_datasets: number
  completed_datasets: number
  earliest_cursor_date: string | null
  latest_cursor_date: string | null
}

type CoverageSnapshot = {
  summary: CoverageSummary
  rows: DatasetCoverageRow[]
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
  historical: CoverageSnapshot
  coverage: CoverageSnapshot
  scheduler: {
    cron_expression: string
    daily_cron_expression: string
    hourly_cron_expression: string
    default_interval_minutes: number
    effective_min_interval_minutes: number
  }
}

function summarizeCoverage(rows: DatasetCoverageRow[]): CoverageSummary {
  let activeDatasets = 0
  let pendingDatasets = 0
  let completedDatasets = 0
  let earliestDate: string | null = null
  let latestDate: string | null = null

  for (const row of rows) {
    if (row.status === 'active') activeDatasets += 1
    else if (row.status === 'completed_lower_bound') completedDatasets += 1
    else pendingDatasets += 1

    const date = row.cursor_date || null
    if (!date) continue
    if (!earliestDate || date < earliestDate) earliestDate = date
    if (!latestDate || date > latestDate) latestDate = date
  }

  return {
    datasets_total: rows.length,
    active_datasets: activeDatasets,
    pending_datasets: pendingDatasets,
    completed_datasets: completedDatasets,
    earliest_cursor_date: earliestDate,
    latest_cursor_date: latestDate,
  }
}

export async function getAdminRealtimeSnapshot(
  db: D1Database,
  input?: { recentLimit?: number; pollIntervalMs?: number },
): Promise<AdminRealtimeSnapshot> {
  const pollIntervalMs = Math.max(1000, Math.min(60000, Number(input?.pollIntervalMs) || 10000))
  const recentLimit = Math.max(1, Math.min(50, Math.floor(Number(input?.recentLimit) || 15)))

  const [runs, coverageRowsResult] = await Promise.allSettled([
    listAdminRunProgress(db, { activeLimit: 100, recentLimit }),
    getDatasetCoverageProgressRows(db),
  ])

  const runData =
    runs.status === 'fulfilled'
      ? runs.value
      : {
          active: [],
          recent: [],
        }
  const coverageRows = coverageRowsResult.status === 'fulfilled' ? coverageRowsResult.value : []
  const coverageSnapshot: CoverageSnapshot = {
    summary: summarizeCoverage(coverageRows),
    rows: coverageRows,
  }

  return {
    ok: true,
    server_time: nowIso(),
    poll_interval_ms: pollIntervalMs,
    runs: {
      active_count: runData.active.length,
      active: runData.active,
      recent: runData.recent,
    },
    historical: coverageSnapshot,
    coverage: coverageSnapshot,
    scheduler: {
      cron_expression: DAILY_SCHEDULE_CRON_EXPRESSION,
      daily_cron_expression: DAILY_SCHEDULE_CRON_EXPRESSION,
      hourly_cron_expression: HOURLY_WAYBACK_CRON_EXPRESSION,
      default_interval_minutes: DEFAULT_RATE_CHECK_INTERVAL_MINUTES,
      effective_min_interval_minutes: MIN_RATE_CHECK_INTERVAL_MINUTES,
    },
  }
}
