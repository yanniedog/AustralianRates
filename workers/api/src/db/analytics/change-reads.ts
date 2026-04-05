import type { DatasetKind } from '../../../../../packages/shared/src/index.js'
import { runSourceWhereClause, type SourceMode } from '../../utils/source-mode'
import { presentHomeLoanRow, presentSavingsRow, presentTdRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import {
  applyHomeLoanCompareEdgeExclusions,
  applySavingsCompareEdgeExclusions,
  applyTdCompareEdgeExclusions,
} from '../compare-edge-exclusions'
import { MIN_CONFIDENCE_ALL, MIN_CONFIDENCE_HISTORICAL, MAX_PUBLIC_RATE as HOME_MAX_RATE, MIN_PUBLIC_RATE as HOME_MIN_RATE } from '../home-loans/shared'
import {
  addBalanceBandOverlapWhere,
  addBankWhere,
  addDatasetModeWhere,
  addRateBoundsWhere,
  addSingleColumnRateBoundsWhere,
  rows,
  safeLimit,
  type DatasetMode,
} from '../query-common'
import { MAX_PUBLIC_RATE as SAVINGS_MAX_RATE, MIN_CONFIDENCE as SAVINGS_MIN_CONFIDENCE, MIN_CONFIDENCE_HISTORICAL as SAVINGS_MIN_CONFIDENCE_HISTORICAL, MIN_PUBLIC_RATE as SAVINGS_MIN_RATE } from '../savings/shared'
import { MAX_PUBLIC_RATE as TD_MAX_RATE, MIN_CONFIDENCE as TD_MIN_CONFIDENCE, MIN_CONFIDENCE_HISTORICAL as TD_MIN_CONFIDENCE_HISTORICAL, MIN_PUBLIC_RATE as TD_MIN_RATE } from '../term-deposits/shared'
import { getAnalyticsDatasetConfig } from './config'

type CommonInput = {
  bank?: string
  banks?: string[]
  productKey?: string
  seriesKey?: string
  minRate?: number
  maxRate?: number
  includeRemoved?: boolean
  mode?: DatasetMode
  sourceMode?: SourceMode
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
  /** Newest-first SQL order for chunked reads; default asc for normal pagination. */
  rowSort?: 'asc' | 'desc'
  disableRowCap?: boolean
  excludeCompareEdgeCases?: boolean
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

export type HomeLoanAnalyticsInput = CommonInput & {
  securityPurpose?: string
  repaymentType?: string
  rateStructure?: string
  lvrTier?: string
  featureSet?: string
  minComparisonRate?: number
  maxComparisonRate?: number
}

export type SavingsAnalyticsInput = CommonInput & {
  accountType?: string
  rateType?: string
  depositTier?: string
  balanceMin?: number
  balanceMax?: number
}

export type TdAnalyticsInput = CommonInput & {
  termMonths?: string
  depositTier?: string
  balanceMin?: number
  balanceMax?: number
  interestPayment?: string
}

function addCommonEventWhere(
  where: string[],
  binds: Array<string | number>,
  alias: string,
  input: CommonInput,
): void {
  addBankWhere(where, binds, `${alias}.bank_name`, input.bank, input.banks)
  if (input.seriesKey) {
    where.push(`${alias}.series_key = ?`)
    binds.push(input.seriesKey)
  } else if (input.productKey) {
    where.push(`${alias}.product_key = ?`)
    binds.push(input.productKey)
  }
  if (!input.includeRemoved) {
    where.push(`COALESCE(${alias}.is_removed, 0) = 0`)
  }
  where.push(runSourceWhereClause(`${alias}.run_source`, input.sourceMode ?? 'all'))
  if (input.startDate) {
    where.push(`${alias}.collection_date >= ?`)
    binds.push(input.startDate)
  }
  where.push(`${alias}.collection_date <= ?`)
  binds.push(input.endDate && input.endDate <= todayYmd() ? input.endDate : todayYmd())
}

async function queryAnalyticsRows<T extends Record<string, unknown>>(
  db: D1Database,
  tableName: string,
  where: string[],
  binds: Array<string | number>,
  presenter: (row: T) => T & Record<string, unknown>,
  limit: number,
  offset: number,
  sortOrder: 'ASC' | 'DESC' = 'ASC',
): Promise<Array<Record<string, unknown>>> {
  const sql = `
    SELECT *
    FROM ${tableName} e
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY e.collection_date ${sortOrder}, e.parsed_at ${sortOrder}
    LIMIT ? OFFSET ?
  `
  const result = await db.prepare(sql).bind(...binds, limit, offset).all<T>()
  const hydrated = await hydrateCdrDetailJson(db, rows(result))
  return hydrated.map((row) => presenter(row as T))
}

export async function queryHomeLoanAnalyticsRows(db: D1Database, input: HomeLoanAnalyticsInput) {
  const where: string[] = ['e.interest_rate BETWEEN ? AND ?']
  const binds: Array<string | number> = [HOME_MIN_RATE, HOME_MAX_RATE]
  addRateBoundsWhere(where, binds, 'e.interest_rate', 'e.comparison_rate', input)
  addDatasetModeWhere(
    where,
    binds,
    'e.retrieval_type',
    'e.confidence_score',
    input.mode,
    MIN_CONFIDENCE_ALL,
    MIN_CONFIDENCE_HISTORICAL,
  )
  addCommonEventWhere(where, binds, 'e', input)
  if (input.securityPurpose) { where.push('e.security_purpose = ?'); binds.push(input.securityPurpose) }
  if (input.repaymentType) { where.push('e.repayment_type = ?'); binds.push(input.repaymentType) }
  if (input.rateStructure) { where.push('e.rate_structure = ?'); binds.push(input.rateStructure) }
  if (input.lvrTier) { where.push('e.lvr_tier = ?'); binds.push(input.lvrTier) }
  if (input.featureSet) { where.push('e.feature_set = ?'); binds.push(input.featureSet) }
  applyHomeLoanCompareEdgeExclusions(where, 'e.product_name', input.excludeCompareEdgeCases)
  const sortOrder = input.rowSort === 'desc' ? 'DESC' : 'ASC'
  return queryAnalyticsRows(
    db,
    'home_loan_rate_events',
    where,
    binds,
    presentHomeLoanRow,
    safeLimit(input.limit, 5000, 50000),
    Math.max(0, Number(input.offset) || 0),
    sortOrder,
  )
}

export async function querySavingsAnalyticsRows(db: D1Database, input: SavingsAnalyticsInput) {
  const where: string[] = ['e.interest_rate BETWEEN ? AND ?']
  const binds: Array<string | number> = [SAVINGS_MIN_RATE, SAVINGS_MAX_RATE]
  addSingleColumnRateBoundsWhere(where, binds, 'e.interest_rate', input.minRate, input.maxRate)
  addDatasetModeWhere(
    where,
    binds,
    'e.retrieval_type',
    'e.confidence_score',
    input.mode,
    SAVINGS_MIN_CONFIDENCE,
    SAVINGS_MIN_CONFIDENCE_HISTORICAL,
  )
  addCommonEventWhere(where, binds, 'e', input)
  if (input.accountType) { where.push('e.account_type = ?'); binds.push(input.accountType) }
  if (input.rateType) { where.push('e.rate_type = ?'); binds.push(input.rateType) }
  if (input.depositTier) { where.push('e.deposit_tier = ?'); binds.push(input.depositTier) }
  addBalanceBandOverlapWhere(where, binds, 'e.min_balance', 'e.max_balance', input.balanceMin, input.balanceMax)
  applySavingsCompareEdgeExclusions(where, 'e.product_name', input.excludeCompareEdgeCases)
  const sortOrder = input.rowSort === 'desc' ? 'DESC' : 'ASC'
  return queryAnalyticsRows(
    db,
    'savings_rate_events',
    where,
    binds,
    presentSavingsRow,
    safeLimit(input.limit, 5000, 50000),
    Math.max(0, Number(input.offset) || 0),
    sortOrder,
  )
}

export async function queryTdAnalyticsRows(db: D1Database, input: TdAnalyticsInput) {
  const where: string[] = ['e.interest_rate BETWEEN ? AND ?']
  const binds: Array<string | number> = [TD_MIN_RATE, TD_MAX_RATE]
  addSingleColumnRateBoundsWhere(where, binds, 'e.interest_rate', input.minRate, input.maxRate)
  addDatasetModeWhere(
    where,
    binds,
    'e.retrieval_type',
    'e.confidence_score',
    input.mode,
    TD_MIN_CONFIDENCE,
    TD_MIN_CONFIDENCE_HISTORICAL,
  )
  addCommonEventWhere(where, binds, 'e', input)
  if (input.termMonths) { where.push('CAST(e.term_months AS TEXT) = ?'); binds.push(input.termMonths) }
  if (input.depositTier) { where.push('e.deposit_tier = ?'); binds.push(input.depositTier) }
  addBalanceBandOverlapWhere(where, binds, 'e.min_deposit', 'e.max_deposit', input.balanceMin, input.balanceMax)
  if (input.interestPayment) { where.push('e.interest_payment = ?'); binds.push(input.interestPayment) }
  applyTdCompareEdgeExclusions(where, 'e.product_name', 'e.min_deposit', input.excludeCompareEdgeCases)
  const sortOrder = input.rowSort === 'desc' ? 'DESC' : 'ASC'
  return queryAnalyticsRows(
    db,
    'td_rate_events',
    where,
    binds,
    presentTdRow,
    safeLimit(input.limit, 5000, 50000),
    Math.max(0, Number(input.offset) || 0),
    sortOrder,
  )
}

export async function queryAnalyticsRateChanges(
  db: D1Database,
  dataset: DatasetKind,
  input: { limit?: number; offset?: number },
): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
  const config = getAnalyticsDatasetConfig(dataset)
  const detailSelect = config.changeDetailColumns.map((column) => `ordered.${column}`).join(', ')
  const countResult = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${config.eventsTable} WHERE event_type = 'rate_change'`)
    .first<{ total: number }>()
  const limit = safeLimit(input.limit, 200, 1000)
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0))
  const result = await db
    .prepare(
      `
        WITH ordered AS (
          SELECT
            e.*,
            LAG(e.collection_date) OVER (PARTITION BY e.series_key ORDER BY e.collection_date ASC, e.parsed_at ASC) AS previous_collection_date,
            LAG(e.parsed_at) OVER (PARTITION BY e.series_key ORDER BY e.collection_date ASC, e.parsed_at ASC) AS previous_changed_at
          FROM ${config.eventsTable} e
          WHERE e.event_type = 'rate_change'
        )
        SELECT
          ordered.parsed_at AS changed_at,
          ordered.previous_changed_at,
          ordered.collection_date,
          ordered.previous_collection_date,
          ordered.bank_name,
          ordered.product_name,
          ordered.series_key,
          ordered.product_key,
          ${detailSelect},
          CAST(json_extract(ordered.change_json, '$.interest_rate.from') AS REAL) AS previous_rate,
          CAST(json_extract(ordered.change_json, '$.interest_rate.to') AS REAL) AS new_rate,
          ROUND(
            (
              CAST(json_extract(ordered.change_json, '$.interest_rate.to') AS REAL) -
              CAST(json_extract(ordered.change_json, '$.interest_rate.from') AS REAL)
            ) * 100,
            3
          ) AS delta_bps,
          ordered.run_source
        FROM ordered
        ORDER BY changed_at DESC
        LIMIT ?1 OFFSET ?2
      `,
    )
    .bind(limit, offset)
    .all<Record<string, unknown>>()

  return {
    total: Number(countResult?.total ?? 0),
    rows: result.results ?? [],
  }
}
