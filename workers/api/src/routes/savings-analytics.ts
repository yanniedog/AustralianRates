import type { Hono } from 'hono'
import type { AppContext } from '../types'
import { parseSourceMode } from '../utils/source-mode'
import { collectSavingsAnalyticsRowsResolved } from './analytics-data'
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
    accountType: query.account_type,
    rateType: query.rate_type,
    depositTier: query.deposit_tier,
    balanceMin: parseOptionalNumber(query.balance_min),
    balanceMax: parseOptionalNumber(query.balance_max),
    minRate: parseOptionalNumber(query.min_rate),
    maxRate: parseOptionalNumber(query.max_rate),
    includeRemoved: parseIncludeRemoved(query.include_removed),
    mode: parsePublicMode(query.mode),
    sourceMode: parseSourceMode(query.source_mode, query.include_manual),
  } as const
}

export function registerSavingsAnalyticsRoutes(publicRoutes: Hono<AppContext>): void {
  registerAnalyticsRoutes(publicRoutes, {
    section: 'savings',
    buildFilters,
    collectRowsResolved: collectSavingsAnalyticsRowsResolved,
  })
}
