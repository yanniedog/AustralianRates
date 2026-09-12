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
import { getMelbourneNowParts } from '../utils/time'

const DEFAULT_CACHE_LOOKBACK_DAYS = 365
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

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

export type ResolveFiltersOptions = {
  latestAvailableCollectionDate?: string | null
}

function todayYmd(): string {
  return getMelbourneNowParts().date
}

function boundedLookbackStartDate(endDate: string): string {
  const start = new Date(`${endDate}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - DEFAULT_CACHE_LOOKBACK_DAYS)
  return start.toISOString().slice(0, 10)
}

function normalizeDateYmd(value: string | null | undefined): string | null {
  return value && YMD_RE.test(value) ? value : null
}

export function defaultDateRangeFromCollectionBounds(
  minDate: string | null | undefined,
  maxDate: string | null | undefined,
  latestAvailableCollectionDate?: string | null,
): { startDate: string; endDate: string } {
  const normalizedMax = normalizeDateYmd(maxDate)
  const normalizedLatest = normalizeDateYmd(latestAvailableCollectionDate)
  const normalizedMin = normalizeDateYmd(minDate)
  const endDate = normalizedLatest ?? normalizedMax ?? todayYmd()
  const boundedStartDate = boundedLookbackStartDate(endDate)
  const startDate = normalizedMin && normalizedMin > boundedStartDate ? normalizedMin : boundedStartDate
  return { startDate, endDate }
}

/** Default date range: last 365 days clipped to the dataset's earliest row and latest real collection date. */
async function getDefaultDateRangeForSection(
  db: D1Database,
  section: ChartCacheSection,
  options?: ResolveFiltersOptions,
): Promise<{ startDate: string; endDate: string }> {
  const table = SECTION_TABLES[section]
  const row = await db
    .prepare(`SELECT MIN(collection_date) AS min_date, MAX(collection_date) AS max_date FROM ${table}`)
    .first<{ min_date: string | null; max_date: string | null }>()
  return defaultDateRangeFromCollectionBounds(row?.min_date, row?.max_date, options?.latestAvailableCollectionDate)
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

/** Remove consumer-default preset fields so scenario leaders span all LVR tiers and rate types. */
export function stripConsumerPresetFilters(section: ChartCacheSection, filters: ScopedFilters): ScopedFilters {
  if (section === 'home_loans') {
    const { securityPurpose, repaymentType, rateStructure, lvrTier, minRate, ...rest } = filters
    return rest
  }
  if (section === 'savings') {
    const { accountType, ...rest } = filters
    return rest
  }
  return filters
}

/** Base filters (no preset, no window). Same shape chart-cache-refresh has used. */
async function defaultFilters(
  db: D1Database,
  section: ChartCacheSection,
  options?: ResolveFiltersOptions,
): Promise<ScopedFilters> {
  const { startDate, endDate } = await getDefaultDateRangeForSection(db, section, options)
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
  options?: ResolveFiltersOptions,
): Promise<ScopedFilters> {
  const { window, preset } = parseChartCacheScope(scope)
  const base: ScopedFilters = !window
    ? await defaultFilters(db, section, options)
    : ((await resolveChartDateRangeFromDb(
        db,
        section,
        {
          mode: 'all' as const,
          includeRemoved: false,
          sourceMode: 'all' as const,
        },
        { window, latestAvailableCollectionDate: options?.latestAvailableCollectionDate ?? null },
      )) as ScopedFilters)
  return applyPresetFilters(section, base, preset)
}
