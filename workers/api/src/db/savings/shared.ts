import { applySavingsCompareEdgeExclusions } from '../compare-edge-exclusions'
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

export type SavingsPaginatedFilters = {
  page?: number
  size?: number
  /** Optional export cap; omitted means all matching rows. */
  limit?: number
  startDate?: string
  endDate?: string
  bank?: string
  banks?: string[]
  accountType?: string
  rateType?: string
  depositTier?: string
  balanceMin?: number
  balanceMax?: number
  minRate?: number
  maxRate?: number
  includeRemoved?: boolean
  /** Omit FX / mis-filed TD-style names from default compare views. Default true. */
  excludeCompareEdgeCases?: boolean
  sort?: string
  dir?: 'asc' | 'desc'
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
}

export type LatestSavingsFilters = {
  bank?: string
  banks?: string[]
  accountType?: string
  rateType?: string
  depositTier?: string
  balanceMin?: number
  balanceMax?: number
  minRate?: number
  maxRate?: number
  includeRemoved?: boolean
  excludeCompareEdgeCases?: boolean
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
  limit?: number
  orderBy?: 'default' | 'rate_asc' | 'rate_desc'
}

export type SavingsTimeseriesFilters = {
  bank?: string
  banks?: string[]
  productKey?: string
  seriesKey?: string
  accountType?: string
  rateType?: string
  depositTier?: string
  balanceMin?: number
  balanceMax?: number
  minRate?: number
  maxRate?: number
  includeRemoved?: boolean
  excludeCompareEdgeCases?: boolean
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
  account_type: 'h.account_type',
  rate_type: 'h.rate_type',
  interest_rate: 'h.interest_rate',
  deposit_tier: 'h.deposit_tier',
  monthly_fee: 'h.monthly_fee',
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

export function buildWhere(filters: SavingsPaginatedFilters): { clause: string; binds: Array<string | number> } {
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
  if (filters.accountType) { where.push('h.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('h.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('h.deposit_tier = ?'); binds.push(filters.depositTier) }
  addBalanceBandOverlapWhere(where, binds, 'h.min_balance', 'h.max_balance', filters.balanceMin, filters.balanceMax)
  if (filters.startDate) { where.push('h.collection_date >= ?'); binds.push(filters.startDate) }
  if (filters.endDate) { where.push('h.collection_date <= ?'); binds.push(filters.endDate) }
  if (!filters.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')

  applySavingsCompareEdgeExclusions(where, 'h.product_name', filters.excludeCompareEdgeCases)

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', binds }
}
