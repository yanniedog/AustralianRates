import { runSourceWhereClause } from '../../utils/source-mode'
import { presentSavingsRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import type { LatestQueryTiming } from '../latest-query-timing'
import { addBankWhere, rows, safeLimit } from '../query-common'
import {
  addRateBoundsWhere,
  type LatestSavingsFilters,
  MAX_PUBLIC_RATE,
  MIN_CONFIDENCE,
  MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE,
} from './shared'

const LATEST_ORDER_BY: Record<NonNullable<LatestSavingsFilters['orderBy']>, string> = {
  default: 'l.collection_date DESC, l.bank_name ASC, l.product_name ASC',
  rate_asc: 'l.interest_rate ASC, l.bank_name ASC',
  rate_desc: 'l.interest_rate DESC, l.bank_name ASC',
}

function buildLatestWhere(filters: LatestSavingsFilters): { clause: string; binds: Array<string | number> } {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('l.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'l.interest_rate', filters.minRate, filters.maxRate)

  if (filters.mode === 'daily') {
    where.push("l.retrieval_type != 'historical_scrape'")
    where.push('l.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (filters.mode === 'historical') {
    where.push("l.retrieval_type = 'historical_scrape'")
    where.push('l.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('l.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }

  addBankWhere(where, binds, 'l.bank_name', filters.bank, filters.banks)
  if (filters.accountType) {
    where.push('l.account_type = ?')
    binds.push(filters.accountType)
  }
  if (filters.rateType) {
    where.push('l.rate_type = ?')
    binds.push(filters.rateType)
  }
  if (filters.depositTier) {
    where.push('l.deposit_tier = ?')
    binds.push(filters.depositTier)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(l.is_removed, 0) = 0')
  }

  where.push(runSourceWhereClause('l.run_source', filters.sourceMode ?? 'all'))

  return {
    clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    binds,
  }
}

function orderByClause(filters: LatestSavingsFilters): string {
  return LATEST_ORDER_BY[filters.orderBy ?? 'default'] ?? LATEST_ORDER_BY.default
}

export async function queryLatestSavingsRates(db: D1Database, filters: LatestSavingsFilters, timing?: LatestQueryTiming) {
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
      l.account_type,
      l.rate_type,
      l.interest_rate,
      l.deposit_tier,
      l.min_balance,
      l.max_balance,
      l.conditions,
      l.monthly_fee,
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
        FROM historical_savings_rates h
        WHERE h.series_key = l.series_key
          AND h.interest_rate = l.interest_rate
          AND (
            (h.monthly_fee = l.monthly_fee)
            OR (h.monthly_fee IS NULL AND l.monthly_fee IS NULL)
          )
          AND (
            (h.min_balance = l.min_balance)
            OR (h.min_balance IS NULL AND l.min_balance IS NULL)
          )
          AND (
            (h.max_balance = l.max_balance)
            OR (h.max_balance IS NULL AND l.max_balance IS NULL)
          )
          AND (
            (h.conditions = l.conditions)
            OR (h.conditions IS NULL AND l.conditions IS NULL)
          )
          AND h.data_quality_flag LIKE 'cdr_live%'
      ) AS rate_confirmed_at,
      COALESCE(l.is_removed, 0) AS is_removed,
      l.removed_at
    FROM latest_savings_series l
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
  return hydrated.map((row) => presentSavingsRow(row))
}

export async function queryLatestSavingsRatesCount(db: D1Database, filters: LatestSavingsFilters): Promise<number> {
  const { clause, binds } = buildLatestWhere(filters)
  const result = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM latest_savings_series l
       ${clause}`,
    )
    .bind(...binds)
    .first<{ n: number }>()
  return Number(result?.n ?? 0)
}

export async function queryLatestAllSavingsRates(db: D1Database, filters: LatestSavingsFilters, timing?: LatestQueryTiming) {
  return queryLatestSavingsRates(db, filters, timing)
}
