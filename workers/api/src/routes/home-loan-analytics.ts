import type { Hono } from 'hono'
import type { AppContext } from '../types'
import { parseSourceMode } from '../utils/source-mode'
import { collectHomeLoanAnalyticsRowsResolved } from './analytics-data'
import { registerAnalyticsRoutes } from './analytics-route-registration'
import {
  parseCsvList,
  parseIncludeRemoved,
  parseOptionalNumber,
  parsePublicMode,
} from './public-query'

function buildFilters(query: Record<string, string | undefined>) {
  return {
    startDate: query.start_date,
    endDate: query.end_date,
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
    mode: parsePublicMode(query.mode),
    sourceMode: parseSourceMode(query.source_mode, query.include_manual),
  } as const
}

export function registerHomeLoanAnalyticsRoutes(publicRoutes: Hono<AppContext>): void {
  registerAnalyticsRoutes(publicRoutes, {
    section: 'home_loans',
    buildFilters,
    collectRowsResolved: collectHomeLoanAnalyticsRowsResolved,
  })
}
