import type { DatasetKind } from '../../../../packages/shared/src'
import { TARGET_LENDERS } from '../constants'
import {
  pickBestDailyLenderDatasetStatusRows,
  type DailyLenderDatasetStatusRow,
} from './lender-dataset-status'
import { isLenderDatasetCollectionComplete, assessLenderDatasetCoverage } from '../utils/lender-dataset-invariants'

type IntegrityCheckResult = {
  name: string
  passed: boolean
  detail: Record<string, unknown>
}

type NumberRow = { n: number | null }
type DateRow = { latest: string | null }
type CurrentLineageSummaryRow = { dataset: string; n: number | null; total_rows: number | null }
type CurrentLineageSampleRow = {
  dataset: string
  bank_name: string
  product_id: string
  collection_date: string
  run_id: string | null
  fetch_event_id: number | null
  issue_reason: string
}
type RunSeenProductRow = {
  run_id: string
  lender_code: string
  dataset_kind: string
  bank_name: string
  product_id: string
}
type HistoricalProductRow = {
  run_id: string
  dataset_kind: string
  bank_name: string
  product_id: string
}
type FetchEventProductRow = {
  run_id: string
  lender_code: string
  dataset_kind: string
  product_id: string
}
type IngestAnomalyProductRow = {
  run_id: string
  lender_code: string
  dataset_kind: string
  product_id: string
}
type StatusRowRecord = DailyLenderDatasetStatusRow
type RosterIssue = {
  lender_code: string
  bank_name: string
  dataset_kind: DatasetKind
  collection_date: string
  run_id: string | null
  reasons: string[]
  expected_product_count: number
  accounted_product_count: number
  stored_product_count: number
  missing_expected_product_ids: string[]
  unexpected_stored_product_ids: string[]
}

const DATASETS: DatasetKind[] = ['home_loans', 'savings', 'term_deposits']

function configuredBankName(lender: (typeof TARGET_LENDERS)[number]): string {
  return String(lender.canonical_bank_name || lender.name || '').trim()
}

function keyForStatusRow(row: Pick<DailyLenderDatasetStatusRow, 'lender_code' | 'dataset_kind'>): string {
  return `${row.lender_code}|${row.dataset_kind}`
}

function keyForRunSeenProduct(row: Pick<RunSeenProductRow, 'run_id' | 'lender_code' | 'dataset_kind' | 'bank_name'>): string {
  return `${row.run_id}|${row.lender_code}|${row.dataset_kind}|${row.bank_name}`
}

function keyForStoredProduct(row: Pick<HistoricalProductRow, 'run_id' | 'dataset_kind' | 'bank_name'>): string {
  return `${row.run_id}|${row.dataset_kind}|${row.bank_name}`
}

function keyForScopedProductOutcome(
  row: Pick<FetchEventProductRow, 'run_id' | 'lender_code' | 'dataset_kind'>,
): string {
  return `${row.run_id}|${row.lender_code}|${row.dataset_kind}`
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => String(value || '').trim()).filter(Boolean))).sort()
}

function unionProductSets(...sets: Array<Set<string> | undefined>): Set<string> {
  const merged = new Set<string>()
  for (const next of sets) {
    for (const value of next ?? []) merged.add(value)
  }
  return merged
}

export function pickCurrentCollectionStatusRow(
  rows: DailyLenderDatasetStatusRow[],
): DailyLenderDatasetStatusRow | undefined {
  if (!rows.length) return undefined
  return pickBestDailyLenderDatasetStatusRows(rows, rows.length)[0] ?? rows[0]
}

export function summarizeCurrentCollectionRoster(input: {
  expectedProductIds: Iterable<string>
  storedProductIds?: Iterable<string>
  successfulDetailFetchProductIds?: Iterable<string>
  anomalyProductIds?: Iterable<string>
}): {
  accountedProductIds: string[]
  missingExpectedProductIds: string[]
  unexpectedStoredProductIds: string[]
} {
  const expected = new Set(sortedUnique(input.expectedProductIds))
  const stored = new Set(sortedUnique(input.storedProductIds ?? []))
  const successfulDetailFetches = new Set(sortedUnique(input.successfulDetailFetchProductIds ?? []))
  const anomalies = new Set(sortedUnique(input.anomalyProductIds ?? []))
  const accounted = unionProductSets(stored, successfulDetailFetches, anomalies)

  return {
    accountedProductIds: Array.from(accounted).sort(),
    missingExpectedProductIds: Array.from(expected)
      .filter((productId) => !accounted.has(productId))
      .sort(),
    unexpectedStoredProductIds: Array.from(stored)
      .filter((productId) => !expected.has(productId))
      .sort(),
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

async function resolveActiveCollectionDate(db: D1Database, melbourneDate: string): Promise<string> {
  const todayRow = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM lender_dataset_runs
       WHERE collection_date = ?1`,
    )
    .bind(melbourneDate)
    .first<NumberRow>()
  if (Number(todayRow?.n ?? 0) > 0) return melbourneDate

  const latestRow = await db
    .prepare(
      `SELECT MAX(collection_date) AS latest
       FROM lender_dataset_runs`,
    )
    .first<DateRow>()
  return String(latestRow?.latest || '').trim() || melbourneDate
}

async function runCurrentCollectionExactProvenanceCheck(
  db: D1Database,
  melbourneDate: string,
): Promise<IntegrityCheckResult> {
  const collectionDate = await resolveActiveCollectionDate(db, melbourneDate)
  const requiredTables = await Promise.all([
    tableExists(db, 'historical_loan_rates'),
    tableExists(db, 'historical_savings_rates'),
    tableExists(db, 'historical_term_deposit_rates'),
    tableExists(db, 'fetch_events'),
    tableExists(db, 'raw_objects'),
  ])
  if (requiredTables.some((exists) => !exists)) {
    return {
      name: 'current_collection_exact_provenance',
      passed: false,
      detail: {
        error: 'required_tables_missing',
        historical_loan_rates: requiredTables[0],
        historical_savings_rates: requiredTables[1],
        historical_term_deposit_rates: requiredTables[2],
        fetch_events: requiredTables[3],
        raw_objects: requiredTables[4],
      },
    }
  }

  const summaryRows = await db
    .prepare(
      `WITH current_rows AS (
         SELECT 'home_loans' AS dataset, bank_name, product_id, collection_date, run_id, fetch_event_id
         FROM historical_loan_rates
         WHERE collection_date = ?1
         UNION ALL
         SELECT 'savings' AS dataset, bank_name, product_id, collection_date, run_id, fetch_event_id
         FROM historical_savings_rates
         WHERE collection_date = ?1
         UNION ALL
         SELECT 'term_deposits' AS dataset, bank_name, product_id, collection_date, run_id, fetch_event_id
         FROM historical_term_deposit_rates
         WHERE collection_date = ?1
       )
       SELECT
         current_rows.dataset,
         SUM(
           CASE
             WHEN current_rows.fetch_event_id IS NULL OR fe.id IS NULL OR ro.content_hash IS NULL
             THEN 1 ELSE 0
           END
         ) AS n,
         COUNT(*) AS total_rows
       FROM current_rows
       LEFT JOIN fetch_events fe
         ON fe.id = current_rows.fetch_event_id
       LEFT JOIN raw_objects ro
         ON ro.content_hash = fe.content_hash
       GROUP BY current_rows.dataset
       ORDER BY current_rows.dataset`,
    )
    .bind(collectionDate)
    .all<CurrentLineageSummaryRow>()
  const sampleRows = await db
    .prepare(
      `WITH current_rows AS (
         SELECT 'home_loans' AS dataset, bank_name, product_id, collection_date, run_id, fetch_event_id
         FROM historical_loan_rates
         WHERE collection_date = ?1
         UNION ALL
         SELECT 'savings' AS dataset, bank_name, product_id, collection_date, run_id, fetch_event_id
         FROM historical_savings_rates
         WHERE collection_date = ?1
         UNION ALL
         SELECT 'term_deposits' AS dataset, bank_name, product_id, collection_date, run_id, fetch_event_id
         FROM historical_term_deposit_rates
         WHERE collection_date = ?1
       )
       SELECT
         current_rows.dataset,
         current_rows.bank_name,
         current_rows.product_id,
         current_rows.collection_date,
         current_rows.run_id,
         current_rows.fetch_event_id,
         CASE
           WHEN current_rows.fetch_event_id IS NULL THEN 'missing_fetch_event_id'
           WHEN fe.id IS NULL THEN 'missing_fetch_event'
           WHEN ro.content_hash IS NULL THEN 'missing_raw_object'
           ELSE 'verified_exact'
         END AS issue_reason
       FROM current_rows
       LEFT JOIN fetch_events fe
         ON fe.id = current_rows.fetch_event_id
       LEFT JOIN raw_objects ro
         ON ro.content_hash = fe.content_hash
       WHERE current_rows.fetch_event_id IS NULL
          OR fe.id IS NULL
          OR ro.content_hash IS NULL
       ORDER BY current_rows.dataset, current_rows.bank_name, current_rows.product_id
       LIMIT 20`,
    )
    .bind(collectionDate)
    .all<CurrentLineageSampleRow>()

  const byDataset = (summaryRows.results ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[String(row.dataset || 'unknown')] = Number(row.n ?? 0)
    return acc
  }, {})
  const totalByDataset = (summaryRows.results ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[String(row.dataset || 'unknown')] = Number(row.total_rows ?? 0)
    return acc
  }, {})
  const unverifiedRowCount = Object.values(byDataset).reduce((sum, value) => sum + value, 0)
  const totalCurrentRows = Object.values(totalByDataset).reduce((sum, value) => sum + value, 0)

  return {
    name: 'current_collection_exact_provenance',
    passed: unverifiedRowCount === 0,
    detail: {
        melbourne_date: melbourneDate,
      collection_date: collectionDate,
      unverified_row_count: unverifiedRowCount,
      total_current_rows: totalCurrentRows,
      by_dataset: byDataset,
      total_by_dataset: totalByDataset,
      sample: sampleRows.results ?? [],
    },
  }
}

async function loadRunSeenProductsByScope(
  db: D1Database,
  collectionDate: string,
): Promise<Map<string, Set<string>>> {
  const rows = await db
    .prepare(
      `SELECT run_id, lender_code, dataset_kind, bank_name, product_id
       FROM run_seen_products
       WHERE collection_date = ?1`,
    )
    .bind(collectionDate)
    .all<RunSeenProductRow>()
  const byScope = new Map<string, Set<string>>()
  for (const row of rows.results ?? []) {
    const key = keyForRunSeenProduct(row)
    if (!byScope.has(key)) byScope.set(key, new Set<string>())
    byScope.get(key)?.add(String(row.product_id || '').trim())
  }
  return byScope
}

async function loadStoredProductsByScope(
  db: D1Database,
  collectionDate: string,
): Promise<Map<string, Set<string>>> {
  const rows = await db
    .prepare(
      `SELECT run_id, dataset_kind, bank_name, product_id
       FROM (
         SELECT run_id, 'home_loans' AS dataset_kind, bank_name, product_id
         FROM historical_loan_rates
         WHERE collection_date = ?1
         UNION ALL
         SELECT run_id, 'savings' AS dataset_kind, bank_name, product_id
         FROM historical_savings_rates
         WHERE collection_date = ?1
         UNION ALL
         SELECT run_id, 'term_deposits' AS dataset_kind, bank_name, product_id
         FROM historical_term_deposit_rates
         WHERE collection_date = ?1
       ) current_rows`,
    )
    .bind(collectionDate)
    .all<HistoricalProductRow>()
  const byScope = new Map<string, Set<string>>()
  for (const row of rows.results ?? []) {
    const key = keyForStoredProduct(row)
    if (!byScope.has(key)) byScope.set(key, new Set<string>())
    byScope.get(key)?.add(String(row.product_id || '').trim())
  }
  return byScope
}

async function loadSuccessfulDetailFetchProductsByScope(
  db: D1Database,
  collectionDate: string,
): Promise<Map<string, Set<string>>> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT run_id, lender_code, dataset_kind, product_id
       FROM fetch_events
       WHERE collection_date = ?1
         AND source_type = 'cdr_product_detail'
         AND product_id IS NOT NULL
         AND TRIM(product_id) != ''
         AND http_status BETWEEN 200 AND 299`,
    )
    .bind(collectionDate)
    .all<FetchEventProductRow>()
  const byScope = new Map<string, Set<string>>()
  for (const row of rows.results ?? []) {
    const key = keyForScopedProductOutcome(row)
    if (!byScope.has(key)) byScope.set(key, new Set<string>())
    byScope.get(key)?.add(String(row.product_id || '').trim())
  }
  return byScope
}

async function loadAnomalyProductsByScope(
  db: D1Database,
  collectionDate: string,
): Promise<Map<string, Set<string>>> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT run_id, lender_code, dataset_kind, product_id
       FROM ingest_anomalies
       WHERE collection_date = ?1
         AND product_id IS NOT NULL
         AND TRIM(product_id) != ''`,
    )
    .bind(collectionDate)
    .all<IngestAnomalyProductRow>()
  const byScope = new Map<string, Set<string>>()
  for (const row of rows.results ?? []) {
    const key = keyForScopedProductOutcome(row)
    if (!byScope.has(key)) byScope.set(key, new Set<string>())
    byScope.get(key)?.add(String(row.product_id || '').trim())
  }
  return byScope
}

async function loadCollectionStatusRows(
  db: D1Database,
  collectionDate: string,
): Promise<Map<string, DailyLenderDatasetStatusRow[]>> {
  const rows = await db
    .prepare(
      `SELECT
         ldr.run_id AS run_id,
         rr.run_source AS run_source,
         ldr.lender_code AS lender_code,
         ldr.dataset_kind AS dataset_kind,
         ldr.bank_name AS bank_name,
         ldr.collection_date AS collection_date,
         ldr.expected_detail_count AS expected_detail_count,
         ldr.index_fetch_succeeded AS index_fetch_succeeded,
         ldr.accepted_row_count AS accepted_row_count,
         ldr.written_row_count AS written_row_count,
         ldr.detail_fetch_event_count AS detail_fetch_event_count,
         ldr.lineage_error_count AS lineage_error_count,
         ldr.completed_detail_count AS completed_detail_count,
         ldr.failed_detail_count AS failed_detail_count,
         ldr.finalized_at AS finalized_at,
         ldr.updated_at AS updated_at
       FROM lender_dataset_runs ldr
       JOIN run_reports rr
         ON rr.run_id = ldr.run_id
       WHERE ldr.collection_date = ?1
       ORDER BY ldr.updated_at DESC`,
    )
    .bind(collectionDate)
    .all<StatusRowRecord>()
  const grouped = new Map<string, DailyLenderDatasetStatusRow[]>()
  for (const row of rows.results ?? []) {
    const key = keyForStatusRow(row)
    const bucket = grouped.get(key) ?? []
    bucket.push(row)
    grouped.set(key, bucket)
  }
  return grouped
}

async function runCurrentCollectionExpectedProductRosterCheck(
  db: D1Database,
  melbourneDate: string,
): Promise<IntegrityCheckResult> {
  const collectionDate = await resolveActiveCollectionDate(db, melbourneDate)
  const statusRowsByScope = await loadCollectionStatusRows(db, collectionDate)
  const selectedByScope = new Map<string, DailyLenderDatasetStatusRow>()
  for (const [scopeKey, rows] of statusRowsByScope.entries()) {
    const selectedRow = pickCurrentCollectionStatusRow(rows)
    if (selectedRow) selectedByScope.set(scopeKey, selectedRow)
  }

  const [runSeenByScope, storedByScope, successfulDetailFetchByScope, anomalyByScope] = await Promise.all([
    loadRunSeenProductsByScope(db, collectionDate),
    loadStoredProductsByScope(db, collectionDate),
    loadSuccessfulDetailFetchProductsByScope(db, collectionDate),
    loadAnomalyProductsByScope(db, collectionDate),
  ])

  const issues: RosterIssue[] = []
  const byDataset: Record<string, { configured_scopes: number; failing_scopes: number; missing_expected_products: number }> =
    {}
  let missingRunScopeCount = 0
  let incompleteScopeCount = 0
  let rosterMismatchScopeCount = 0
  let missingExpectedProductCount = 0
  let unexpectedStoredProductCount = 0

  for (const dataset of DATASETS) {
    byDataset[dataset] = {
      configured_scopes: 0,
      failing_scopes: 0,
      missing_expected_products: 0,
    }
  }

  for (const lender of TARGET_LENDERS) {
    const bankName = configuredBankName(lender)
    for (const dataset of DATASETS) {
      byDataset[dataset].configured_scopes += 1
      const scopeKey = `${lender.code}|${dataset}`
      const row = selectedByScope.get(scopeKey)

      if (!row) {
        issues.push({
          lender_code: lender.code,
          bank_name: bankName,
          dataset_kind: dataset,
          collection_date: collectionDate,
          run_id: null,
          reasons: ['missing_lender_dataset_run'],
          expected_product_count: 0,
          accounted_product_count: 0,
          stored_product_count: 0,
          missing_expected_product_ids: [],
          unexpected_stored_product_ids: [],
        })
        missingRunScopeCount += 1
        byDataset[dataset].failing_scopes += 1
        continue
      }

      if (!isLenderDatasetCollectionComplete(row)) {
        const assessment = assessLenderDatasetCoverage(row)
        issues.push({
          lender_code: row.lender_code,
          bank_name: row.bank_name,
          dataset_kind: row.dataset_kind,
          collection_date: row.collection_date,
          run_id: row.run_id,
          reasons: assessment.reasons.length > 0 ? assessment.reasons : ['collection_incomplete'],
          expected_product_count: 0,
          accounted_product_count: 0,
          stored_product_count: 0,
          missing_expected_product_ids: [],
          unexpected_stored_product_ids: [],
        })
        incompleteScopeCount += 1
        byDataset[dataset].failing_scopes += 1
        continue
      }

      const seenKey = `${row.run_id}|${row.lender_code}|${row.dataset_kind}|${row.bank_name}`
      const storedKey = `${row.run_id}|${row.dataset_kind}|${row.bank_name}`
      const outcomeKey = `${row.run_id}|${row.lender_code}|${row.dataset_kind}`
      const expectedProducts = runSeenByScope.get(seenKey) ?? new Set<string>()
      const storedProducts = storedByScope.get(storedKey) ?? new Set<string>()
      const successfulDetailFetchProducts = successfulDetailFetchByScope.get(outcomeKey) ?? new Set<string>()
      const anomalyProducts = anomalyByScope.get(outcomeKey) ?? new Set<string>()
      const rosterSummary = summarizeCurrentCollectionRoster({
        expectedProductIds: expectedProducts,
        storedProductIds: storedProducts,
        successfulDetailFetchProductIds: successfulDetailFetchProducts,
        anomalyProductIds: anomalyProducts,
      })
      const missingExpectedProductIds = rosterSummary.missingExpectedProductIds
      const unexpectedStoredProductIds = rosterSummary.unexpectedStoredProductIds
      const reasons: string[] = []

      if (expectedProducts.size === 0 && (Number(row.expected_detail_count ?? 0) > 0 || Number(row.written_row_count ?? 0) > 0)) {
        reasons.push('missing_upstream_product_roster')
      }
      if (missingExpectedProductIds.length > 0) {
        reasons.push('missing_expected_products')
      }
      if (expectedProducts.size > 0 && unexpectedStoredProductIds.length > 0) {
        reasons.push('unexpected_stored_products')
      }
      if (reasons.length === 0) continue

      issues.push({
        lender_code: row.lender_code,
        bank_name: row.bank_name,
        dataset_kind: row.dataset_kind,
        collection_date: row.collection_date,
        run_id: row.run_id,
        reasons,
        expected_product_count: expectedProducts.size,
        accounted_product_count: rosterSummary.accountedProductIds.length,
        stored_product_count: storedProducts.size,
        missing_expected_product_ids: missingExpectedProductIds.slice(0, 12),
        unexpected_stored_product_ids: unexpectedStoredProductIds.slice(0, 12),
      })
      rosterMismatchScopeCount += 1
      missingExpectedProductCount += missingExpectedProductIds.length
      unexpectedStoredProductCount += unexpectedStoredProductIds.length
      byDataset[dataset].failing_scopes += 1
      byDataset[dataset].missing_expected_products += missingExpectedProductIds.length
    }
  }

  return {
    name: 'current_collection_expected_product_roster',
    passed: issues.length === 0,
    detail: {
      melbourne_date: melbourneDate,
      collection_date: collectionDate,
      configured_scope_count: TARGET_LENDERS.length * DATASETS.length,
      failing_scope_count: issues.length,
      missing_run_scope_count: missingRunScopeCount,
      incomplete_scope_count: incompleteScopeCount,
      roster_mismatch_scope_count: rosterMismatchScopeCount,
      missing_expected_product_count: missingExpectedProductCount,
      unexpected_stored_product_count: unexpectedStoredProductCount,
      by_dataset: byDataset,
      sample: issues.slice(0, 20),
    },
  }
}

export async function runCurrentCollectionIntegrityChecks(
  db: D1Database,
  melbourneDate: string,
): Promise<IntegrityCheckResult[]> {
  return [
    await runCurrentCollectionExactProvenanceCheck(db, melbourneDate),
    await runCurrentCollectionExpectedProductRosterCheck(db, melbourneDate),
  ]
}
