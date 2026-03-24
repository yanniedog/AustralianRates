import { applySavingsCompareEdgeExclusions } from '../compare-edge-exclusions'
import { runSourceWhereClause, type SourceMode } from '../../utils/source-mode'
import { addBankWhere } from '../query-common'

export const MIN_PUBLIC_RATE = 0
export const MAX_PUBLIC_RATE = 15
export const MIN_CONFIDENCE = 0.85
export const MIN_CONFIDENCE_HISTORICAL = 0.65

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
  if (Number.isFinite(minRate)) {
    where.push(`${interestRateColumn} >= ?`)
    binds.push(Number(minRate))
  }
  if (Number.isFinite(maxRate)) {
    where.push(`${interestRateColumn} <= ?`)
    binds.push(Number(maxRate))
  }
}

export function buildWhere(filters: SavingsPaginatedFilters): { clause: string; binds: Array<string | number> } {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', filters.minRate, filters.maxRate)
  if (filters.mode === 'daily') {
    where.push("h.retrieval_type != 'historical_scrape'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (filters.mode === 'historical') {
    where.push("h.retrieval_type = 'historical_scrape'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }

  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))
  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  if (filters.accountType) { where.push('h.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('h.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('h.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.startDate) { where.push('h.collection_date >= ?'); binds.push(filters.startDate) }
  if (filters.endDate) { where.push('h.collection_date <= ?'); binds.push(filters.endDate) }
  if (!filters.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')

  applySavingsCompareEdgeExclusions(where, 'h.product_name', filters.excludeCompareEdgeCases)

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', binds }
}
