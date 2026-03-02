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

function daysBetweenIsoDate(isoDate: string, targetDate: string): number {
  const a = Date.parse(`${isoDate}T00:00:00.000Z`)
  const b = Date.parse(`${targetDate}T00:00:00.000Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY
  return Math.abs(Math.round((a - b) / (24 * 60 * 60 * 1000)))
}

async function getSingleCount(db: D1Database, sql: string): Promise<number> {
  const row = await db.prepare(sql).first<NumberRow>()
  return Number(row?.n ?? 0)
}

async function getLatestDate(db: D1Database, table: string): Promise<string | null> {
  const row = await db.prepare(`SELECT MAX(collection_date) AS latest FROM ${table}`).first<DateRow>()
  return row?.latest ?? null
}

function errorDetail(error: unknown): Record<string, unknown> {
  return {
    error: (error as Error)?.message || String(error),
  }
}

export async function runIntegrityChecks(db: D1Database, timezone = 'Australia/Melbourne'): Promise<IntegritySummary> {
  const checkedAt = new Date().toISOString()
  const nowMelbourneDate = getMelbourneNowParts(new Date(), timezone).date

  const checks: IntegrityCheckResult[] = []

  try {
    const [homeMismatches, savingsMismatches, tdMismatches] = await Promise.all([
      getSingleCount(
        db,
        `SELECT COUNT(*) AS n
         FROM vw_rate_timeseries
         WHERE product_key IS NULL
            OR product_key != (
              bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure
            )`,
      ),
      getSingleCount(
        db,
        `SELECT COUNT(*) AS n
         FROM vw_savings_timeseries
         WHERE product_key IS NULL
            OR product_key != (
              bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier
            )`,
      ),
      getSingleCount(
        db,
        `SELECT COUNT(*) AS n
         FROM vw_td_timeseries
         WHERE product_key IS NULL
            OR product_key != (
              bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier
            )`,
      ),
    ])
    checks.push({
      name: 'product_key_consistency',
      passed: homeMismatches + savingsMismatches + tdMismatches === 0,
      detail: {
        home_loan_mismatches: homeMismatches,
        savings_mismatches: savingsMismatches,
        term_deposit_mismatches: tdMismatches,
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
