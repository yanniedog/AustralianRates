/**
 * Builds Latest* filters from public chart/report query params matching GET …/latest-all parsing.
 */

import type { LatestFilters } from '../db/home-loans/shared'
import type { LatestSavingsFilters } from '../db/savings/shared'
import type { LatestTdFilters } from '../db/term-deposits/shared'
import {
  parseCsvList,
  parseExcludeCompareEdgeCases,
  parseIncludeRemoved,
  parseOptionalNumber,
  parseOptionalPublicMinRate,
  parsePublicMode,
  parseRateOrderBy,
} from './public-query'
import { parseSourceMode } from '../utils/source-mode'

export type ChartQueryRecord = Record<string, string | undefined>

export function homeLoanLatestFiltersFromChartQuery(q: ChartQueryRecord): LatestFilters {
  return {
    bank: q.bank,
    banks: parseCsvList(q.banks),
    securityPurpose: q.security_purpose,
    repaymentType: q.repayment_type,
    rateStructure: q.rate_structure,
    lvrTier: q.lvr_tier,
    featureSet: q.feature_set,
    minRate: parseOptionalNumber(q.min_rate),
    maxRate: parseOptionalNumber(q.max_rate),
    minComparisonRate: parseOptionalNumber(q.min_comparison_rate),
    maxComparisonRate: parseOptionalNumber(q.max_comparison_rate),
    includeRemoved: parseIncludeRemoved(q.include_removed),
    excludeCompareEdgeCases: parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases),
    mode: parsePublicMode(q.mode),
    sourceMode: parseSourceMode(q.source_mode, q.include_manual),
    limit: 5000,
    orderBy: parseRateOrderBy(q.order_by, q.orderBy),
  }
}

export function savingsLatestFiltersFromChartQuery(q: ChartQueryRecord): LatestSavingsFilters {
  return {
    bank: q.bank,
    banks: parseCsvList(q.banks),
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    balanceMin: parseOptionalNumber(q.balance_min),
    balanceMax: parseOptionalNumber(q.balance_max),
    minRate: parseOptionalPublicMinRate(q.min_rate, { treatPointZeroOneAsDefault: true }),
    maxRate: parseOptionalNumber(q.max_rate),
    includeRemoved: parseIncludeRemoved(q.include_removed),
    excludeCompareEdgeCases: parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases),
    mode: parsePublicMode(q.mode),
    sourceMode: parseSourceMode(q.source_mode, q.include_manual),
    limit: 5000,
    orderBy: parseRateOrderBy(q.order_by, q.orderBy),
  }
}

export function tdLatestFiltersFromChartQuery(q: ChartQueryRecord): LatestTdFilters {
  return {
    bank: q.bank,
    banks: parseCsvList(q.banks),
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    balanceMin: parseOptionalNumber(q.balance_min),
    balanceMax: parseOptionalNumber(q.balance_max),
    minRate: parseOptionalPublicMinRate(q.min_rate, { treatPointZeroOneAsDefault: true }),
    maxRate: parseOptionalNumber(q.max_rate),
    interestPayment: q.interest_payment,
    includeRemoved: parseIncludeRemoved(q.include_removed),
    excludeCompareEdgeCases: parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases),
    mode: parsePublicMode(q.mode),
    sourceMode: parseSourceMode(q.source_mode, q.include_manual),
    limit: 5000,
    orderBy: parseRateOrderBy(q.order_by, q.orderBy),
  }
}
