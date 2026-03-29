import { RUN_REPORTS_RETENTION_DAYS } from './retention-prune'

type IntegrityCheckResult = {
  name: string
  passed: boolean
  detail: Record<string, unknown>
}

type NumberRow = { n: number | null }
type CountByDatasetRow = { dataset: string; n: number | null }
type WriteContractViolationSampleRow = {
  dataset_kind: string
  lender_code: string | null
  collection_date: string | null
  reason: string
  run_id: string | null
  product_id: string | null
  created_at: string
}
type RecentWriteActivityRow = {
  dataset: string
  rows_written: number | null
  distinct_run_count: number | null
  latest_parsed_at: string | null
}
type SameDayConflictSampleRow = {
  dataset: string
  series_key: string
  collection_date: string
  row_count: number | null
  distinct_interest_rate_count: number | null
  distinct_product_name_count: number | null
  distinct_source_url_count: number | null
  distinct_product_url_count: number | null
}
type AbruptMovementSampleRow = {
  dataset: string
  series_key: string
  previous_collection_date: string
  collection_date: string
  previous_interest_rate: number | null
  interest_rate: number | null
  delta: number | null
  gap_days: number | null
}

function errorDetail(error: unknown): Record<string, unknown> {
  return {
    error: (error as Error)?.message || String(error),
  }
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

export async function runHistoricalAnomalyChecks(db: D1Database): Promise<IntegrityCheckResult[]> {
  const checks: IntegrityCheckResult[] = []
  const retainedRunWindow = `-${RUN_REPORTS_RETENTION_DAYS} days`

  try {
    const hasAnomalies = await tableExists(db, 'ingest_anomalies')
    if (!hasAnomalies) {
      checks.push({
        name: 'recent_blocked_write_contract_violations',
        passed: false,
        detail: {
          error: 'required_tables_missing',
          ingest_anomalies: false,
        },
      })
    } else {
      const summaryRows = await db
        .prepare(
          `SELECT dataset_kind AS dataset, COUNT(*) AS n
           FROM ingest_anomalies
           WHERE datetime(created_at) >= datetime('now', ?1)
             AND reason LIKE 'write_contract_violation:%'
           GROUP BY dataset_kind
           ORDER BY dataset_kind`,
        )
        .bind(retainedRunWindow)
        .all<CountByDatasetRow>()
      const sampleRows = await db
        .prepare(
          `SELECT dataset_kind, lender_code, collection_date, reason, run_id, product_id, created_at
           FROM ingest_anomalies
           WHERE datetime(created_at) >= datetime('now', ?1)
             AND reason LIKE 'write_contract_violation:%'
           ORDER BY created_at DESC
           LIMIT 20`,
        )
        .bind(retainedRunWindow)
        .all<WriteContractViolationSampleRow>()
      const byDataset = (summaryRows.results ?? []).reduce<Record<string, number>>((acc, row) => {
        acc[String(row.dataset || 'unknown')] = Number(row.n ?? 0)
        return acc
      }, {})
      const total = Object.values(byDataset).reduce((sum, value) => sum + value, 0)
      checks.push({
        name: 'recent_blocked_write_contract_violations',
        passed: total === 0,
        detail: {
          window: `${RUN_REPORTS_RETENTION_DAYS}_days`,
          blocked_violation_count: total,
          by_dataset: byDataset,
          sample: sampleRows.results ?? [],
        },
      })
    }
  } catch (error) {
    checks.push({
      name: 'recent_blocked_write_contract_violations',
      passed: false,
      detail: errorDetail(error),
    })
  }

  try {
    const requiredTables = await Promise.all([
      tableExists(db, 'historical_loan_rates'),
      tableExists(db, 'historical_savings_rates'),
      tableExists(db, 'historical_term_deposit_rates'),
    ])
    if (requiredTables.some((exists) => !exists)) {
      checks.push({
        name: 'recent_persisted_write_activity',
        passed: false,
        detail: {
          error: 'required_tables_missing',
          historical_loan_rates: requiredTables[0],
          historical_savings_rates: requiredTables[1],
          historical_term_deposit_rates: requiredTables[2],
        },
      })
    } else {
      const rows = await db
        .prepare(
          `WITH recent AS (
             SELECT 'home_loans' AS dataset, run_id, parsed_at
             FROM historical_loan_rates
             WHERE datetime(parsed_at) >= datetime('now', '-24 hours')
             UNION ALL
             SELECT 'savings' AS dataset, run_id, parsed_at
             FROM historical_savings_rates
             WHERE datetime(parsed_at) >= datetime('now', '-24 hours')
             UNION ALL
             SELECT 'term_deposits' AS dataset, run_id, parsed_at
             FROM historical_term_deposit_rates
             WHERE datetime(parsed_at) >= datetime('now', '-24 hours')
           )
           SELECT
             dataset,
             COUNT(*) AS rows_written,
             COUNT(DISTINCT COALESCE(run_id, '')) AS distinct_run_count,
             MAX(parsed_at) AS latest_parsed_at
           FROM recent
           GROUP BY dataset
           ORDER BY dataset`,
        )
        .all<RecentWriteActivityRow>()
      checks.push({
        name: 'recent_persisted_write_activity',
        passed: true,
        detail: {
          window: '24_hours',
          datasets: (rows.results ?? []).map((row) => ({
            dataset: row.dataset,
            rows_written: Number(row.rows_written ?? 0),
            distinct_run_count: Number(row.distinct_run_count ?? 0),
            latest_parsed_at: row.latest_parsed_at,
          })),
        },
      })
    }
  } catch (error) {
    checks.push({
      name: 'recent_persisted_write_activity',
      passed: false,
      detail: errorDetail(error),
    })
  }

  try {
    const requiredTables = await Promise.all([
      tableExists(db, 'historical_loan_rates'),
      tableExists(db, 'historical_savings_rates'),
      tableExists(db, 'historical_term_deposit_rates'),
    ])
    if (requiredTables.some((exists) => !exists)) {
      checks.push({
        name: 'recent_same_day_series_conflicts',
        passed: false,
        detail: {
          error: 'required_tables_missing',
          historical_loan_rates: requiredTables[0],
          historical_savings_rates: requiredTables[1],
          historical_term_deposit_rates: requiredTables[2],
        },
      })
    } else {
      const summaryRows = await db
        .prepare(
          `WITH recent AS (
             SELECT
               'home_loans' AS dataset,
               series_key,
               collection_date,
               COUNT(*) AS row_count,
               COUNT(DISTINCT printf('%.5f', interest_rate)) AS distinct_interest_rate_count,
               COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) AS distinct_product_name_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) AS distinct_source_url_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) AS distinct_product_url_count
             FROM historical_loan_rates
             WHERE collection_date >= date('now', '-30 days')
             GROUP BY series_key, collection_date
             HAVING COUNT(*) > 1
               AND (
                 COUNT(DISTINCT printf('%.5f', interest_rate)) > 1
                 OR COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) > 1
               )
             UNION ALL
             SELECT
               'savings' AS dataset,
               series_key,
               collection_date,
               COUNT(*) AS row_count,
               COUNT(DISTINCT printf('%.5f', interest_rate)) AS distinct_interest_rate_count,
               COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) AS distinct_product_name_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) AS distinct_source_url_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) AS distinct_product_url_count
             FROM historical_savings_rates
             WHERE collection_date >= date('now', '-30 days')
             GROUP BY series_key, collection_date
             HAVING COUNT(*) > 1
               AND (
                 COUNT(DISTINCT printf('%.5f', interest_rate)) > 1
                 OR COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) > 1
               )
             UNION ALL
             SELECT
               'term_deposits' AS dataset,
               series_key,
               collection_date,
               COUNT(*) AS row_count,
               COUNT(DISTINCT printf('%.5f', interest_rate)) AS distinct_interest_rate_count,
               COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) AS distinct_product_name_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) AS distinct_source_url_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) AS distinct_product_url_count
             FROM historical_term_deposit_rates
             WHERE collection_date >= date('now', '-30 days')
             GROUP BY series_key, collection_date
             HAVING COUNT(*) > 1
               AND (
                 COUNT(DISTINCT printf('%.5f', interest_rate)) > 1
                 OR COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) > 1
               )
           )
           SELECT dataset, COUNT(*) AS n
           FROM recent
           GROUP BY dataset
           ORDER BY dataset`,
        )
        .all<CountByDatasetRow>()
      const sampleRows = await db
        .prepare(
          `WITH recent AS (
             SELECT
               'home_loans' AS dataset,
               series_key,
               collection_date,
               COUNT(*) AS row_count,
               COUNT(DISTINCT printf('%.5f', interest_rate)) AS distinct_interest_rate_count,
               COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) AS distinct_product_name_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) AS distinct_source_url_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) AS distinct_product_url_count
             FROM historical_loan_rates
             WHERE collection_date >= date('now', '-30 days')
             GROUP BY series_key, collection_date
             HAVING COUNT(*) > 1
               AND (
                 COUNT(DISTINCT printf('%.5f', interest_rate)) > 1
                 OR COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) > 1
               )
             UNION ALL
             SELECT
               'savings' AS dataset,
               series_key,
               collection_date,
               COUNT(*) AS row_count,
               COUNT(DISTINCT printf('%.5f', interest_rate)) AS distinct_interest_rate_count,
               COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) AS distinct_product_name_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) AS distinct_source_url_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) AS distinct_product_url_count
             FROM historical_savings_rates
             WHERE collection_date >= date('now', '-30 days')
             GROUP BY series_key, collection_date
             HAVING COUNT(*) > 1
               AND (
                 COUNT(DISTINCT printf('%.5f', interest_rate)) > 1
                 OR COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) > 1
               )
             UNION ALL
             SELECT
               'term_deposits' AS dataset,
               series_key,
               collection_date,
               COUNT(*) AS row_count,
               COUNT(DISTINCT printf('%.5f', interest_rate)) AS distinct_interest_rate_count,
               COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) AS distinct_product_name_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) AS distinct_source_url_count,
               COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) AS distinct_product_url_count
             FROM historical_term_deposit_rates
             WHERE collection_date >= date('now', '-30 days')
             GROUP BY series_key, collection_date
             HAVING COUNT(*) > 1
               AND (
                 COUNT(DISTINCT printf('%.5f', interest_rate)) > 1
                 OR COUNT(DISTINCT TRIM(COALESCE(product_name, ''))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(source_url, '')))) > 1
                 OR COUNT(DISTINCT LOWER(TRIM(COALESCE(product_url, '')))) > 1
               )
           )
           SELECT
             dataset,
             series_key,
             collection_date,
             row_count,
             distinct_interest_rate_count,
             distinct_product_name_count,
             distinct_source_url_count,
             distinct_product_url_count
           FROM recent
           ORDER BY collection_date DESC, dataset, series_key
           LIMIT 20`,
        )
        .all<SameDayConflictSampleRow>()
      const byDataset = (summaryRows.results ?? []).reduce<Record<string, number>>((acc, row) => {
        acc[String(row.dataset || 'unknown')] = Number(row.n ?? 0)
        return acc
      }, {})
      const total = Object.values(byDataset).reduce((sum, value) => sum + value, 0)
      checks.push({
        name: 'recent_same_day_series_conflicts',
        passed: total === 0,
        detail: {
          window: '30_days',
          conflict_group_count: total,
          by_dataset: byDataset,
          sample: sampleRows.results ?? [],
        },
      })
    }
  } catch (error) {
    checks.push({
      name: 'recent_same_day_series_conflicts',
      passed: false,
      detail: errorDetail(error),
    })
  }

  try {
    const requiredTables = await Promise.all([
      tableExists(db, 'historical_loan_rates'),
      tableExists(db, 'historical_savings_rates'),
      tableExists(db, 'historical_term_deposit_rates'),
    ])
    if (requiredTables.some((exists) => !exists)) {
      checks.push({
        name: 'recent_abrupt_rate_movements',
        passed: false,
        detail: {
          error: 'required_tables_missing',
          historical_loan_rates: requiredTables[0],
          historical_savings_rates: requiredTables[1],
          historical_term_deposit_rates: requiredTables[2],
        },
      })
    } else {
      const summaryRows = await db
        .prepare(
          `WITH recent AS (
             SELECT 'home_loans' AS dataset, series_key, collection_date, interest_rate
             FROM historical_loan_rates
             WHERE collection_date >= date('now', '-30 days')
             UNION ALL
             SELECT 'savings' AS dataset, series_key, collection_date, interest_rate
             FROM historical_savings_rates
             WHERE collection_date >= date('now', '-30 days')
             UNION ALL
             SELECT 'term_deposits' AS dataset, series_key, collection_date, interest_rate
             FROM historical_term_deposit_rates
             WHERE collection_date >= date('now', '-30 days')
           ),
           ordered AS (
             SELECT
               dataset,
               series_key,
               collection_date,
               interest_rate,
               LAG(collection_date) OVER (PARTITION BY dataset, series_key ORDER BY collection_date) AS previous_collection_date,
               LAG(interest_rate) OVER (PARTITION BY dataset, series_key ORDER BY collection_date) AS previous_interest_rate
             FROM recent
           ),
           suspicious AS (
             SELECT
               dataset,
               series_key,
               previous_collection_date,
               collection_date,
               previous_interest_rate,
               interest_rate,
               ABS(interest_rate - previous_interest_rate) AS delta,
               CAST(ROUND(julianday(collection_date) - julianday(previous_collection_date)) AS INTEGER) AS gap_days
             FROM ordered
             WHERE previous_collection_date IS NOT NULL
               AND (julianday(collection_date) - julianday(previous_collection_date)) BETWEEN 0 AND 7
               AND ABS(interest_rate - previous_interest_rate) >= 5
           )
           SELECT dataset, COUNT(*) AS n
           FROM suspicious
           GROUP BY dataset
           ORDER BY dataset`,
        )
        .all<CountByDatasetRow>()
      const sampleRows = await db
        .prepare(
          `WITH recent AS (
             SELECT 'home_loans' AS dataset, series_key, collection_date, interest_rate
             FROM historical_loan_rates
             WHERE collection_date >= date('now', '-30 days')
             UNION ALL
             SELECT 'savings' AS dataset, series_key, collection_date, interest_rate
             FROM historical_savings_rates
             WHERE collection_date >= date('now', '-30 days')
             UNION ALL
             SELECT 'term_deposits' AS dataset, series_key, collection_date, interest_rate
             FROM historical_term_deposit_rates
             WHERE collection_date >= date('now', '-30 days')
           ),
           ordered AS (
             SELECT
               dataset,
               series_key,
               collection_date,
               interest_rate,
               LAG(collection_date) OVER (PARTITION BY dataset, series_key ORDER BY collection_date) AS previous_collection_date,
               LAG(interest_rate) OVER (PARTITION BY dataset, series_key ORDER BY collection_date) AS previous_interest_rate
             FROM recent
           ),
           suspicious AS (
             SELECT
               dataset,
               series_key,
               previous_collection_date,
               collection_date,
               previous_interest_rate,
               interest_rate,
               ABS(interest_rate - previous_interest_rate) AS delta,
               CAST(ROUND(julianday(collection_date) - julianday(previous_collection_date)) AS INTEGER) AS gap_days
             FROM ordered
             WHERE previous_collection_date IS NOT NULL
               AND (julianday(collection_date) - julianday(previous_collection_date)) BETWEEN 0 AND 7
               AND ABS(interest_rate - previous_interest_rate) >= 5
           )
           SELECT
             dataset,
             series_key,
             previous_collection_date,
             collection_date,
             previous_interest_rate,
             interest_rate,
             delta,
             gap_days
           FROM suspicious
           ORDER BY collection_date DESC, dataset, series_key
           LIMIT 20`,
        )
        .all<AbruptMovementSampleRow>()
      const byDataset = (summaryRows.results ?? []).reduce<Record<string, number>>((acc, row) => {
        acc[String(row.dataset || 'unknown')] = Number(row.n ?? 0)
        return acc
      }, {})
      const total = Object.values(byDataset).reduce((sum, value) => sum + value, 0)
      checks.push({
        name: 'recent_abrupt_rate_movements',
        passed: total === 0,
        detail: {
          window: '30_days',
          delta_threshold_pct_points: 5,
          max_gap_days: 7,
          movement_count: total,
          by_dataset: byDataset,
          sample: sampleRows.results ?? [],
        },
      })
    }
  } catch (error) {
    checks.push({
      name: 'recent_abrupt_rate_movements',
      passed: false,
      detail: errorDetail(error),
    })
  }

  return checks
}
