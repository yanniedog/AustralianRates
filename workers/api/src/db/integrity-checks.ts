import { getMelbourneNowParts } from '../utils/time'

export type IntegrityCheckResult = {
  name: string
  passed: boolean
  detail: Record<string, unknown>
}

export type IntegritySummary = {
  ok: boolean
  checked_at: string
  checks: IntegrityCheckResult[]
}

type StatusCountRow = { status: string; n: number }
type NumberRow = { n: number }
type DateRow = { latest: string | null }
type SeverityCountRow = { severity: string | null; n: number }
type ColumnInfoRow = { name: string }
type SeriesAggregateRow = {
  missing_series_key: number | null
  mismatched_series_key: number | null
  total_rows: number | null
}
type SeriesDatasetCheck = {
  dataset: 'home_loans' | 'savings' | 'term_deposits'
  table: string
  table_present: boolean
  series_key_column_present: boolean
  total_rows: number
  missing_series_key: number
  mismatched_series_key: number
}

function daysBetweenIsoDate(isoDate: string, targetDate: string): number {
  const a = Date.parse(`${isoDate}T00:00:00.000Z`)
  const b = Date.parse(`${targetDate}T00:00:00.000Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY
  return Math.abs(Math.round((a - b) / (24 * 60 * 60 * 1000)))
}

async function getLatestDate(db: D1Database, table: string): Promise<string | null> {
  const row = await db.prepare(`SELECT MAX(collection_date) AS latest FROM ${table}`).first<DateRow>()
  return row?.latest ?? null
}

async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM sqlite_master
       WHERE type = 'table' AND name = ?1`,
    )
    .bind(table)
    .first<NumberRow>()
  return Number(row?.n ?? 0) > 0
}

async function columnExists(db: D1Database, table: string, column: string): Promise<boolean> {
  try {
    const result = await db.prepare(`PRAGMA table_info(${table})`).all<ColumnInfoRow>()
    return (result.results ?? []).some((row) => String(row.name || '').toLowerCase() === column.toLowerCase())
  } catch {
    return false
  }
}

function errorDetail(error: unknown): Record<string, unknown> {
  return {
    error: (error as Error)?.message || String(error),
  }
}

async function runSeriesKeyCheck(
  db: D1Database,
  input: { dataset: 'home_loans' | 'savings' | 'term_deposits'; table: string; expectedExpr: string },
): Promise<SeriesDatasetCheck> {
  const hasTable = await tableExists(db, input.table)
  if (!hasTable) {
    return {
      dataset: input.dataset,
      table: input.table,
      table_present: false,
      series_key_column_present: false,
      total_rows: 0,
      missing_series_key: 0,
      mismatched_series_key: 0,
    }
  }

  const hasSeriesKey = await columnExists(db, input.table, 'series_key')
  if (!hasSeriesKey) {
    return {
      dataset: input.dataset,
      table: input.table,
      table_present: true,
      series_key_column_present: false,
      total_rows: 0,
      missing_series_key: 0,
      mismatched_series_key: 0,
    }
  }

  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END) AS missing_series_key,
         SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (${input.expectedExpr}) THEN 1 ELSE 0 END) AS mismatched_series_key,
         COUNT(*) AS total_rows
       FROM ${input.table}`,
    )
    .first<SeriesAggregateRow>()

  return {
    dataset: input.dataset,
    table: input.table,
    table_present: true,
    series_key_column_present: true,
    total_rows: Number(row?.total_rows ?? 0),
    missing_series_key: Number(row?.missing_series_key ?? 0),
    mismatched_series_key: Number(row?.mismatched_series_key ?? 0),
  }
}

export async function runIntegrityChecks(db: D1Database, timezone = 'Australia/Melbourne'): Promise<IntegritySummary> {
  const checkedAt = new Date().toISOString()
  const nowMelbourneDate = getMelbourneNowParts(new Date(), timezone).date

  const checks: IntegrityCheckResult[] = []

  try {
    const datasetChecks = await Promise.all([
      runSeriesKeyCheck(db, {
        dataset: 'home_loans',
        table: 'historical_loan_rates',
        expectedExpr:
          `bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure`,
      }),
      runSeriesKeyCheck(db, {
        dataset: 'savings',
        table: 'historical_savings_rates',
        expectedExpr:
          `bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier`,
      }),
      runSeriesKeyCheck(db, {
        dataset: 'term_deposits',
        table: 'historical_term_deposit_rates',
        expectedExpr: `bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier`,
      }),
    ])

    const missingSchema = datasetChecks.some((item) => !item.table_present || !item.series_key_column_present)
    const missingSeriesTotal = datasetChecks.reduce((sum, item) => sum + item.missing_series_key, 0)
    const mismatchedSeriesTotal = datasetChecks.reduce((sum, item) => sum + item.mismatched_series_key, 0)

    checks.push({
      name: 'product_key_consistency',
      passed: !missingSchema && missingSeriesTotal === 0 && mismatchedSeriesTotal === 0,
      detail: {
        checked_on: 'historical_tables_series_key',
        datasets: datasetChecks,
        missing_series_key_total: missingSeriesTotal,
        mismatched_series_key_total: mismatchedSeriesTotal,
      },
    })
  } catch (error) {
    checks.push({
      name: 'product_key_consistency',
      passed: false,
      detail: errorDetail(error),
    })
  }

  try {
    const runStatusRows = await db
      .prepare(
        `SELECT status, COUNT(*) AS n
         FROM run_reports
         GROUP BY status`,
      )
      .all<StatusCountRow>()
    const statusCounts = (runStatusRows.results ?? []).reduce<Record<string, number>>((acc, row) => {
      acc[String(row.status || 'unknown')] = Number(row.n || 0)
      return acc
    }, {})
    checks.push({
      name: 'run_report_status_distribution',
      passed: true,
      detail: statusCounts,
    })
  } catch (error) {
    checks.push({
      name: 'run_report_status_distribution',
      passed: false,
      detail: errorDetail(error),
    })
  }

  try {
    const [homeLatest, savingsLatest, tdLatest] = await Promise.all([
      getLatestDate(db, 'historical_loan_rates'),
      getLatestDate(db, 'historical_savings_rates'),
      getLatestDate(db, 'historical_term_deposit_rates'),
    ])
    const homeAgeDays = homeLatest ? daysBetweenIsoDate(nowMelbourneDate, homeLatest) : Number.POSITIVE_INFINITY
    const savingsAgeDays = savingsLatest ? daysBetweenIsoDate(nowMelbourneDate, savingsLatest) : Number.POSITIVE_INFINITY
    const tdAgeDays = tdLatest ? daysBetweenIsoDate(nowMelbourneDate, tdLatest) : Number.POSITIVE_INFINITY
    const maxAllowedAgeDays = 2
    checks.push({
      name: 'dataset_staleness',
      passed: homeAgeDays <= maxAllowedAgeDays && savingsAgeDays <= maxAllowedAgeDays && tdAgeDays <= maxAllowedAgeDays,
      detail: {
        max_allowed_age_days: maxAllowedAgeDays,
        melbourne_date: nowMelbourneDate,
        home_loans_latest: homeLatest,
        home_loans_age_days: Number.isFinite(homeAgeDays) ? homeAgeDays : null,
        savings_latest: savingsLatest,
        savings_age_days: Number.isFinite(savingsAgeDays) ? savingsAgeDays : null,
        term_deposits_latest: tdLatest,
        term_deposits_age_days: Number.isFinite(tdAgeDays) ? tdAgeDays : null,
      },
    })
  } catch (error) {
    checks.push({
      name: 'dataset_staleness',
      passed: false,
      detail: errorDetail(error),
    })
  }

  try {
    const hasAnomalyTable = await tableExists(db, 'ingest_anomalies')
    if (!hasAnomalyTable) {
      checks.push({
        name: 'recent_anomaly_volume',
        passed: false,
        detail: {
          error: 'ingest_anomalies table missing',
        },
      })
    } else {
      const anomalyRows = await db
        .prepare(
          `SELECT severity, COUNT(*) AS n
           FROM ingest_anomalies
           WHERE created_at >= datetime('now', '-7 days')
           GROUP BY severity`,
        )
        .all<SeverityCountRow>()
      const anomalySummary = (anomalyRows.results ?? []).reduce<Record<string, number>>((acc, row) => {
        const key = String(row.severity || 'unknown')
        acc[key] = Number(row.n || 0)
        return acc
      }, {})
      checks.push({
        name: 'recent_anomaly_volume',
        passed: true,
        detail: {
          window: '7_days',
          by_severity: anomalySummary,
        },
      })
    }
  } catch (error) {
    checks.push({
      name: 'recent_anomaly_volume',
      passed: false,
      detail: errorDetail(error),
    })
  }

  return {
    ok: checks.every((check) => check.passed),
    checked_at: checkedAt,
    checks,
  }
}
