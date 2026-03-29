import { repairableFetchEventLineageClause } from './fetch-event-lineage'
import { FETCH_EVENTS_RETENTION_DAYS } from './retention-prune'

export type DiagnosticsBacklogRow = {
  dataset_kind: string
  lender_code: string | null
  bank_name: string | null
  count: number
  oldest_updated_at?: string | null
  newest_updated_at?: string | null
  oldest_collection_date?: string | null
  newest_collection_date?: string | null
}

function backlogTotal(rows: DiagnosticsBacklogRow[]): number {
  return rows.reduce((sum, row) => sum + Number(row.count || 0), 0)
}

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - Math.max(1, minutes) * 60 * 1000).toISOString()
}

function daysAgoDate(days: number): string {
  return new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export type DiagnosticsBacklogBundle = {
  ready_finalizations: {
    total: number
    cutoff_iso: string
    idle_minutes: number
    rows: DiagnosticsBacklogRow[]
  }
  stale_running_runs: {
    total: number
    cutoff_iso: string
    stale_run_minutes: number
    rows: DiagnosticsBacklogRow[]
  }
  missing_fetch_event_lineage: {
    total: number
    cutoff_date: string
    lookback_days: number
    rows: DiagnosticsBacklogRow[]
  }
}

/** Same data as GET /admin/diagnostics/backlog (defaults match route). */
export async function getDiagnosticsBacklog(
  db: D1Database,
  input: {
    limit?: number
    idleMinutes?: number
    staleRunMinutes?: number
    lookbackDays?: number
  } = {},
): Promise<DiagnosticsBacklogBundle> {
  const limit = Math.max(1, Math.min(1000, Math.floor(input.limit ?? 200)))
  const idleMinutes = Math.max(1, Math.min(1440, Math.floor(input.idleMinutes ?? 5)))
  const staleRunMinutes = Math.max(1, Math.min(10080, Math.floor(input.staleRunMinutes ?? 120)))
  const lookbackDays = Math.max(1, Math.min(3650, Math.floor(input.lookbackDays ?? FETCH_EVENTS_RETENTION_DAYS)))
  const readyCutoffIso = minutesAgoIso(idleMinutes)
  const staleCutoffIso = minutesAgoIso(staleRunMinutes)
  const lineageCutoffDate = daysAgoDate(lookbackDays)

  const [readyFinalizations, staleRunningRuns, missingFetchEventLineage] = await Promise.all([
    db
      .prepare(
        `SELECT
           dataset_kind,
           lender_code,
           bank_name,
           COUNT(*) AS count,
           MIN(updated_at) AS oldest_updated_at,
           MAX(updated_at) AS newest_updated_at
         FROM lender_dataset_runs
         WHERE finalized_at IS NULL
           AND (
             expected_detail_count <= 0
             OR (completed_detail_count + failed_detail_count) >= expected_detail_count
           )
           AND updated_at <= ?1
         GROUP BY dataset_kind, lender_code, bank_name
         ORDER BY count DESC, dataset_kind ASC, lender_code ASC
         LIMIT ?2`,
      )
      .bind(readyCutoffIso, limit)
      .all<DiagnosticsBacklogRow>(),
    db
      .prepare(
        `SELECT
           ldr.dataset_kind,
           ldr.lender_code,
           ldr.bank_name,
           COUNT(*) AS count,
           MIN(rr.started_at) AS oldest_updated_at,
           MAX(rr.started_at) AS newest_updated_at
         FROM lender_dataset_runs ldr
         JOIN run_reports rr
           ON rr.run_id = ldr.run_id
         WHERE rr.status = 'running'
           AND rr.started_at < ?1
           AND ldr.finalized_at IS NULL
         GROUP BY ldr.dataset_kind, ldr.lender_code, ldr.bank_name
         ORDER BY count DESC, ldr.dataset_kind ASC, ldr.lender_code ASC
         LIMIT ?2`,
      )
      .bind(staleCutoffIso, limit)
      .all<DiagnosticsBacklogRow>(),
    db
      .prepare(
        `SELECT
           dataset_kind,
           lender_code,
           bank_name,
           count,
           oldest_collection_date,
           newest_collection_date
         FROM (
           SELECT
             'home_loans' AS dataset_kind,
             NULL AS lender_code,
             bank_name,
             COUNT(*) AS count,
             MIN(collection_date) AS oldest_collection_date,
             MAX(collection_date) AS newest_collection_date
           FROM historical_loan_rates
           WHERE ${repairableFetchEventLineageClause('historical_loan_rates', 'loan_lineage')}
             AND collection_date >= ?1
           GROUP BY bank_name
           UNION ALL
           SELECT
             'savings',
             NULL,
             bank_name,
             COUNT(*),
             MIN(collection_date),
             MAX(collection_date)
           FROM historical_savings_rates
           WHERE ${repairableFetchEventLineageClause('historical_savings_rates', 'savings_lineage')}
             AND collection_date >= ?1
           GROUP BY bank_name
           UNION ALL
           SELECT
             'term_deposits',
             NULL,
             bank_name,
             COUNT(*),
             MIN(collection_date),
             MAX(collection_date)
           FROM historical_term_deposit_rates
           WHERE ${repairableFetchEventLineageClause('historical_term_deposit_rates', 'td_lineage')}
             AND collection_date >= ?1
           GROUP BY bank_name
         )
         ORDER BY count DESC, dataset_kind ASC, bank_name ASC
         LIMIT ?2`,
      )
      .bind(lineageCutoffDate, limit)
      .all<DiagnosticsBacklogRow>(),
  ])

  const readyRows = readyFinalizations.results ?? []
  const staleRows = staleRunningRuns.results ?? []
  const missingRows = missingFetchEventLineage.results ?? []

  return {
    ready_finalizations: {
      total: backlogTotal(readyRows),
      cutoff_iso: readyCutoffIso,
      idle_minutes: idleMinutes,
      rows: readyRows,
    },
    stale_running_runs: {
      total: backlogTotal(staleRows),
      cutoff_iso: staleCutoffIso,
      stale_run_minutes: staleRunMinutes,
      rows: staleRows,
    },
    missing_fetch_event_lineage: {
      total: backlogTotal(missingRows),
      cutoff_date: lineageCutoffDate,
      lookback_days: lookbackDays,
      rows: missingRows,
    },
  }
}
