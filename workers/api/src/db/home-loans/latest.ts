import { runSourceWhereClause } from '../../utils/source-mode'
import { presentHomeLoanRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import { addBankWhere, addRateBoundsWhere, rows, safeLimit } from '../query-common'
import {
  type LatestFilters,
  MAX_PUBLIC_RATE,
  MIN_CONFIDENCE_ALL,
  MIN_CONFIDENCE_DAILY,
  MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE,
  VALID_ORDER_BY,
} from './shared'

export async function queryLatestRates(db: D1Database, filters: LatestFilters) {
  const where: string[] = []; const binds: Array<string | number> = []
  where.push('v.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addBankWhere(where, binds, 'v.bank_name', filters.bank, filters.banks)
  addRateBoundsWhere(where, binds, 'v.interest_rate', 'v.comparison_rate', filters)
  if (filters.securityPurpose) {
    where.push('v.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('v.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('v.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('v.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('v.feature_set = ?')
    binds.push(filters.featureSet)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(pps.is_removed, 0) = 0')
  }
  where.push(runSourceWhereClause('v.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("v.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("v.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  const limit = safeLimit(filters.limit, 200, 1000)
  binds.push(limit)

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const whereNoPps = where.filter((w) => !w.includes('pps.'))
  const whereClauseNoPps = whereNoPps.length ? `WHERE ${whereNoPps.join(' AND ')}` : ''

  const sql = `
    SELECT
      v.bank_name,
      v.collection_date,
      v.product_id,
      v.product_name,
      v.security_purpose,
      v.repayment_type,
      v.rate_structure,
      v.lvr_tier,
      v.feature_set,
      v.interest_rate,
      v.comparison_rate,
      v.annual_fee,
      v.source_url,
      v.product_url,
      v.published_at,
      (
        SELECT h.cdr_product_detail_hash
        FROM historical_loan_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.security_purpose = v.security_purpose
          AND h.repayment_type = v.repayment_type
          AND h.rate_structure = v.rate_structure
          AND h.lvr_tier = v.lvr_tier
          AND h.collection_date = v.collection_date
          AND h.parsed_at = v.parsed_at
          AND h.run_source = v.run_source
        LIMIT 1
      ) AS cdr_product_detail_hash,
      v.data_quality_flag,
      v.confidence_score,
      v.retrieval_type,
      v.parsed_at,
      (
        SELECT MIN(h.parsed_at)
        FROM historical_loan_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.security_purpose = v.security_purpose
          AND h.repayment_type = v.repayment_type
          AND h.lvr_tier = v.lvr_tier
          AND h.rate_structure = v.rate_structure
      ) AS first_retrieved_at,
      (
        SELECT MAX(h.parsed_at)
        FROM historical_loan_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.security_purpose = v.security_purpose
          AND h.repayment_type = v.repayment_type
          AND h.lvr_tier = v.lvr_tier
          AND h.rate_structure = v.rate_structure
          AND h.interest_rate = v.interest_rate
          AND (
            (h.comparison_rate = v.comparison_rate)
            OR (h.comparison_rate IS NULL AND v.comparison_rate IS NULL)
          )
          AND (
            (h.annual_fee = v.annual_fee)
            OR (h.annual_fee IS NULL AND v.annual_fee IS NULL)
          )
          AND h.data_quality_flag LIKE 'cdr_live%'
      ) AS rate_confirmed_at,
      v.run_source,
      v.product_key,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= v.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM vw_latest_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${whereClause}
    ORDER BY ${VALID_ORDER_BY[filters.orderBy ?? 'default'] ?? VALID_ORDER_BY.default}
    LIMIT ?
  `

  const sqlNoPps = `
    SELECT
      v.bank_name,
      v.collection_date,
      v.product_id,
      v.product_name,
      v.security_purpose,
      v.repayment_type,
      v.rate_structure,
      v.lvr_tier,
      v.feature_set,
      v.interest_rate,
      v.comparison_rate,
      v.annual_fee,
      v.source_url,
      v.product_url,
      v.published_at,
      (
        SELECT h.cdr_product_detail_hash
        FROM historical_loan_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.security_purpose = v.security_purpose
          AND h.repayment_type = v.repayment_type
          AND h.rate_structure = v.rate_structure
          AND h.lvr_tier = v.lvr_tier
          AND h.collection_date = v.collection_date
          AND h.parsed_at = v.parsed_at
          AND h.run_source = v.run_source
        LIMIT 1
      ) AS cdr_product_detail_hash,
      v.data_quality_flag,
      v.confidence_score,
      v.retrieval_type,
      v.parsed_at,
      (
        SELECT MIN(h.parsed_at)
        FROM historical_loan_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.security_purpose = v.security_purpose
          AND h.repayment_type = v.repayment_type
          AND h.lvr_tier = v.lvr_tier
          AND h.rate_structure = v.rate_structure
      ) AS first_retrieved_at,
      (
        SELECT MAX(h.parsed_at)
        FROM historical_loan_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.security_purpose = v.security_purpose
          AND h.repayment_type = v.repayment_type
          AND h.lvr_tier = v.lvr_tier
          AND h.rate_structure = v.rate_structure
          AND h.interest_rate = v.interest_rate
          AND (
            (h.comparison_rate = v.comparison_rate)
            OR (h.comparison_rate IS NULL AND v.comparison_rate IS NULL)
          )
          AND (
            (h.annual_fee = v.annual_fee)
            OR (h.annual_fee IS NULL AND v.annual_fee IS NULL)
          )
          AND h.data_quality_flag LIKE 'cdr_live%'
      ) AS rate_confirmed_at,
      v.run_source,
      v.product_key,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= v.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      0 AS is_removed,
      NULL AS removed_at
    FROM vw_latest_rates v
    ${whereClauseNoPps}
    ORDER BY ${VALID_ORDER_BY[filters.orderBy ?? 'default'] ?? VALID_ORDER_BY.default}
    LIMIT ?
  `

  try {
    const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
    const hydrated = await hydrateCdrDetailJson(db, rows(result))
    return hydrated.map((row) => presentHomeLoanRow(row))
  } catch {
    const result = await db.prepare(sqlNoPps).bind(...binds).all<Record<string, unknown>>()
    const hydrated = await hydrateCdrDetailJson(db, rows(result))
    return hydrated.map((row) => presentHomeLoanRow(row))
  }
}

/** Count of current products matching the same filters as queryLatestRates (for "Tracked products" total). */
export async function queryLatestRatesCount(db: D1Database, filters: LatestFilters): Promise<number> {
  const where: string[] = []; const binds: Array<string | number> = []
  where.push('v.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addBankWhere(where, binds, 'v.bank_name', filters.bank, filters.banks)
  addRateBoundsWhere(where, binds, 'v.interest_rate', 'v.comparison_rate', filters)
  if (filters.securityPurpose) {
    where.push('v.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('v.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('v.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('v.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('v.feature_set = ?')
    binds.push(filters.featureSet)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(pps.is_removed, 0) = 0')
  }
  where.push(runSourceWhereClause('v.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("v.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("v.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const whereNoPps = where.filter((w) => !w.includes('pps.'))
  const whereClauseNoPps = whereNoPps.length ? `WHERE ${whereNoPps.join(' AND ')}` : ''

  const countSql = `
    SELECT COUNT(*) AS n
    FROM vw_latest_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${whereClause}
  `
  const countSqlNoPps = `SELECT COUNT(*) AS n FROM vw_latest_rates v ${whereClauseNoPps}`

  try {
    const countResult = await db.prepare(countSql).bind(...binds).first<{ n: number }>()
    return Number(countResult?.n ?? 0)
  } catch {
    const countResult = await db.prepare(countSqlNoPps).bind(...binds).first<{ n: number }>()
    return Number(countResult?.n ?? 0)
  }
}

export async function queryLatestAllRates(db: D1Database, filters: LatestFilters) {
  const where: string[] = []; const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)

  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  addRateBoundsWhere(where, binds, 'h.interest_rate', 'h.comparison_rate', filters)
  if (filters.securityPurpose) {
    where.push('h.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('h.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('h.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('h.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('h.feature_set = ?')
    binds.push(filters.featureSet)
  }
  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("h.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("h.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  const limit = safeLimit(filters.limit, 200, 1000)
  binds.push(limit)

  const orderBy = filters.orderBy ?? 'default'
  const orderClause =
    orderBy === 'rate_asc'
      ? 'ranked.interest_rate ASC, ranked.bank_name ASC, ranked.product_name ASC'
      : orderBy === 'rate_desc'
        ? 'ranked.interest_rate DESC, ranked.bank_name ASC, ranked.product_name ASC'
        : 'ranked.collection_date DESC, ranked.bank_name ASC, ranked.product_name ASC, ranked.lvr_tier ASC, ranked.rate_structure ASC'

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const sql = `
    WITH ranked AS (
      SELECT
        h.bank_name,
        h.collection_date,
        h.product_id,
        h.product_name,
        h.security_purpose,
        h.repayment_type,
        h.rate_structure,
        h.lvr_tier,
        h.feature_set,
        h.interest_rate,
        h.comparison_rate,
        h.annual_fee,
        h.source_url,
        h.product_url,
        h.published_at,
        h.cdr_product_detail_hash,
        h.data_quality_flag,
        h.confidence_score,
        h.retrieval_type,
        h.parsed_at,
        MIN(h.parsed_at) OVER (
          PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
        ) AS first_retrieved_at,
        MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
          PARTITION BY
            h.bank_name,
            h.product_id,
            h.security_purpose,
            h.repayment_type,
            h.lvr_tier,
            h.rate_structure,
            h.interest_rate,
            h.comparison_rate,
            h.annual_fee
        ) AS rate_confirmed_at,
        h.run_source,
        h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
        ROW_NUMBER() OVER (
          PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
          ORDER BY h.collection_date DESC, h.parsed_at DESC
        ) AS row_num
      FROM historical_loan_rates h
      ${whereClause}
    )
    SELECT
      ranked.bank_name,
      ranked.collection_date,
      ranked.product_id,
      ranked.product_name,
      ranked.security_purpose,
      ranked.repayment_type,
      ranked.rate_structure,
      ranked.lvr_tier,
      ranked.feature_set,
      ranked.interest_rate,
      ranked.comparison_rate,
      ranked.annual_fee,
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
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= ranked.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM ranked
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = ranked.bank_name
      AND pps.product_id = ranked.product_id
    WHERE ranked.row_num = 1
      ${filters.includeRemoved ? '' : 'AND COALESCE(pps.is_removed, 0) = 0'}
    ORDER BY ${orderClause}
    LIMIT ?
  `

  const sqlNoPps = `
    WITH ranked AS (
      SELECT
        h.bank_name,
        h.collection_date,
        h.product_id,
        h.product_name,
        h.security_purpose,
        h.repayment_type,
        h.rate_structure,
        h.lvr_tier,
        h.feature_set,
        h.interest_rate,
        h.comparison_rate,
        h.annual_fee,
        h.source_url,
        h.product_url,
        h.published_at,
        h.cdr_product_detail_hash,
        h.data_quality_flag,
        h.confidence_score,
        h.retrieval_type,
        h.parsed_at,
        MIN(h.parsed_at) OVER (
          PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
        ) AS first_retrieved_at,
        MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
          PARTITION BY
            h.bank_name,
            h.product_id,
            h.security_purpose,
            h.repayment_type,
            h.lvr_tier,
            h.rate_structure,
            h.interest_rate,
            h.comparison_rate,
            h.annual_fee
        ) AS rate_confirmed_at,
        h.run_source,
        h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
        ROW_NUMBER() OVER (
          PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
          ORDER BY h.collection_date DESC, h.parsed_at DESC
        ) AS row_num
      FROM historical_loan_rates h
      ${whereClause}
    )
    SELECT
      ranked.bank_name,
      ranked.collection_date,
      ranked.product_id,
      ranked.product_name,
      ranked.security_purpose,
      ranked.repayment_type,
      ranked.rate_structure,
      ranked.lvr_tier,
      ranked.feature_set,
      ranked.interest_rate,
      ranked.comparison_rate,
      ranked.annual_fee,
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
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= ranked.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      0 AS is_removed,
      NULL AS removed_at
    FROM ranked
    WHERE ranked.row_num = 1
    ORDER BY ${orderClause}
    LIMIT ?
  `

  try {
    const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
    const hydrated = await hydrateCdrDetailJson(db, rows(result))
    return hydrated.map((row) => presentHomeLoanRow(row))
  } catch {
    const result = await db.prepare(sqlNoPps).bind(...binds).all<Record<string, unknown>>()
    const hydrated = await hydrateCdrDetailJson(db, rows(result))
    return hydrated.map((row) => presentHomeLoanRow(row))
  }
}
