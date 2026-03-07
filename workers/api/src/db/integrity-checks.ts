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
type FreshnessMismatchRow = {
  dataset: string
  global_latest: string | null
  scheduled_latest: string | null
  latest_global_mismatch: number | null
}
type RunsNoOutputsRow = {
  run_id: string
  run_type: string
  run_source: string
  status: string
  started_at: string
  home_rows: number
  savings_rows: number
  td_rows: number
  problematic_dataset_rows?: number
}
type IntegrityOptions = {
  includeAnomalyProbes?: boolean
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

async function runOptionalAnomalyProbes(db: D1Database, checks: IntegrityCheckResult[]): Promise<void> {
  try {
    const hasPresence = await tableExists(db, 'product_presence_status')
    const hasCatalog = await tableExists(db, 'product_catalog')
    if (!hasPresence || !hasCatalog) {
      checks.push({
        name: 'orphan_product_presence_status',
        passed: false,
        detail: {
          error: 'required_tables_missing',
          product_presence_status: hasPresence,
          product_catalog: hasCatalog,
        },
      })
    } else {
      const orphanCountRow = await db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM product_presence_status p
           LEFT JOIN product_catalog c
             ON c.dataset_kind = p.section
            AND c.bank_name = p.bank_name
            AND c.product_id = p.product_id
           WHERE c.product_id IS NULL`,
        )
        .first<NumberRow>()
      const sampleRows = await db
        .prepare(
          `SELECT p.section, p.bank_name, p.product_id, p.last_seen_collection_date, p.last_seen_at
           FROM product_presence_status p
           LEFT JOIN product_catalog c
             ON c.dataset_kind = p.section
            AND c.bank_name = p.bank_name
            AND c.product_id = p.product_id
           WHERE c.product_id IS NULL
           ORDER BY p.last_seen_at DESC
           LIMIT 20`,
        )
        .all<Record<string, unknown>>()

      checks.push({
        name: 'orphan_product_presence_status',
        passed: Number(orphanCountRow?.n ?? 0) === 0,
        detail: {
          orphan_count: Number(orphanCountRow?.n ?? 0),
          sample: sampleRows.results ?? [],
        },
      })
    }
  } catch (error) {
    checks.push({
      name: 'orphan_product_presence_status',
      passed: false,
      detail: errorDetail(error),
    })
  }

  try {
    const hasFetchEvents = await tableExists(db, 'fetch_events')
    const hasObjects = await tableExists(db, 'raw_objects')
    if (!hasFetchEvents || !hasObjects) {
      checks.push({
        name: 'fetch_event_raw_object_linkage',
        passed: false,
        detail: {
          error: 'required_tables_missing',
          fetch_events: hasFetchEvents,
          raw_objects: hasObjects,
        },
      })
    } else {
      const orphanCountRow = await db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM fetch_events fe
           LEFT JOIN raw_objects ro
             ON ro.content_hash = fe.content_hash
           WHERE ro.content_hash IS NULL`,
        )
        .first<NumberRow>()
      const sampleRows = await db
        .prepare(
          `SELECT fe.id, fe.source_type, fe.fetched_at, fe.source_url, fe.content_hash
           FROM fetch_events fe
           LEFT JOIN raw_objects ro
             ON ro.content_hash = fe.content_hash
           WHERE ro.content_hash IS NULL
           ORDER BY fe.fetched_at DESC
           LIMIT 20`,
        )
        .all<Record<string, unknown>>()
      checks.push({
        name: 'fetch_event_raw_object_linkage',
        passed: Number(orphanCountRow?.n ?? 0) === 0,
        detail: {
          orphan_count: Number(orphanCountRow?.n ?? 0),
          sample: sampleRows.results ?? [],
        },
      })
    }
  } catch (error) {
    checks.push({
      name: 'fetch_event_raw_object_linkage',
      passed: false,
      detail: errorDetail(error),
    })
  }

  try {
    const requiredTables = await Promise.all([
      tableExists(db, 'run_reports'),
      tableExists(db, 'historical_loan_rates'),
      tableExists(db, 'historical_savings_rates'),
      tableExists(db, 'historical_term_deposit_rates'),
      tableExists(db, 'lender_dataset_runs'),
    ])
    if (requiredTables.some((exists) => !exists)) {
      checks.push({
        name: 'runs_with_no_outputs',
        passed: false,
        detail: {
          error: 'required_tables_missing',
          run_reports: requiredTables[0],
          historical_loan_rates: requiredTables[1],
          historical_savings_rates: requiredTables[2],
          historical_term_deposit_rates: requiredTables[3],
          lender_dataset_runs: requiredTables[4],
        },
      })
    } else {
      const countRow = await db
        .prepare(
          `WITH run_outputs AS (
             SELECT
               rr.run_id,
               rr.status,
               (SELECT COUNT(*) FROM historical_loan_rates hl WHERE hl.run_id = rr.run_id) AS home_rows,
               (SELECT COUNT(*) FROM historical_savings_rates hs WHERE hs.run_id = rr.run_id) AS savings_rows,
               (SELECT COUNT(*) FROM historical_term_deposit_rates ht WHERE ht.run_id = rr.run_id) AS td_rows
             FROM run_reports rr
           ),
           run_violations AS (
             SELECT
               run_id,
               SUM(
                 CASE
                   WHEN COALESCE(lineage_error_count, 0) > 0
                     OR (
                       COALESCE(written_row_count, 0) = 0
                       AND NOT (
                         COALESCE(index_fetch_succeeded, 0) = 1
                         AND COALESCE(expected_detail_count, 0) = 0
                         AND COALESCE(lineage_error_count, 0) = 0
                       )
                     )
                   THEN 1 ELSE 0
                 END
               ) AS problematic_dataset_rows
             FROM lender_dataset_runs
             GROUP BY run_id
           )
           SELECT COUNT(*) AS n
           FROM run_outputs
           LEFT JOIN run_violations rv
             ON rv.run_id = run_outputs.run_id
           WHERE status = 'ok'
             AND (home_rows + savings_rows + td_rows) = 0
             AND COALESCE(rv.problematic_dataset_rows, 0) > 0`,
        )
        .first<NumberRow>()

      const sampleRows = await db
        .prepare(
          `WITH run_outputs AS (
             SELECT
               rr.run_id,
               rr.run_type,
               rr.run_source,
               rr.status,
               rr.started_at,
               (SELECT COUNT(*) FROM historical_loan_rates hl WHERE hl.run_id = rr.run_id) AS home_rows,
               (SELECT COUNT(*) FROM historical_savings_rates hs WHERE hs.run_id = rr.run_id) AS savings_rows,
               (SELECT COUNT(*) FROM historical_term_deposit_rates ht WHERE ht.run_id = rr.run_id) AS td_rows
             FROM run_reports rr
           ),
           run_violations AS (
             SELECT
               run_id,
               SUM(
                 CASE
                   WHEN COALESCE(lineage_error_count, 0) > 0
                     OR (
                       COALESCE(written_row_count, 0) = 0
                       AND NOT (
                         COALESCE(index_fetch_succeeded, 0) = 1
                         AND COALESCE(expected_detail_count, 0) = 0
                         AND COALESCE(lineage_error_count, 0) = 0
                       )
                     )
                   THEN 1 ELSE 0
                 END
               ) AS problematic_dataset_rows
             FROM lender_dataset_runs
             GROUP BY run_id
           )
           SELECT
             run_outputs.run_id,
             run_type,
             run_source,
             status,
             started_at,
             home_rows,
             savings_rows,
             td_rows,
             COALESCE(rv.problematic_dataset_rows, 0) AS problematic_dataset_rows
           FROM run_outputs
           LEFT JOIN run_violations rv
             ON rv.run_id = run_outputs.run_id
           WHERE status = 'ok'
             AND (home_rows + savings_rows + td_rows) = 0
             AND COALESCE(rv.problematic_dataset_rows, 0) > 0
           ORDER BY started_at DESC
           LIMIT 20`,
        )
        .all<RunsNoOutputsRow>()

      checks.push({
        name: 'runs_with_no_outputs',
        passed: Number(countRow?.n ?? 0) === 0,
        detail: {
          orphan_run_count: Number(countRow?.n ?? 0),
          sample: sampleRows.results ?? [],
        },
      })
    }
  } catch (error) {
    checks.push({
      name: 'runs_with_no_outputs',
      passed: false,
      detail: errorDetail(error),
    })
  }

  try {
    const hasPayloads = await tableExists(db, 'raw_payloads')
    const hasObjects = await tableExists(db, 'raw_objects')
    if (!hasPayloads || !hasObjects) {
      checks.push({
        name: 'legacy_raw_payload_backlog',
        passed: true,
        detail: {
          available: false,
          raw_payloads: hasPayloads,
          raw_objects: hasObjects,
        },
      })
    } else {
      const orphanCountRow = await db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM raw_payloads rp
           LEFT JOIN raw_objects ro
             ON ro.content_hash = rp.content_hash
           WHERE ro.content_hash IS NULL`,
        )
        .first<NumberRow>()
      const sampleRows = await db
        .prepare(
          `SELECT rp.id, rp.source_type, rp.fetched_at, rp.source_url, rp.content_hash, rp.r2_key
           FROM raw_payloads rp
           LEFT JOIN raw_objects ro
             ON ro.content_hash = rp.content_hash
           WHERE ro.content_hash IS NULL
           ORDER BY rp.fetched_at DESC
           LIMIT 20`,
        )
        .all<Record<string, unknown>>()
      checks.push({
        name: 'legacy_raw_payload_backlog',
        passed: true,
        detail: {
          orphan_count: Number(orphanCountRow?.n ?? 0),
          sample: sampleRows.results ?? [],
        },
      })
    }
  } catch (error) {
    checks.push({
      name: 'legacy_raw_payload_backlog',
      passed: true,
      detail: errorDetail(error),
    })
  }

  try {
    const datasetRows = await db
      .prepare(
        `WITH dataset_latest AS (
           SELECT
             'home_loans' AS dataset,
             MAX(collection_date) AS global_latest,
             MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest
           FROM historical_loan_rates
           UNION ALL
           SELECT
             'savings' AS dataset,
             MAX(collection_date) AS global_latest,
             MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest
           FROM historical_savings_rates
           UNION ALL
           SELECT
             'term_deposits' AS dataset,
             MAX(collection_date) AS global_latest,
             MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest
           FROM historical_term_deposit_rates
         )
         SELECT
           dataset,
           global_latest,
           scheduled_latest,
           CASE
             WHEN global_latest IS NULL OR scheduled_latest IS NULL THEN NULL
             WHEN global_latest = scheduled_latest THEN 0
             ELSE 1
           END AS latest_global_mismatch
         FROM dataset_latest
         ORDER BY dataset`,
      )
      .all<FreshnessMismatchRow>()

    const rows = datasetRows.results ?? []
    const mismatchCount = rows.filter((row) => Number(row.latest_global_mismatch ?? 0) === 1).length
    checks.push({
      name: 'latest_vs_global_freshness_indicator',
      passed: true,
      detail: {
        indicator_only: true,
        mismatch_dataset_count: mismatchCount,
        datasets: rows,
      },
    })
  } catch (error) {
    checks.push({
      name: 'latest_vs_global_freshness_indicator',
      passed: false,
      detail: errorDetail(error),
    })
  }
}

export async function runIntegrityChecks(
  db: D1Database,
  timezone = 'Australia/Melbourne',
  options?: IntegrityOptions,
): Promise<IntegritySummary> {
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
        expectedExpr:
          `bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier || '|' || interest_payment`,
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

  if (options?.includeAnomalyProbes) {
    await runOptionalAnomalyProbes(db, checks)
  }

  return {
    ok: checks.every((check) => check.passed),
    checked_at: checkedAt,
    checks,
  }
}
