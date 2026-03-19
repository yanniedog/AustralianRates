import { runSourceWhereClause } from '../../utils/source-mode'
import { presentHomeLoanRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import type { LatestQueryTiming } from '../latest-query-timing'
import { addBankWhere, addRateBoundsWhere, rows, safeLimit } from '../query-common'
import {
  type LatestFilters,
  MAX_PUBLIC_RATE,
  MIN_CONFIDENCE_ALL,
  MIN_CONFIDENCE_DAILY,
  MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE,
} from './shared'

const LATEST_ORDER_BY: Record<NonNullable<LatestFilters['orderBy']>, string> = {
  default: 'l.collection_date DESC, l.bank_name ASC, l.product_name ASC, l.lvr_tier ASC, l.rate_structure ASC',
  rate_asc: 'l.interest_rate ASC, l.bank_name ASC, l.product_name ASC',
  rate_desc: 'l.interest_rate DESC, l.bank_name ASC, l.product_name ASC',
}

function buildLatestWhere(filters: LatestFilters): { clause: string; binds: Array<string | number> } {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('l.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addBankWhere(where, binds, 'l.bank_name', filters.bank, filters.banks)
  addRateBoundsWhere(where, binds, 'l.interest_rate', 'l.comparison_rate', filters)

  if (filters.securityPurpose) {
    where.push('l.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('l.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('l.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('l.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('l.feature_set = ?')
    binds.push(filters.featureSet)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(l.is_removed, 0) = 0')
  }

  where.push(runSourceWhereClause('l.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("l.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('l.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("l.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('l.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('l.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  return {
    clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    binds,
  }
}

function orderByClause(filters: LatestFilters): string {
  return LATEST_ORDER_BY[filters.orderBy ?? 'default'] ?? LATEST_ORDER_BY.default
}

export async function queryLatestRates(db: D1Database, filters: LatestFilters, timing?: LatestQueryTiming) {
  const { clause, binds } = buildLatestWhere(filters)
  const limit = safeLimit(filters.limit, 200, 1000)
  const sql = `
    SELECT
      l.series_key,
      l.product_key,
      l.bank_name,
      l.collection_date,
      l.product_id,
      l.product_code,
      l.product_name,
      l.security_purpose,
      l.repayment_type,
      l.rate_structure,
      l.lvr_tier,
      l.feature_set,
      l.has_offset_account,
      l.interest_rate,
      l.comparison_rate,
      l.annual_fee,
      l.source_url,
      l.product_url,
      l.published_at,
      l.cdr_product_detail_hash,
      l.data_quality_flag,
      l.confidence_score,
      l.retrieval_type,
      l.parsed_at,
      l.run_id,
      l.run_source,
      COALESCE(sc.first_seen_at, l.parsed_at) AS first_retrieved_at,
      (
        SELECT MAX(h.parsed_at)
        FROM historical_loan_rates h
        WHERE h.series_key = l.series_key
          AND h.interest_rate = l.interest_rate
          AND (
            (h.comparison_rate = l.comparison_rate)
            OR (h.comparison_rate IS NULL AND l.comparison_rate IS NULL)
          )
          AND (
            (h.annual_fee = l.annual_fee)
            OR (h.annual_fee IS NULL AND l.annual_fee IS NULL)
          )
          AND h.data_quality_flag LIKE 'cdr_live%'
      ) AS rate_confirmed_at,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= l.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      COALESCE(l.is_removed, 0) AS is_removed,
      l.removed_at
    FROM latest_home_loan_series l
    LEFT JOIN series_catalog sc
      ON sc.series_key = l.series_key
    ${clause}
    ORDER BY ${orderByClause(filters)}
    LIMIT ?`

  const dbStartedAt = Date.now()
  const result = await db.prepare(sql).bind(...binds, limit).all<Record<string, unknown>>()
  if (timing) timing.dbMainMs = Date.now() - dbStartedAt
  const hydrateStartedAt = Date.now()
  const hydrated = await hydrateCdrDetailJson(db, rows(result))
  if (timing) timing.detailHydrateMs = Date.now() - hydrateStartedAt
  return hydrated.map((row) => presentHomeLoanRow(row))
}

export async function queryLatestRatesCount(db: D1Database, filters: LatestFilters): Promise<number> {
  const { clause, binds } = buildLatestWhere(filters)
  const result = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM latest_home_loan_series l
       ${clause}`,
    )
    .bind(...binds)
    .first<{ n: number }>()
  return Number(result?.n ?? 0)
}

export async function queryLatestAllRates(db: D1Database, filters: LatestFilters, timing?: LatestQueryTiming) {
  return queryLatestRates(db, filters, timing)
}
