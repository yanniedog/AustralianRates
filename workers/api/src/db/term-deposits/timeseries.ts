import { runSourceWhereClause } from '../../utils/source-mode'
import { presentTdRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import { applyTdCompareEdgeExclusions } from '../compare-edge-exclusions'
import {
  addBalanceBandOverlapWhere,
  addBankWhere,
  addDatasetModeWhere,
  rows,
  safeLimit,
} from '../query-common'
import { tdProductKeySql, tdSeriesKeySql } from './identity'
import {
  addRateBoundsWhere,
  MAX_PUBLIC_RATE,
  MIN_CONFIDENCE,
  MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE,
  type TdTimeseriesFilters,
} from './shared'

export async function queryTdTimeseries(db: D1Database, input: TdTimeseriesFilters) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', input.minRate, input.maxRate)
  addDatasetModeWhere(
    where,
    binds,
    'h.retrieval_type',
    'h.confidence_score',
    input.mode,
    MIN_CONFIDENCE,
    MIN_CONFIDENCE_HISTORICAL,
  )

  addBankWhere(where, binds, 'h.bank_name', input.bank, input.banks)
  if (input.seriesKey) {
    where.push('h.series_key = ?')
    binds.push(input.seriesKey)
  } else if (input.productKey) {
    where.push(`(${tdProductKeySql('h')}) = ?`)
    binds.push(input.productKey)
  }
  if (input.termMonths) { where.push('CAST(h.term_months AS TEXT) = ?'); binds.push(input.termMonths) }
  if (input.depositTier) { where.push('h.deposit_tier = ?'); binds.push(input.depositTier) }
  addBalanceBandOverlapWhere(where, binds, 'h.min_deposit', 'h.max_deposit', input.balanceMin, input.balanceMax)
  if (input.interestPayment) { where.push('h.interest_payment = ?'); binds.push(input.interestPayment) }
  applyTdCompareEdgeExclusions(where, 'h.product_name', 'h.min_deposit', input.excludeCompareEdgeCases)
  if (!input.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')
  where.push(runSourceWhereClause('h.run_source', input.sourceMode ?? 'all'))
  if (input.startDate) { where.push('h.collection_date >= ?'); binds.push(input.startDate) }
  if (input.endDate) { where.push('h.collection_date <= ?'); binds.push(input.endDate) }

  const limit = safeLimit(input.limit, 500, 5000)
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0))
  binds.push(limit, offset)
  const sortOrder = input.rowSort === 'desc' ? 'DESC' : 'ASC'

  const sql = `
    SELECT
      h.collection_date,
      h.bank_name,
      h.product_id,
      h.product_code,
      h.product_name,
      h.series_key,
      ${tdProductKeySql('h')} AS product_key,
      h.term_months,
      h.interest_rate,
      h.deposit_tier,
      h.min_deposit,
      h.max_deposit,
      h.interest_payment,
      h.source_url,
      h.product_url,
      h.published_at,
      h.cdr_product_detail_hash,
      h.data_quality_flag,
      h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      h.run_id,
      h.run_source,
      MIN(h.parsed_at) OVER (PARTITION BY ${tdSeriesKeySql('h')}) AS first_retrieved_at,
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
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_term_deposit_rates h
    LEFT JOIN series_presence_status pps
      ON pps.dataset_kind = 'term_deposits'
      AND pps.series_key = h.series_key
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY h.collection_date ${sortOrder}, h.parsed_at ${sortOrder}
    LIMIT ? OFFSET ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  const hydrated = await hydrateCdrDetailJson(db, rows(result))
  return hydrated.map((row) => presentTdRow(row))
}
