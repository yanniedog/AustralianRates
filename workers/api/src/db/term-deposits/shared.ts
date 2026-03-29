import { applyTdCompareEdgeExclusions } from '../compare-edge-exclusions'
import { runSourceWhereClause, type SourceMode } from '../../utils/source-mode'
import {
  addBalanceBandOverlapWhere,
  addBankWhere,
  addDatasetModeWhere,
  addSingleColumnRateBoundsWhere,
} from '../query-common'
import {
  MAX_PUBLIC_RATE as DEPOSIT_MAX_PUBLIC_RATE,
  MIN_CONFIDENCE as DEPOSIT_MIN_CONFIDENCE,
  MIN_CONFIDENCE_HISTORICAL as DEPOSIT_MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE as DEPOSIT_MIN_PUBLIC_RATE,
} from '../deposits-common'

export const MIN_PUBLIC_RATE = DEPOSIT_MIN_PUBLIC_RATE
export const MAX_PUBLIC_RATE = DEPOSIT_MAX_PUBLIC_RATE
export const MIN_CONFIDENCE = DEPOSIT_MIN_CONFIDENCE
export const MIN_CONFIDENCE_HISTORICAL = DEPOSIT_MIN_CONFIDENCE_HISTORICAL

export type TdPaginatedFilters = {
  page?: number
  size?: number
  /** Optional export cap; omitted means all matching rows. */
  limit?: number
  startDate?: string
  endDate?: string
  bank?: string
  banks?: string[]
  termMonths?: string
  depositTier?: string
  balanceMin?: number
  balanceMax?: number
  interestPayment?: string
  minRate?: number
  maxRate?: number
  includeRemoved?: boolean
  excludeCompareEdgeCases?: boolean
  sort?: string
  dir?: 'asc' | 'desc'
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
}

export type LatestTdFilters = {
  bank?: string
  banks?: string[]
  termMonths?: string
  depositTier?: string
  balanceMin?: number
  balanceMax?: number
  interestPayment?: string
  minRate?: number
  maxRate?: number
  includeRemoved?: boolean
  excludeCompareEdgeCases?: boolean
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
  limit?: number
  orderBy?: 'default' | 'rate_asc' | 'rate_desc'
}

export type TdTimeseriesFilters = {
  bank?: string
  banks?: string[]
  productKey?: string
  seriesKey?: string
  termMonths?: string
  depositTier?: string
  balanceMin?: number
  balanceMax?: number
  interestPayment?: string
  minRate?: number
  maxRate?: number
  includeRemoved?: boolean
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}

export const SORT_COLUMNS: Record<string, string> = {
  collection_date: 'h.collection_date',
  bank_name: 'h.bank_name',
  product_name: 'h.product_name',
  term_months: 'h.term_months',
  interest_rate: 'h.interest_rate',
  deposit_tier: 'h.deposit_tier',
  interest_payment: 'h.interest_payment',
  parsed_at: 'h.parsed_at',
  retrieved_at: 'h.parsed_at',
  found_at: 'first_retrieved_at',
  first_retrieved_at: 'first_retrieved_at',
  rate_confirmed_at: 'rate_confirmed_at',
  run_source: 'h.run_source',
  retrieval_type: 'h.retrieval_type',
  is_removed: 'is_removed',
  removed_at: 'removed_at',
  source_url: 'h.source_url',
  product_url: 'h.product_url',
  published_at: 'h.published_at',
  cdr_product_detail_json: 'h.cdr_product_detail_hash',
}

export function addRateBoundsWhere(
  where: string[],
  binds: Array<string | number>,
  interestRateColumn: string,
  minRate?: number,
  maxRate?: number,
) {
  addSingleColumnRateBoundsWhere(where, binds, interestRateColumn, minRate, maxRate)
}

export function buildWhere(filters: TdPaginatedFilters): { clause: string; binds: Array<string | number> } {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', filters.minRate, filters.maxRate)
  addDatasetModeWhere(
    where,
    binds,
    'h.retrieval_type',
    'h.confidence_score',
    filters.mode,
    MIN_CONFIDENCE,
    MIN_CONFIDENCE_HISTORICAL,
  )

  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))
  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  if (filters.termMonths) { where.push('CAST(h.term_months AS TEXT) = ?'); binds.push(filters.termMonths) }
  if (filters.depositTier) { where.push('h.deposit_tier = ?'); binds.push(filters.depositTier) }
  addBalanceBandOverlapWhere(where, binds, 'h.min_deposit', 'h.max_deposit', filters.balanceMin, filters.balanceMax)
  if (filters.interestPayment) { where.push('h.interest_payment = ?'); binds.push(filters.interestPayment) }
  if (filters.startDate) { where.push('h.collection_date >= ?'); binds.push(filters.startDate) }
  if (filters.endDate) { where.push('h.collection_date <= ?'); binds.push(filters.endDate) }
  if (!filters.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')

  applyTdCompareEdgeExclusions(where, 'h.product_name', 'h.min_deposit', filters.excludeCompareEdgeCases)

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', binds }
}
