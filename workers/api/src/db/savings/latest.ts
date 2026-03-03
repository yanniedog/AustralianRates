import { runSourceWhereClause } from '../../utils/source-mode'
import { presentSavingsRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import { addBankWhere, rows, safeLimit } from '../query-common'
import {
  addRateBoundsWhere,
  type LatestSavingsFilters,
  MAX_PUBLIC_RATE,
  MIN_CONFIDENCE,
  MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE,
} from './shared'

export async function queryLatestSavingsRates(db: D1Database, filters: LatestSavingsFilters) {
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
  if (filters.accountType) { where.push('v.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('v.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('v.deposit_tier = ?'); binds.push(filters.depositTier) }
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
        FROM historical_savings_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.account_type = v.account_type
          AND h.rate_type = v.rate_type
          AND h.deposit_tier = v.deposit_tier
      ) AS first_retrieved_at,
      (
        SELECT MAX(h.parsed_at)
        FROM historical_savings_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.account_type = v.account_type
          AND h.rate_type = v.rate_type
          AND h.deposit_tier = v.deposit_tier
          AND h.interest_rate = v.interest_rate
          AND (
            (h.monthly_fee = v.monthly_fee)
            OR (h.monthly_fee IS NULL AND v.monthly_fee IS NULL)
          )
          AND (
            (h.min_balance = v.min_balance)
            OR (h.min_balance IS NULL AND v.min_balance IS NULL)
          )
          AND (
            (h.max_balance = v.max_balance)
            OR (h.max_balance IS NULL AND v.max_balance IS NULL)
          )
          AND (
            (h.conditions = v.conditions)
            OR (h.conditions IS NULL AND v.conditions IS NULL)
          )
          AND h.data_quality_flag LIKE 'cdr_live%'
      ) AS rate_confirmed_at,
      v.product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM vw_latest_savings_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${orderMap[filters.orderBy ?? 'default'] ?? orderMap.default}
    LIMIT ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  const hydrated = await hydrateCdrDetailJson(db, rows(result))
  return hydrated.map((row) => presentSavingsRow(row))
}

/** Count of current products matching the same filters as queryLatestSavingsRates. */
export async function queryLatestSavingsRatesCount(db: D1Database, filters: LatestSavingsFilters): Promise<number> {
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
  if (filters.accountType) { where.push('v.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('v.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('v.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (!filters.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')
  where.push(runSourceWhereClause('v.run_source', filters.sourceMode ?? 'all'))

  const countSql = `
    SELECT COUNT(*) AS n
    FROM vw_latest_savings_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `
  const countResult = await db.prepare(countSql).bind(...binds).first<{ n: number }>()
  const n = countResult?.n ?? 0
  return Number(n)
}

export async function queryLatestAllSavingsRates(db: D1Database, filters: LatestSavingsFilters) {
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
  if (filters.accountType) { where.push('h.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('h.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('h.deposit_tier = ?'); binds.push(filters.depositTier) }
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
        h.account_type,
        h.rate_type,
        h.interest_rate,
        h.deposit_tier,
        h.min_balance,
        h.max_balance,
        h.conditions,
        h.monthly_fee,
        h.source_url,
        h.product_url,
        h.published_at,
        h.cdr_product_detail_hash,
        h.data_quality_flag,
        h.confidence_score,
        h.retrieval_type,
        h.parsed_at,
        MIN(h.parsed_at) OVER (
          PARTITION BY h.bank_name, h.product_id, h.account_type, h.rate_type, h.deposit_tier
        ) AS first_retrieved_at,
        MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
          PARTITION BY
            h.bank_name,
            h.product_id,
            h.account_type,
            h.rate_type,
            h.deposit_tier,
            h.interest_rate,
            h.monthly_fee,
            h.min_balance,
            h.max_balance,
            h.conditions
        ) AS rate_confirmed_at,
        h.run_source,
        h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key,
        ROW_NUMBER() OVER (
          PARTITION BY h.bank_name, h.product_id, h.account_type, h.rate_type, h.deposit_tier
          ORDER BY h.collection_date DESC, h.parsed_at DESC
        ) AS row_num
      FROM historical_savings_rates h
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    )
    SELECT
      ranked.bank_name,
      ranked.collection_date,
      ranked.product_id,
      ranked.product_name,
      ranked.account_type,
      ranked.rate_type,
      ranked.interest_rate,
      ranked.deposit_tier,
      ranked.min_balance,
      ranked.max_balance,
      ranked.conditions,
      ranked.monthly_fee,
      ranked.source_url,
      ranked.product_url,
      ranked.published_at,
      ranked.cdr_product_detail_hash,
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
      ON pps.section = 'savings'
      AND pps.bank_name = ranked.bank_name
      AND pps.product_id = ranked.product_id
    WHERE ranked.row_num = 1
      ${filters.includeRemoved ? '' : 'AND COALESCE(pps.is_removed, 0) = 0'}
    ORDER BY ${orderClause}
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  const hydrated = await hydrateCdrDetailJson(db, rows(result))
  return hydrated.map((row) => presentSavingsRow(row))
}
