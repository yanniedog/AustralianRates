import { applyTdCompareEdgeExclusions } from '../compare-edge-exclusions'
import { runSourceWhereClause } from '../../utils/source-mode'
import { presentTdRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import { withD1TransientRetry } from '../d1-retry'
import type { LatestQueryTiming } from '../latest-query-timing'
import { DEPOSIT_LATEST_ORDER_BY } from '../deposits-common'
import {
  addBalanceBandOverlapWhere,
  addBankWhere,
  addDatasetModeWhere,
  rows,
  safeLimit,
} from '../query-common'
import {
  addRateBoundsWhere,
  type LatestTdFilters,
  MAX_PUBLIC_RATE,
  MIN_CONFIDENCE,
  MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE,
} from './shared'

/** Exported for slice-pair stats (universe must match `queryLatestTdRatesCount`). */
export function buildLatestWhere(filters: LatestTdFilters): { clause: string; binds: Array<string | number> } {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('l.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'l.interest_rate', filters.minRate, filters.maxRate)
  addDatasetModeWhere(
    where,
    binds,
    'l.retrieval_type',
    'l.confidence_score',
    filters.mode,
    MIN_CONFIDENCE,
    MIN_CONFIDENCE_HISTORICAL,
  )

  addBankWhere(where, binds, 'l.bank_name', filters.bank, filters.banks)
  if (filters.termMonths) {
    where.push('CAST(l.term_months AS TEXT) = ?')
    binds.push(filters.termMonths)
  }
  if (filters.depositTier) {
    where.push('l.deposit_tier = ?')
    binds.push(filters.depositTier)
  }
  addBalanceBandOverlapWhere(where, binds, 'l.min_deposit', 'l.max_deposit', filters.balanceMin, filters.balanceMax)
  if (filters.interestPayment) {
    where.push('l.interest_payment = ?')
    binds.push(filters.interestPayment)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(l.is_removed, 0) = 0')
  }
  where.push(`NOT EXISTS (
    SELECT 1
    FROM historical_term_deposit_rates q
    WHERE q.series_key = l.series_key
      AND q.collection_date = l.collection_date
      AND q.quarantine_reason IS NOT NULL
      AND TRIM(q.quarantine_reason) != ''
  )`)

  where.push(runSourceWhereClause('l.run_source', filters.sourceMode ?? 'all'))

  applyTdCompareEdgeExclusions(where, 'l.product_name', 'l.min_deposit', filters.excludeCompareEdgeCases)

  return {
    clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    binds,
  }
}

function orderByClause(filters: LatestTdFilters): string {
  return DEPOSIT_LATEST_ORDER_BY[filters.orderBy ?? 'default'] ?? DEPOSIT_LATEST_ORDER_BY.default
}

export async function queryLatestTdRates(db: D1Database, filters: LatestTdFilters, timing?: LatestQueryTiming) {
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
      l.term_months,
      l.interest_rate,
      l.deposit_tier,
      l.min_deposit,
      l.max_deposit,
      l.interest_payment,
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
        FROM historical_term_deposit_rates h
        WHERE h.series_key = l.series_key
          AND h.interest_payment = l.interest_payment
          AND h.interest_rate = l.interest_rate
          AND (
            (h.min_deposit = l.min_deposit)
            OR (h.min_deposit IS NULL AND l.min_deposit IS NULL)
          )
          AND (
            (h.max_deposit = l.max_deposit)
            OR (h.max_deposit IS NULL AND l.max_deposit IS NULL)
          )
          AND h.data_quality_flag LIKE 'cdr_live%'
      ) AS rate_confirmed_at,
      COALESCE(l.is_removed, 0) AS is_removed,
      l.removed_at
    FROM latest_td_series l
    LEFT JOIN series_catalog sc
      ON sc.series_key = l.series_key
    ${clause}
    ORDER BY ${orderByClause(filters)}
    LIMIT ?`

  const dbStartedAt = Date.now()
  const result = await withD1TransientRetry(() => db.prepare(sql).bind(...binds, limit).all<Record<string, unknown>>())
  if (timing) timing.dbMainMs = Date.now() - dbStartedAt
  const hydrateStartedAt = Date.now()
  const hydrated = await hydrateCdrDetailJson(db, rows(result))
  if (timing) timing.detailHydrateMs = Date.now() - hydrateStartedAt
  return hydrated.map((row) => presentTdRow(row))
}

export async function queryLatestTdRatesCount(db: D1Database, filters: LatestTdFilters): Promise<number> {
  const { clause, binds } = buildLatestWhere(filters)
  const result = await withD1TransientRetry(() =>
    db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM latest_td_series l
         ${clause}`,
      )
      .bind(...binds)
      .first<{ n: number }>(),
  )
  return Number(result?.n ?? 0)
}

export async function queryLatestTdMaxCollectionDate(db: D1Database, filters: LatestTdFilters): Promise<string | null> {
  const { clause, binds } = buildLatestWhere(filters)
  const row = await withD1TransientRetry(() =>
    db
      .prepare(`SELECT MAX(l.collection_date) AS max_date FROM latest_td_series l ${clause}`)
      .bind(...binds)
      .first<{ max_date: string | null }>(),
  )
  return row?.max_date && /^\d{4}-\d{2}-\d{2}$/.test(row.max_date) ? row.max_date : null
}

export async function queryLatestAllTdRates(db: D1Database, filters: LatestTdFilters, timing?: LatestQueryTiming) {
  return queryLatestTdRates(db, filters, timing)
}
