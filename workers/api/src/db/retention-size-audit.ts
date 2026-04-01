import { chooseOperationalRetentionDays } from './historical-quality-summary'
import { BACKEND_RETENTION_DAYS, FETCH_EVENTS_RETENTION_DAYS } from './retention-prune'
import { getApproximateDatabaseSizeBytes, listDbTableStats, type DbTableStat } from './db-stats'

type RetentionAuditGroup = 'raw_run_state' | 'recovery_log' | 'change_feed' | 'client_historical'
type ProjectionConfidence = 'high' | 'medium' | 'low'
type CandidateDays = 7 | 14 | 30

type RetentionAuditTableSpec = {
  name: string
  group: RetentionAuditGroup
  dateExpression: string
  includeInRunStateProjection: boolean
}

type RetentionAuditTableRow = {
  name: string
  group: RetentionAuditGroup
  row_count: number
  estimated_bytes: number | null
  observed_day_count: number
  observed_start_date: string | null
  observed_end_date: string | null
  avg_rows_per_day: number
  avg_bytes_per_row: number
  avg_bytes_per_day: number
  projection_confidence: ProjectionConfidence
}

type ProjectionSummary = {
  candidate_days: CandidateDays
  added_days: number
  projected_added_rows: number
  projected_added_bytes: number
  projected_added_mb: number
}

const AUDIT_TABLES: RetentionAuditTableSpec[] = [
  { name: 'run_reports', group: 'raw_run_state', dateExpression: "date(started_at)", includeInRunStateProjection: true },
  { name: 'lender_dataset_runs', group: 'raw_run_state', dateExpression: 'collection_date', includeInRunStateProjection: true },
  { name: 'run_seen_products', group: 'raw_run_state', dateExpression: 'collection_date', includeInRunStateProjection: true },
  { name: 'run_seen_series', group: 'raw_run_state', dateExpression: 'collection_date', includeInRunStateProjection: true },
  {
    name: 'historical_provenance_recovery_log',
    group: 'recovery_log',
    dateExpression: 'date(created_at)',
    includeInRunStateProjection: false,
  },
  { name: 'download_change_feed', group: 'change_feed', dateExpression: 'date(emitted_at)', includeInRunStateProjection: false },
  { name: 'client_historical_runs', group: 'client_historical', dateExpression: 'date(created_at)', includeInRunStateProjection: false },
  {
    name: 'client_historical_tasks',
    group: 'client_historical',
    dateExpression: 'collection_date',
    includeInRunStateProjection: false,
  },
  {
    name: 'client_historical_batches',
    group: 'client_historical',
    dateExpression: 'date(created_at)',
    includeInRunStateProjection: false,
  },
]

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function projectionConfidence(observedDayCount: number): ProjectionConfidence {
  if (observedDayCount >= 7) return 'high'
  if (observedDayCount >= 3) return 'medium'
  return 'low'
}

function round(value: number, precision = 4): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function toMb(bytes: number): number {
  return round(bytes / 1_000_000, 3)
}

function projectRetentionCandidate(input: {
  candidateDays: CandidateDays
  avgRowsPerDay: number
  avgBytesPerDay: number
}): ProjectionSummary {
  const addedDays = Math.max(0, input.candidateDays - BACKEND_RETENTION_DAYS)
  const projectedAddedRows = Math.round(input.avgRowsPerDay * addedDays)
  const projectedAddedBytes = Math.round(input.avgBytesPerDay * addedDays)
  return {
    candidate_days: input.candidateDays,
    added_days: addedDays,
    projected_added_rows: projectedAddedRows,
    projected_added_bytes: projectedAddedBytes,
    projected_added_mb: toMb(projectedAddedBytes),
  }
}

async function listDailyCounts(db: D1Database, spec: RetentionAuditTableSpec): Promise<Array<{ day: string; row_count: number }>> {
  try {
    const rows = await db
      .prepare(
        `SELECT ${spec.dateExpression} AS day, COUNT(*) AS row_count
         FROM ${spec.name}
         WHERE ${spec.dateExpression} IS NOT NULL
         GROUP BY ${spec.dateExpression}
         ORDER BY ${spec.dateExpression} ASC`,
      )
      .all<{ day: string; row_count: number }>()
    return (rows.results ?? []).filter((row) => String(row.day || '').trim())
  } catch {
    return []
  }
}

async function getHistoricalDateCoverage(db: D1Database): Promise<{
  total_historical_dates: number
  latest_completed_run_id: string | null
  latest_completed_finished_at: string | null
  covered_overall_dates: number
  has_permanent_evidence_backfill: boolean
}> {
  const totalDatesRow = await db
    .prepare(
      `WITH historical_dates AS (
         SELECT collection_date FROM historical_loan_rates
         UNION
         SELECT collection_date FROM historical_savings_rates
         UNION
         SELECT collection_date FROM historical_term_deposit_rates
       )
       SELECT COUNT(*) AS n FROM historical_dates`,
    )
    .first<{ n: number }>()
    .catch(() => ({ n: 0 }))
  const latestRun = await db
    .prepare(
      `SELECT audit_run_id, finished_at
       FROM historical_quality_runs
       WHERE status = 'completed'
       ORDER BY COALESCE(finished_at, updated_at, started_at) DESC
       LIMIT 1`,
    )
    .first<{ audit_run_id: string; finished_at: string | null }>()
    .catch(() => null)
  const coveredRow = latestRun?.audit_run_id
    ? await db
        .prepare(
          `SELECT COUNT(DISTINCT collection_date) AS n
           FROM historical_quality_daily
           WHERE audit_run_id = ?1 AND scope = 'overall'`,
        )
        .bind(latestRun.audit_run_id)
        .first<{ n: number }>()
        .catch(() => ({ n: 0 }))
    : { n: 0 }
  const totalHistoricalDates = Number(totalDatesRow?.n ?? 0)
  const coveredOverallDates = Number(coveredRow?.n ?? 0)
  return {
    total_historical_dates: totalHistoricalDates,
    latest_completed_run_id: latestRun?.audit_run_id ?? null,
    latest_completed_finished_at: latestRun?.finished_at ?? null,
    covered_overall_dates: coveredOverallDates,
    has_permanent_evidence_backfill: totalHistoricalDates > 0 && coveredOverallDates >= totalHistoricalDates,
  }
}

function buildTableRow(
  spec: RetentionAuditTableSpec,
  tableStat: DbTableStat | undefined,
  dailyCounts: Array<{ day: string; row_count: number }>,
): RetentionAuditTableRow {
  const rowCount = Math.max(0, Number(tableStat?.row_count ?? 0))
  const estimatedBytes = tableStat?.estimated_bytes ?? null
  const avgRowsPerDay = average(dailyCounts.map((row) => Number(row.row_count ?? 0)))
  const avgBytesPerRow = rowCount > 0 && estimatedBytes != null ? estimatedBytes / rowCount : 0
  return {
    name: spec.name,
    group: spec.group,
    row_count: rowCount,
    estimated_bytes: estimatedBytes,
    observed_day_count: dailyCounts.length,
    observed_start_date: dailyCounts[0]?.day ?? null,
    observed_end_date: dailyCounts[dailyCounts.length - 1]?.day ?? null,
    avg_rows_per_day: round(avgRowsPerDay),
    avg_bytes_per_row: round(avgBytesPerRow),
    avg_bytes_per_day: round(avgRowsPerDay * avgBytesPerRow),
    projection_confidence: projectionConfidence(dailyCounts.length),
  }
}

export async function runRetentionSizeAudit(db: D1Database): Promise<{
  generated_at: string
  current_backend_retention_days: number
  fetch_events_retention_days: number
  current_db_size_bytes: number
  current_db_size_mb: number
  evidence_backfill: {
    total_historical_dates: number
    latest_completed_run_id: string | null
    latest_completed_finished_at: string | null
    covered_overall_dates: number
    has_permanent_evidence_backfill: boolean
  }
  raw_run_state_projection: {
    avg_rows_per_day: number
    avg_bytes_per_day: number
    projection_confidence: ProjectionConfidence
    candidates: ProjectionSummary[]
    recommendation: ReturnType<typeof chooseOperationalRetentionDays>
  }
  tables: RetentionAuditTableRow[]
}> {
  const [tableStats, approxBytes, evidenceBackfill] = await Promise.all([
    listDbTableStats(db),
    getApproximateDatabaseSizeBytes(db),
    getHistoricalDateCoverage(db),
  ])
  const tableMap = new Map(tableStats.map((row) => [row.name, row]))
  const tableRows: RetentionAuditTableRow[] = []
  for (const spec of AUDIT_TABLES) {
    const row = buildTableRow(spec, tableMap.get(spec.name), await listDailyCounts(db, spec))
    tableRows.push(row)
  }
  const rawRunStateRows = tableRows.filter((row) => AUDIT_TABLES.find((spec) => spec.name === row.name)?.includeInRunStateProjection)
  const rawRunStateAvgRowsPerDay = round(rawRunStateRows.reduce((sum, row) => sum + row.avg_rows_per_day, 0))
  const rawRunStateAvgBytesPerDay = round(rawRunStateRows.reduce((sum, row) => sum + row.avg_bytes_per_day, 0))
  const candidates = ([7, 14, 30] as CandidateDays[]).map((candidateDays) =>
    projectRetentionCandidate({
      candidateDays,
      avgRowsPerDay: rawRunStateAvgRowsPerDay,
      avgBytesPerDay: rawRunStateAvgBytesPerDay,
    }),
  )
  const fallbackEstimatedBytes = tableStats.reduce((sum, row) => sum + Math.max(0, row.estimated_bytes ?? 0), 0)
  const currentDbSizeBytes = Math.max(0, approxBytes ?? fallbackEstimatedBytes)
  const recommendation = chooseOperationalRetentionDays({
    currentDbSizeMb: toMb(currentDbSizeBytes),
    hasPermanentEvidenceBackfill: evidenceBackfill.has_permanent_evidence_backfill,
    projectionsMb: {
      7: candidates.find((row) => row.candidate_days === 7)?.projected_added_mb ?? 0,
      14: candidates.find((row) => row.candidate_days === 14)?.projected_added_mb ?? 0,
      30: candidates.find((row) => row.candidate_days === 30)?.projected_added_mb ?? 0,
    },
  })
  return {
    generated_at: new Date().toISOString(),
    current_backend_retention_days: BACKEND_RETENTION_DAYS,
    fetch_events_retention_days: FETCH_EVENTS_RETENTION_DAYS,
    current_db_size_bytes: currentDbSizeBytes,
    current_db_size_mb: toMb(currentDbSizeBytes),
    evidence_backfill: evidenceBackfill,
    raw_run_state_projection: {
      avg_rows_per_day: rawRunStateAvgRowsPerDay,
      avg_bytes_per_day: rawRunStateAvgBytesPerDay,
      projection_confidence: projectionConfidence(
        Math.max(0, ...rawRunStateRows.map((row) => row.observed_day_count)),
      ),
      candidates,
      recommendation,
    },
    tables: tableRows,
  }
}

export { projectRetentionCandidate }
