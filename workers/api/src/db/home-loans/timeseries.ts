import { runSourceWhereClause } from '../../utils/source-mode'
import { presentHomeLoanRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import { addBankWhere, addRateBoundsWhere, rows, safeLimit } from '../query-common'
import {
  MAX_PUBLIC_RATE,
  MIN_CONFIDENCE_ALL,
  MIN_CONFIDENCE_DAILY,
  MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE,
  type TimeseriesFilters,
} from './shared'

export async function queryTimeseries(db: D1Database, input: TimeseriesFilters) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('t.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)

  addBankWhere(where, binds, 't.bank_name', input.bank, input.banks)
  addRateBoundsWhere(where, binds, 't.interest_rate', 't.comparison_rate', input)
  const productOrSeriesKey = input.seriesKey ?? input.productKey
  if (productOrSeriesKey) {
    where.push('t.product_key = ?')
    binds.push(productOrSeriesKey)
  }
  if (input.securityPurpose) {
    where.push('t.security_purpose = ?')
    binds.push(input.securityPurpose)
  }
  if (input.repaymentType) {
    where.push('t.repayment_type = ?')
    binds.push(input.repaymentType)
  }
  if (input.featureSet) {
    where.push('t.feature_set = ?')
    binds.push(input.featureSet)
  }
  if (!input.includeRemoved) {
    where.push('COALESCE(pps.is_removed, 0) = 0')
  }
  where.push(runSourceWhereClause('t.run_source', input.sourceMode ?? 'all'))
  if (input.startDate) {
    where.push('t.collection_date >= ?')
    binds.push(input.startDate)
  }
  if (input.endDate) {
    where.push('t.collection_date <= ?')
    binds.push(input.endDate)
  }
  if (input.mode === 'daily') {
    where.push("t.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (input.mode === 'historical') {
    where.push("t.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  const limit = safeLimit(input.limit, 500, 2000)
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0))
  binds.push(limit, offset)

  const sql = `
    SELECT
      t.collection_date,
      t.bank_name,
      t.product_id,
      t.product_name,
      t.security_purpose,
      t.repayment_type,
      t.lvr_tier,
      t.rate_structure,
      t.feature_set,
      t.interest_rate,
      t.comparison_rate,
      t.annual_fee,
      t.data_quality_flag,
      t.confidence_score,
      t.retrieval_type,
      t.source_url,
      t.product_url,
      t.published_at,
      (
        SELECT h.cdr_product_detail_hash
        FROM historical_loan_rates h
        WHERE h.bank_name = t.bank_name
          AND h.product_id = t.product_id
          AND h.security_purpose = t.security_purpose
          AND h.repayment_type = t.repayment_type
          AND h.rate_structure = t.rate_structure
          AND h.lvr_tier = t.lvr_tier
          AND h.collection_date = t.collection_date
          AND h.parsed_at = t.parsed_at
          AND h.run_source = t.run_source
        LIMIT 1
      ) AS cdr_product_detail_hash,
      t.parsed_at,
      MIN(t.parsed_at) OVER (PARTITION BY t.product_key) AS first_retrieved_at,
      MAX(CASE WHEN t.data_quality_flag LIKE 'cdr_live%' THEN t.parsed_at END) OVER (
        PARTITION BY
          t.bank_name,
          t.product_id,
          t.security_purpose,
          t.repayment_type,
          t.lvr_tier,
          t.rate_structure,
          t.interest_rate,
          t.comparison_rate,
          t.annual_fee
      ) AS rate_confirmed_at,
      t.run_source,
      t.product_key,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= t.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM vw_rate_timeseries t
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = t.bank_name
      AND pps.product_id = t.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.collection_date ASC, t.parsed_at ASC
    LIMIT ? OFFSET ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  const hydrated = await hydrateCdrDetailJson(db, rows(result))
  return hydrated.map((row) => presentHomeLoanRow(row))
}
