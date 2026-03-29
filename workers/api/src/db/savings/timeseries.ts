import { runSourceWhereClause } from '../../utils/source-mode'
import { presentSavingsRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import { addBalanceBandOverlapWhere, addBankWhere, rows, safeLimit } from '../query-common'
import {
  addRateBoundsWhere,
  MAX_PUBLIC_RATE,
  MIN_CONFIDENCE,
  MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE,
  type SavingsTimeseriesFilters,
} from './shared'

export async function querySavingsTimeseries(db: D1Database, input: SavingsTimeseriesFilters) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('t.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 't.interest_rate', input.minRate, input.maxRate)
  if (input.mode === 'daily') {
    where.push("t.retrieval_type != 'historical_scrape'")
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (input.mode === 'historical') {
    where.push("t.retrieval_type = 'historical_scrape'")
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }

  addBankWhere(where, binds, 't.bank_name', input.bank, input.banks)
  const productOrSeriesKey = input.seriesKey ?? input.productKey
  if (productOrSeriesKey) { where.push('t.product_key = ?'); binds.push(productOrSeriesKey) }
  if (input.accountType) { where.push('t.account_type = ?'); binds.push(input.accountType) }
  if (input.rateType) { where.push('t.rate_type = ?'); binds.push(input.rateType) }
  if (input.depositTier) { where.push('t.deposit_tier = ?'); binds.push(input.depositTier) }
  addBalanceBandOverlapWhere(where, binds, 't.min_balance', 't.max_balance', input.balanceMin, input.balanceMax)
  if (!input.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')
  where.push(runSourceWhereClause('t.run_source', input.sourceMode ?? 'all'))
  if (input.startDate) { where.push('t.collection_date >= ?'); binds.push(input.startDate) }
  if (input.endDate) { where.push('t.collection_date <= ?'); binds.push(input.endDate) }

  const limit = safeLimit(input.limit, 500, 2000)
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0))
  binds.push(limit, offset)

  const sql = `
    SELECT
      t.*,
      MIN(t.parsed_at) OVER (PARTITION BY t.product_key) AS first_retrieved_at,
      MAX(CASE WHEN t.data_quality_flag LIKE 'cdr_live%' THEN t.parsed_at END) OVER (
        PARTITION BY
          t.bank_name,
          t.product_id,
          t.account_type,
          t.rate_type,
          t.deposit_tier,
          t.interest_rate,
          t.monthly_fee,
          t.min_balance,
          t.max_balance,
          t.conditions
      ) AS rate_confirmed_at,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM vw_savings_timeseries t
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = t.bank_name
      AND pps.product_id = t.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.collection_date ASC, t.parsed_at ASC
    LIMIT ? OFFSET ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  const hydrated = await hydrateCdrDetailJson(db, rows(result))
  return hydrated.map((row) => presentSavingsRow(row))
}
