import type { Hono } from 'hono'
import type { AppContext } from '../types'
import { parseSourceMode } from '../utils/source-mode'
import { collectHomeLoanAnalyticsRowsResolved } from './analytics-data'
import { registerAnalyticsRoutes } from './analytics-route-registration'
import {
  parseExcludeCompareEdgeCases,
  parseCsvList,
  parseIncludeRemoved,
  parseOptionalNumber,
  parsePublicMode,
} from './public-query'
import { parseChartWindow } from '../utils/chart-window'

function buildFilters(query: Record<string, string | undefined>) {
  const chartWindow = parseChartWindow(query.chart_window)
  return {
    startDate: query.start_date,
    endDate: query.end_date,
    chartWindow,
    bank: query.bank,
    banks: parseCsvList(query.banks),
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    minRate: parseOptionalNumber(query.min_rate),
    maxRate: parseOptionalNumber(query.max_rate),
    minComparisonRate: parseOptionalNumber(query.min_comparison_rate),
    maxComparisonRate: parseOptionalNumber(query.max_comparison_rate),
    includeRemoved: parseIncludeRemoved(query.include_removed),
    excludeCompareEdgeCases: parseExcludeCompareEdgeCases(query.exclude_compare_edge_cases),
    mode: parsePublicMode(query.mode),
    sourceMode: parseSourceMode(query.source_mode, query.include_manual),
    disableRowCap: chartWindow != null,
  } as const
}

export function registerHomeLoanAnalyticsRoutes(publicRoutes: Hono<AppContext>): void {
  registerAnalyticsRoutes(publicRoutes, {
    section: 'home_loans',
    buildFilters,
    collectRowsResolved: collectHomeLoanAnalyticsRowsResolved,
  })
}
