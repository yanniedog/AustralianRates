import type { SourceMode } from '../../utils/source-mode'

export type LatestFilters = {
  bank?: string
  banks?: string[]
  securityPurpose?: string
  repaymentType?: string
  rateStructure?: string
  lvrTier?: string
  featureSet?: string
  minRate?: number
  maxRate?: number
  minComparisonRate?: number
  maxComparisonRate?: number
  includeRemoved?: boolean
  /** Omit Veterans / sustainable / bridging-style names from default compare views. Default true. */
  excludeCompareEdgeCases?: boolean
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
  limit?: number
  orderBy?: 'default' | 'rate_asc' | 'rate_desc'
}

export type TimeseriesFilters = {
  bank?: string
  banks?: string[]
  productKey?: string
  seriesKey?: string
  securityPurpose?: string
  repaymentType?: string
  featureSet?: string
  minRate?: number
  maxRate?: number
  minComparisonRate?: number
  maxComparisonRate?: number
  includeRemoved?: boolean
  excludeCompareEdgeCases?: boolean
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}

export type RatesPaginatedFilters = {
  page?: number
  size?: number
  startDate?: string
  endDate?: string
  bank?: string
  banks?: string[]
  securityPurpose?: string
  repaymentType?: string
  rateStructure?: string
  lvrTier?: string
  featureSet?: string
  minRate?: number
  maxRate?: number
  minComparisonRate?: number
  maxComparisonRate?: number
  includeRemoved?: boolean
  excludeCompareEdgeCases?: boolean
  sort?: string
  dir?: 'asc' | 'desc'
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
}

export type RatesExportFilters = Omit<RatesPaginatedFilters, 'page' | 'size'> & { limit?: number }

export const VALID_ORDER_BY: Record<string, string> = {
  default: 'v.collection_date DESC, v.bank_name ASC, v.product_name ASC, v.lvr_tier ASC, v.rate_structure ASC',
  rate_asc: 'v.interest_rate ASC, v.bank_name ASC, v.product_name ASC',
  rate_desc: 'v.interest_rate DESC, v.bank_name ASC, v.product_name ASC',
}

export const PAGINATED_SORT_COLUMNS: Record<string, string> = {
  collection_date: 'h.collection_date',
  bank_name: 'h.bank_name',
  product_name: 'h.product_name',
  security_purpose: 'h.security_purpose',
  repayment_type: 'h.repayment_type',
  rate_structure: 'h.rate_structure',
  lvr_tier: 'h.lvr_tier',
  feature_set: 'h.feature_set',
  interest_rate: 'h.interest_rate',
  comparison_rate: 'h.comparison_rate',
  annual_fee: 'h.annual_fee',
  rba_cash_rate: 'rba_cash_rate',
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

export const MIN_PUBLIC_RATE = 0.5
export const MAX_PUBLIC_RATE = 25
export const MIN_CONFIDENCE_ALL = 0.85
export const MIN_CONFIDENCE_DAILY = 0.9
export const MIN_CONFIDENCE_HISTORICAL = 0.82
