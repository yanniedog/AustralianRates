import { RUN_REPORTS_RETENTION_DAYS } from './retention-prune'
import { datasetConfigForScope } from './historical-quality-common'
import type { HistoricalQualityBaselineConfidence, HistoricalQualityDatasetScope, HistoricalQualityScope } from './historical-quality-types'
import { baselineConfidence } from './historical-quality-metrics'

type NumberRow = Record<string, number | string | null>

export type HistoricalQualityReferenceWindow = {
  baselineBankCount: number | null
  baselineProductCount: number | null
  baselineSeriesCount: number | null
  confidence: HistoricalQualityBaselineConfidence
  previousDate: string | null
  nextDate: string | null
  previousSeriesCount: number | null
}

export type HistoricalQualityRunStateSnapshot = {
  rawRunStatePresent: boolean
  rawRunStateExpected: boolean
  healthyFinalized: boolean
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function listHistoricalQualityDates(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT collection_date
       FROM (
         SELECT DISTINCT collection_date FROM historical_loan_rates
         UNION
         SELECT DISTINCT collection_date FROM historical_savings_rates
         UNION
         SELECT DISTINCT collection_date FROM historical_term_deposit_rates
       )
       ORDER BY collection_date ASC`,
    )
    .all<{ collection_date: string }>()
  return (rows.results ?? []).map((row) => String(row.collection_date || '').trim()).filter(Boolean)
}

export async function listDatasetLenderCodesForDate(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT lender_code
       FROM lender_dataset_runs
       WHERE collection_date = ?1
         AND dataset_kind = ?2
       ORDER BY lender_code ASC`,
    )
    .bind(collectionDate, scope)
    .all<{ lender_code: string | null }>()
  return (rows.results ?? []).map((row) => String(row.lender_code || '').trim()).filter(Boolean)
}

export async function precheckDateScopeRowCount(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
  lenderCode?: string | null,
): Promise<number> {
  const config = datasetConfigForScope(scope)
  if (!lenderCode) {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${config.table} WHERE collection_date = ?1`)
      .bind(collectionDate)
      .first<NumberRow>()
    return toNumber(row?.n)
  }
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM ${config.table} rates
       WHERE rates.collection_date = ?1
         AND EXISTS (
           SELECT 1
           FROM lender_dataset_runs ldr
           WHERE ldr.collection_date = rates.collection_date
             AND ldr.dataset_kind = ?2
             AND ldr.bank_name = rates.bank_name
             AND ldr.lender_code = ?3
         )`,
    )
    .bind(collectionDate, scope, lenderCode)
    .first<NumberRow>()
  return toNumber(row?.n)
}

export async function loadReferenceWindow(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
): Promise<HistoricalQualityReferenceWindow> {
  const config = datasetConfigForScope(scope)
  const previousRows = await db
    .prepare(
      `SELECT collection_date, COUNT(*) AS row_count, COUNT(DISTINCT bank_name) AS bank_count,
              COUNT(DISTINCT bank_name || '|' || product_id) AS product_count,
              COUNT(DISTINCT series_key) AS series_count
       FROM ${config.table}
       WHERE collection_date < ?1
       GROUP BY collection_date
       ORDER BY collection_date DESC
       LIMIT 7`,
    )
    .bind(collectionDate)
    .all<NumberRow & { collection_date: string }>()
  const nextRows = await db
    .prepare(
      `SELECT collection_date, COUNT(*) AS row_count, COUNT(DISTINCT bank_name) AS bank_count,
              COUNT(DISTINCT bank_name || '|' || product_id) AS product_count,
              COUNT(DISTINCT series_key) AS series_count
       FROM ${config.table}
       WHERE collection_date > ?1
       GROUP BY collection_date
       ORDER BY collection_date ASC
       LIMIT 7`,
    )
    .bind(collectionDate)
    .all<NumberRow & { collection_date: string }>()
  const previous = previousRows.results ?? []
  const next = nextRows.results ?? []
  const source = previous.length >= 3 ? previous : next.length >= 3 ? next : []
  const metric = (key: 'bank_count' | 'product_count' | 'series_count') =>
    source.length === 0 ? null : source.reduce((sum, row) => sum + toNumber(row[key]), 0) / source.length
  return {
    baselineBankCount: metric('bank_count'),
    baselineProductCount: metric('product_count'),
    baselineSeriesCount: metric('series_count'),
    confidence: baselineConfidence(previous.length, next.length),
    previousDate: previous[0]?.collection_date ?? null,
    nextDate: next[0]?.collection_date ?? null,
    previousSeriesCount: previous.length > 0 ? toNumber(previous[0].series_count) : null,
  }
}

export async function loadRunStateSnapshot(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
): Promise<HistoricalQualityRunStateSnapshot> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total_rows,
              SUM(CASE WHEN finalized_at IS NOT NULL THEN 1 ELSE 0 END) AS finalized_rows,
              SUM(CASE WHEN index_fetch_succeeded = 1 THEN 1 ELSE 0 END) AS index_ok_rows
       FROM lender_dataset_runs
       WHERE collection_date = ?1
         AND dataset_kind = ?2`,
    )
    .bind(collectionDate, scope)
    .first<NumberRow>()
  const totalRows = toNumber(row?.total_rows)
  const finalizedRows = toNumber(row?.finalized_rows)
  const indexOkRows = toNumber(row?.index_ok_rows)
  const expectedCutoff = new Date(Date.now() - RUN_REPORTS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return {
    rawRunStatePresent: totalRows > 0,
    rawRunStateExpected: collectionDate >= expectedCutoff,
    healthyFinalized: totalRows > 0 && totalRows === finalizedRows && indexOkRows > 0,
  }
}

export async function hasPermanentHistoricalQualityEvidence(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityScope,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM historical_quality_daily
       WHERE collection_date = ?1
         AND scope = ?2`,
    )
    .bind(collectionDate, scope)
    .first<NumberRow>()
  return toNumber(row?.n) > 0
}
