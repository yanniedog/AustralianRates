import type { Hono } from 'hono'
import type { AppContext } from '../types'
import { parseSourceMode } from '../utils/source-mode'
import { collectTdAnalyticsRowsResolved } from './analytics-data'
import { registerAnalyticsRoutes } from './analytics-route-registration'
import {
  parseExcludeCompareEdgeCases,
  parseCsvList,
  parseIncludeRemoved,
  parseOptionalNumber,
  parseOptionalPublicMinRate,
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
    termMonths: query.term_months,
    depositTier: query.deposit_tier,
    balanceMin: parseOptionalNumber(query.balance_min),
    balanceMax: parseOptionalNumber(query.balance_max),
    interestPayment: query.interest_payment,
    minRate: parseOptionalPublicMinRate(query.min_rate, { treatPointZeroOneAsDefault: true }),
    maxRate: parseOptionalNumber(query.max_rate),
    includeRemoved: parseIncludeRemoved(query.include_removed),
    excludeCompareEdgeCases: parseExcludeCompareEdgeCases(query.exclude_compare_edge_cases),
    mode: parsePublicMode(query.mode),
    sourceMode: parseSourceMode(query.source_mode, query.include_manual),
    disableRowCap: chartWindow != null,
  } as const
}

export function registerTdAnalyticsRoutes(publicRoutes: Hono<AppContext>): void {
  registerAnalyticsRoutes(publicRoutes, {
    section: 'term_deposits',
    buildFilters,
    collectRowsResolved: collectTdAnalyticsRowsResolved,
  })
}
