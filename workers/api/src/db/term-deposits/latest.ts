import { runSourceWhereClause } from '../../utils/source-mode'
import { presentTdRow } from '../../utils/row-presentation'
import { addBankWhere, rows, safeLimit } from '../query-common'
import {
  addRateBoundsWhere,
  type LatestTdFilters,
  MAX_PUBLIC_RATE,
  MIN_CONFIDENCE,
  MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE,
} from './shared'

export async function queryLatestTdRates(db: D1Database, filters: LatestTdFilters) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('v.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'v.interest_rate', filters.minRate, filters.maxRate)
  if (filters.mode === 'daily') {
    where.push("v.retrieval_type != 'historical_scrape'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (filters.mode === 'historical') {
    where.push("v.retrieval_type = 'historical_scrape'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }

  addBankWhere(where, binds, 'v.bank_name', filters.bank, filters.banks)
  if (filters.termMonths) { where.push('CAST(v.term_months AS TEXT) = ?'); binds.push(filters.termMonths) }
  if (filters.depositTier) { where.push('v.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.interestPayment) { where.push('v.interest_payment = ?'); binds.push(filters.interestPayment) }
  if (!filters.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')
  where.push(runSourceWhereClause('v.run_source', filters.sourceMode ?? 'all'))

  const orderMap: Record<string, string> = {
    default: 'v.collection_date DESC, v.bank_name ASC, v.product_name ASC',
    rate_asc: 'v.interest_rate ASC, v.bank_name ASC',
    rate_desc: 'v.interest_rate DESC, v.bank_name ASC',
  }
  const limit = safeLimit(filters.limit, 200, 1000)
  binds.push(limit)

  const sql = `
    SELECT
      v.*,
      (
        SELECT MIN(h.parsed_at)
        FROM historical_term_deposit_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.term_months = v.term_months
          AND h.deposit_tier = v.deposit_tier
      ) AS first_retrieved_at,
      (
        SELECT MAX(h.parsed_at)
        FROM historical_term_deposit_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.term_months = v.term_months
          AND h.deposit_tier = v.deposit_tier
          AND h.interest_payment = v.interest_payment
          AND h.interest_rate = v.interest_rate
          AND (
            (h.min_deposit = v.min_deposit)
            OR (h.min_deposit IS NULL AND v.min_deposit IS NULL)
          )
          AND (
            (h.max_deposit = v.max_deposit)
            OR (h.max_deposit IS NULL AND v.max_deposit IS NULL)
          )
          AND h.data_quality_flag LIKE 'cdr_live%'
      ) AS rate_confirmed_at,
      v.product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM vw_latest_td_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${orderMap[filters.orderBy ?? 'default'] ?? orderMap.default}
    LIMIT ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result).map((row) => presentTdRow(row))
}

/** Count of current products matching the same filters as queryLatestTdRates. */
export async function queryLatestTdRatesCount(db: D1Database, filters: LatestTdFilters): Promise<number> {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('v.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'v.interest_rate', filters.minRate, filters.maxRate)
  if (filters.mode === 'daily') {
    where.push("v.retrieval_type != 'historical_scrape'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (filters.mode === 'historical') {
    where.push("v.retrieval_type = 'historical_scrape'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }
  addBankWhere(where, binds, 'v.bank_name', filters.bank, filters.banks)
  if (filters.termMonths) { where.push('CAST(v.term_months AS TEXT) = ?'); binds.push(filters.termMonths) }
  if (filters.depositTier) { where.push('v.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.interestPayment) { where.push('v.interest_payment = ?'); binds.push(filters.interestPayment) }
  if (!filters.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')
  where.push(runSourceWhereClause('v.run_source', filters.sourceMode ?? 'all'))

  const countSql = `
    SELECT COUNT(*) AS n
    FROM vw_latest_td_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `
  const countResult = await db.prepare(countSql).bind(...binds).first<{ n: number }>()
  const n = countResult?.n ?? 0
  return Number(n)
}

export async function queryLatestAllTdRates(db: D1Database, filters: LatestTdFilters) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', filters.minRate, filters.maxRate)
  if (filters.mode === 'daily') {
    where.push("h.retrieval_type != 'historical_scrape'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (filters.mode === 'historical') {
    where.push("h.retrieval_type = 'historical_scrape'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }

  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  if (filters.termMonths) { where.push('CAST(h.term_months AS TEXT) = ?'); binds.push(filters.termMonths) }
  if (filters.depositTier) { where.push('h.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.interestPayment) { where.push('h.interest_payment = ?'); binds.push(filters.interestPayment) }
  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))

  const orderBy = filters.orderBy ?? 'default'
  const orderClause =
    orderBy === 'rate_asc'
      ? 'ranked.interest_rate ASC, ranked.bank_name ASC'
      : orderBy === 'rate_desc'
        ? 'ranked.interest_rate DESC, ranked.bank_name ASC'
        : 'ranked.collection_date DESC, ranked.bank_name ASC, ranked.product_name ASC'

  const limit = safeLimit(filters.limit, 200, 1000)
  binds.push(limit)

  const sql = `
    WITH ranked AS (
      SELECT
        h.bank_name,
        h.collection_date,
        h.product_id,
        h.product_name,
        h.term_months,
        h.interest_rate,
        h.deposit_tier,
        h.min_deposit,
        h.max_deposit,
        h.interest_payment,
        h.source_url,
        h.product_url,
        h.published_at,
        h.data_quality_flag,
        h.confidence_score,
        h.retrieval_type,
        h.parsed_at,
        MIN(h.parsed_at) OVER (
          PARTITION BY h.bank_name, h.product_id, h.term_months, h.deposit_tier
        ) AS first_retrieved_at,
        MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
          PARTITION BY
            h.bank_name,
            h.product_id,
            h.term_months,
            h.deposit_tier,
            h.interest_payment,
            h.interest_rate,
            h.min_deposit,
            h.max_deposit
        ) AS rate_confirmed_at,
        h.run_source,
        h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier AS product_key,
        ROW_NUMBER() OVER (
          PARTITION BY h.bank_name, h.product_id, h.term_months, h.deposit_tier
          ORDER BY h.collection_date DESC, h.parsed_at DESC
        ) AS row_num
      FROM historical_term_deposit_rates h
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    )
    SELECT
      ranked.bank_name,
      ranked.collection_date,
      ranked.product_id,
      ranked.product_name,
      ranked.term_months,
      ranked.interest_rate,
      ranked.deposit_tier,
      ranked.min_deposit,
      ranked.max_deposit,
      ranked.interest_payment,
      ranked.source_url,
      ranked.product_url,
      ranked.published_at,
      ranked.data_quality_flag,
      ranked.confidence_score,
      ranked.retrieval_type,
      ranked.parsed_at,
      ranked.first_retrieved_at,
      ranked.rate_confirmed_at,
      ranked.run_source,
      ranked.product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM ranked
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = ranked.bank_name
      AND pps.product_id = ranked.product_id
    WHERE ranked.row_num = 1
      ${filters.includeRemoved ? '' : 'AND COALESCE(pps.is_removed, 0) = 0'}
    ORDER BY ${orderClause}
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result).map((row) => presentTdRow(row))
}
