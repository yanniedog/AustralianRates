import type { ChartCacheSection } from './chart-cache'
import type { LatestFilters } from './home-loans/shared'
import type { LatestSavingsFilters } from './savings/shared'
import type { LatestTdFilters } from './term-deposits/shared'
import { buildLatestWhere as buildHomeLoanLatestWhere } from './home-loans/latest'
import { buildLatestWhere as buildSavingsLatestWhere } from './savings/latest'
import { buildLatestWhere as buildTdLatestWhere } from './term-deposits/latest'

/** Counts only; route adds section, d, p for API and cache. */
export type SlicePairStatsCounts = {
  universe_total: number
  up_count: number
  flat_count: number
  down_count: number
  prev_missing_count: number
  curr_missing_count: number
  both_missing_count: number
  checksum_ok: boolean
}

export type SlicePairStatsPayload = SlicePairStatsCounts & {
  section: ChartCacheSection
  d: string
  p: string
}

const PROPER_INGEST_ROWS = `
  retrieval_type = 'present_scrape_same_date'
  AND (data_quality_flag IS NULL OR data_quality_flag NOT LIKE 'parsed_from_wayback%')
`

function qcHomeLoanHistorical(): string {
  return `NOT EXISTS (
    SELECT 1 FROM historical_loan_rates q
    WHERE q.series_key = h.series_key
      AND q.collection_date = h.collection_date
      AND q.quarantine_reason IS NOT NULL AND TRIM(q.quarantine_reason) != ''
  )`
}

function qcSavingsHistorical(): string {
  return `NOT EXISTS (
    SELECT 1 FROM historical_savings_rates q
    WHERE q.series_key = h.series_key
      AND q.collection_date = h.collection_date
      AND q.quarantine_reason IS NOT NULL AND TRIM(q.quarantine_reason) != ''
  )`
}

function qcTdHistorical(): string {
  return `NOT EXISTS (
    SELECT 1 FROM historical_term_deposit_rates q
    WHERE q.series_key = h.series_key
      AND q.collection_date = h.collection_date
      AND q.quarantine_reason IS NOT NULL AND TRIM(q.quarantine_reason) != ''
  )`
}

function rowNumbersOverHist(): string {
  return `
    ROW_NUMBER() OVER (
      PARTITION BY h.series_key, h.collection_date
      ORDER BY CASE WHEN COALESCE(h.run_source, 'scheduled') = 'scheduled' THEN 0 ELSE 1 END,
        h.parsed_at DESC
    ) AS rn
  `
}

export function summarizeSlicePairStatsRow(row: Record<string, unknown>): SlicePairStatsCounts {
  const universe_total = Number(row.universe_total ?? 0)
  const up_count = Number(row.up_count ?? 0)
  const flat_count = Number(row.flat_count ?? 0)
  const down_count = Number(row.down_count ?? 0)
  const prev_missing_count = Number(row.prev_missing_count ?? 0)
  const curr_missing_count = Number(row.curr_missing_count ?? 0)
  const both_missing_count = Number(row.both_missing_count ?? 0)
  const checksum_ok =
    up_count + flat_count + down_count + prev_missing_count + curr_missing_count + both_missing_count ===
    universe_total
  return {
    universe_total,
    up_count,
    flat_count,
    down_count,
    prev_missing_count,
    curr_missing_count,
    both_missing_count,
    checksum_ok,
  }
}

export async function queryHomeLoanSlicePairStats(
  db: D1Database,
  filters: LatestFilters,
  pYmd: string,
  dYmd: string,
): Promise<SlicePairStatsCounts> {
  const lw = buildHomeLoanLatestWhere(filters)
  const sql = `
    WITH uni AS (
      SELECT l.series_key
      FROM latest_home_loan_series l
      ${lw.clause}
    ),
    ranked AS (
      SELECT
        h.series_key,
        h.collection_date,
        h.interest_rate,
        h.retrieval_type,
        h.data_quality_flag,
        ${rowNumbersOverHist()}
      FROM historical_loan_rates h
      INNER JOIN uni ON uni.series_key = h.series_key
      WHERE h.collection_date IN (?, ?)
      AND (${qcHomeLoanHistorical()})
    ),
    picked AS (
      SELECT series_key, collection_date, interest_rate, retrieval_type, data_quality_flag
      FROM ranked WHERE rn = 1
    ),
    p_use AS (
      SELECT series_key, interest_rate AS ir
      FROM picked
      WHERE collection_date = ?
        AND (${PROPER_INGEST_ROWS})
    ),
    d_use AS (
      SELECT series_key, interest_rate AS ir
      FROM picked
      WHERE collection_date = ?
        AND (${PROPER_INGEST_ROWS})
    )
    SELECT
      (SELECT COUNT(*) FROM uni) AS universe_total,
      COALESCE(SUM(CASE
        WHEN p_use.ir IS NOT NULL AND d_use.ir IS NOT NULL
          AND ROUND((d_use.ir - p_use.ir) * 100.0) > 0 THEN 1 ELSE 0 END), 0) AS up_count,
      COALESCE(SUM(CASE
        WHEN p_use.ir IS NOT NULL AND d_use.ir IS NOT NULL
          AND ROUND((d_use.ir - p_use.ir) * 100.0) = 0 THEN 1 ELSE 0 END), 0) AS flat_count,
      COALESCE(SUM(CASE
        WHEN p_use.ir IS NOT NULL AND d_use.ir IS NOT NULL
          AND ROUND((d_use.ir - p_use.ir) * 100.0) < 0 THEN 1 ELSE 0 END), 0) AS down_count,
      COALESCE(SUM(CASE WHEN p_use.ir IS NULL AND d_use.ir IS NOT NULL THEN 1 ELSE 0 END), 0) AS prev_missing_count,
      COALESCE(SUM(CASE WHEN p_use.ir IS NOT NULL AND d_use.ir IS NULL THEN 1 ELSE 0 END), 0) AS curr_missing_count,
      COALESCE(SUM(CASE WHEN p_use.ir IS NULL AND d_use.ir IS NULL THEN 1 ELSE 0 END), 0) AS both_missing_count
    FROM uni
    LEFT JOIN p_use ON p_use.series_key = uni.series_key
    LEFT JOIN d_use ON d_use.series_key = uni.series_key
  `
  const binds = [...lw.binds, pYmd, dYmd, pYmd, dYmd]
  const result = await db.prepare(sql).bind(...binds).first<Record<string, unknown>>()
  return summarizeSlicePairStatsRow(result ?? {})
}

export async function querySavingsSlicePairStats(
  db: D1Database,
  filters: LatestSavingsFilters,
  pYmd: string,
  dYmd: string,
): Promise<SlicePairStatsCounts> {
  const lw = buildSavingsLatestWhere(filters)
  const sql = `
    WITH uni AS (
      SELECT l.series_key
      FROM latest_savings_series l
      ${lw.clause}
    ),
    ranked AS (
      SELECT
        h.series_key,
        h.collection_date,
        h.interest_rate,
        h.retrieval_type,
        h.data_quality_flag,
        ${rowNumbersOverHist()}
      FROM historical_savings_rates h
      INNER JOIN uni ON uni.series_key = h.series_key
      WHERE h.collection_date IN (?, ?)
      AND (${qcSavingsHistorical()})
    ),
    picked AS (
      SELECT series_key, collection_date, interest_rate, retrieval_type, data_quality_flag
      FROM ranked WHERE rn = 1
    ),
    p_use AS (
      SELECT series_key, interest_rate AS ir
      FROM picked
      WHERE collection_date = ?
        AND (${PROPER_INGEST_ROWS})
    ),
    d_use AS (
      SELECT series_key, interest_rate AS ir
      FROM picked
      WHERE collection_date = ?
        AND (${PROPER_INGEST_ROWS})
    )
    SELECT
      (SELECT COUNT(*) FROM uni) AS universe_total,
      COALESCE(SUM(CASE
        WHEN p_use.ir IS NOT NULL AND d_use.ir IS NOT NULL
          AND ROUND((d_use.ir - p_use.ir) * 100.0) > 0 THEN 1 ELSE 0 END), 0) AS up_count,
      COALESCE(SUM(CASE
        WHEN p_use.ir IS NOT NULL AND d_use.ir IS NOT NULL
          AND ROUND((d_use.ir - p_use.ir) * 100.0) = 0 THEN 1 ELSE 0 END), 0) AS flat_count,
      COALESCE(SUM(CASE
        WHEN p_use.ir IS NOT NULL AND d_use.ir IS NOT NULL
          AND ROUND((d_use.ir - p_use.ir) * 100.0) < 0 THEN 1 ELSE 0 END), 0) AS down_count,
      COALESCE(SUM(CASE WHEN p_use.ir IS NULL AND d_use.ir IS NOT NULL THEN 1 ELSE 0 END), 0) AS prev_missing_count,
      COALESCE(SUM(CASE WHEN p_use.ir IS NOT NULL AND d_use.ir IS NULL THEN 1 ELSE 0 END), 0) AS curr_missing_count,
      COALESCE(SUM(CASE WHEN p_use.ir IS NULL AND d_use.ir IS NULL THEN 1 ELSE 0 END), 0) AS both_missing_count
    FROM uni
    LEFT JOIN p_use ON p_use.series_key = uni.series_key
    LEFT JOIN d_use ON d_use.series_key = uni.series_key
  `
  const binds = [...lw.binds, pYmd, dYmd, pYmd, dYmd]
  const result = await db.prepare(sql).bind(...binds).first<Record<string, unknown>>()
  return summarizeSlicePairStatsRow(result ?? {})
}

export async function queryTdSlicePairStats(
  db: D1Database,
  filters: LatestTdFilters,
  pYmd: string,
  dYmd: string,
): Promise<SlicePairStatsCounts> {
  const lw = buildTdLatestWhere(filters)
  const sql = `
    WITH uni AS (
      SELECT l.series_key
      FROM latest_td_series l
      ${lw.clause}
    ),
    ranked AS (
      SELECT
        h.series_key,
        h.collection_date,
        h.interest_rate,
        h.retrieval_type,
        h.data_quality_flag,
        ${rowNumbersOverHist()}
      FROM historical_term_deposit_rates h
      INNER JOIN uni ON uni.series_key = h.series_key
      WHERE h.collection_date IN (?, ?)
      AND (${qcTdHistorical()})
    ),
    picked AS (
      SELECT series_key, collection_date, interest_rate, retrieval_type, data_quality_flag
      FROM ranked WHERE rn = 1
    ),
    p_use AS (
      SELECT series_key, interest_rate AS ir
      FROM picked
      WHERE collection_date = ?
        AND (${PROPER_INGEST_ROWS})
    ),
    d_use AS (
      SELECT series_key, interest_rate AS ir
      FROM picked
      WHERE collection_date = ?
        AND (${PROPER_INGEST_ROWS})
    )
    SELECT
      (SELECT COUNT(*) FROM uni) AS universe_total,
      COALESCE(SUM(CASE
        WHEN p_use.ir IS NOT NULL AND d_use.ir IS NOT NULL
          AND ROUND((d_use.ir - p_use.ir) * 100.0) > 0 THEN 1 ELSE 0 END), 0) AS up_count,
      COALESCE(SUM(CASE
        WHEN p_use.ir IS NOT NULL AND d_use.ir IS NOT NULL
          AND ROUND((d_use.ir - p_use.ir) * 100.0) = 0 THEN 1 ELSE 0 END), 0) AS flat_count,
      COALESCE(SUM(CASE
        WHEN p_use.ir IS NOT NULL AND d_use.ir IS NOT NULL
          AND ROUND((d_use.ir - p_use.ir) * 100.0) < 0 THEN 1 ELSE 0 END), 0) AS down_count,
      COALESCE(SUM(CASE WHEN p_use.ir IS NULL AND d_use.ir IS NOT NULL THEN 1 ELSE 0 END), 0) AS prev_missing_count,
      COALESCE(SUM(CASE WHEN p_use.ir IS NOT NULL AND d_use.ir IS NULL THEN 1 ELSE 0 END), 0) AS curr_missing_count,
      COALESCE(SUM(CASE WHEN p_use.ir IS NULL AND d_use.ir IS NULL THEN 1 ELSE 0 END), 0) AS both_missing_count
    FROM uni
    LEFT JOIN p_use ON p_use.series_key = uni.series_key
    LEFT JOIN d_use ON d_use.series_key = uni.series_key
  `
  const binds = [...lw.binds, pYmd, dYmd, pYmd, dYmd]
  const result = await db.prepare(sql).bind(...binds).first<Record<string, unknown>>()
  return summarizeSlicePairStatsRow(result ?? {})
}
