/**
 * Shared helpers for resolving cache-scope strings into concrete query filters.
 *
 * A ChartCacheScope like `preset:consumer-default:window:90D` determines:
 *   - the date range (90 days ending today, clipped to dataset min),
 *   - the preset filter fields applied (consumer-default adds owner-occupied, P&I,
 *     variable, LVR 80-85, min-rate sentinel for home loans; `accountType: savings`
 *     for savings).
 *
 * Used by `chart-cache-refresh` and the `/snapshot` route to guarantee both
 * caches and the snapshot bundle precompute with identical filters.
 */

import {
  resolveChartDateRangeFromDb,
  type ChartCacheScope,
  type ChartCacheSection,
} from './chart-cache'
import { parseChartWindow, type ChartWindow } from '../utils/chart-window'

const DEFAULT_CACHE_LOOKBACK_DAYS = 365

const SECTION_TABLES: Record<ChartCacheSection, string> = {
  home_loans: 'historical_loan_rates',
  savings: 'historical_savings_rates',
  term_deposits: 'historical_term_deposit_rates',
}

export type ScopePreset = 'consumer-default'

export type ScopeParts = {
  window: ChartWindow | null
  preset: ScopePreset | null
}

export type ScopedFilters = {
  startDate: string
  endDate: string
  mode: 'all'
  includeRemoved: false
  sourceMode: 'all'
  securityPurpose?: 'owner_occupied'
  repaymentType?: 'principal_and_interest'
  rateStructure?: 'variable'
  lvrTier?: 'lvr_80-85%'
  minRate?: number
  accountType?: 'savings'
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function boundedLookbackStartDate(endDate: string): string {
  const start = new Date(`${endDate}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - DEFAULT_CACHE_LOOKBACK_DAYS)
  return start.toISOString().slice(0, 10)
}

/** Default date range: last 365 days clipped to the dataset's earliest row and today. */
async function getDefaultDateRangeForSection(
  db: D1Database,
  section: ChartCacheSection,
): Promise<{ startDate: string; endDate: string }> {
  const table = SECTION_TABLES[section]
  const row = await db
    .prepare(`SELECT MIN(collection_date) AS min_date FROM ${table}`)
    .first<{ min_date: string | null }>()
  const endDate = todayYmd()
  const boundedStartDate = boundedLookbackStartDate(endDate)
  const minDate = row?.min_date && /^\d{4}-\d{2}-\d{2}$/.test(row.min_date) ? row.min_date : null
  const startDate = minDate && minDate > boundedStartDate ? minDate : boundedStartDate
  return { startDate, endDate }
}

/** Split a scope string into its window / preset components. */
export function parseChartCacheScope(scope: ChartCacheScope): ScopeParts {
  const consumerPrefix = 'preset:consumer-default'
  if (scope === consumerPrefix) return { window: null, preset: 'consumer-default' }
  if (scope.startsWith(`${consumerPrefix}:window:`)) {
    return {
      window: parseChartWindow(scope.slice(`${consumerPrefix}:window:`.length)),
      preset: 'consumer-default',
    }
  }
  if (scope.startsWith('window:')) {
    return { window: parseChartWindow(scope.slice('window:'.length)), preset: null }
  }
  return { window: null, preset: null }
}

/** Layer the preset-specific filter fields on top of a base filter set. */
export function applyPresetFilters(
  section: ChartCacheSection,
  filters: ScopedFilters,
  preset: ScopePreset | null,
): ScopedFilters {
  if (preset !== 'consumer-default') return filters
  if (section === 'home_loans') {
    return {
      ...filters,
      securityPurpose: 'owner_occupied',
      repaymentType: 'principal_and_interest',
      rateStructure: 'variable',
      lvrTier: 'lvr_80-85%',
      // Public home-loan UI injects 0.01 as the min-rate display sentinel on first load.
      minRate: 0.01,
    }
  }
  if (section === 'savings') {
    return {
      ...filters,
      accountType: 'savings',
    }
  }
  return filters
}

/** Base filters (no preset, no window). Same shape chart-cache-refresh has used. */
async function defaultFilters(
  db: D1Database,
  section: ChartCacheSection,
): Promise<ScopedFilters> {
  const { startDate, endDate } = await getDefaultDateRangeForSection(db, section)
  return {
    startDate,
    endDate,
    mode: 'all' as const,
    includeRemoved: false,
    sourceMode: 'all' as const,
  }
}

/** Resolve the concrete query filter set for a `ChartCacheScope` string. */
export async function resolveFiltersForScope(
  db: D1Database,
  section: ChartCacheSection,
  scope: ChartCacheScope,
): Promise<ScopedFilters> {
  const { window, preset } = parseChartCacheScope(scope)
  const base: ScopedFilters = !window
    ? await defaultFilters(db, section)
    : ((await resolveChartDateRangeFromDb(
        db,
        section,
        {
          mode: 'all' as const,
          includeRemoved: false,
          sourceMode: 'all' as const,
        },
        { window },
      )) as ScopedFilters)
  return applyPresetFilters(section, base, preset)
}
