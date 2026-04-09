import { getReadDbFromEnv } from '../db/read-db'
import {
  buildPrecomputedChartScope,
  buildPrecomputedChartScopeForPreset,
  PRECOMPUTED_CHART_WINDOWS,
  resolveChartDateRangeFromDb,
  writeD1ChartCache,
  type ChartCacheScope,
  type ChartCacheSection,
} from '../db/chart-cache'
import { queryReportPlotPayload, refreshAllReportDeltaTables } from '../db/report-plot'
import { writeD1ReportPlotCache } from '../db/report-plot-cache'
import type { EnvBindings } from '../types'
import {
  collectHomeLoanAnalyticsRowsResolved,
  collectSavingsAnalyticsRowsResolved,
  collectTdAnalyticsRowsResolved,
} from '../routes/analytics-data'
import { log } from '../utils/logger'
import type { ChartWindow } from '../utils/chart-window'
import type { ReportPlotMode } from '../db/report-plot-types'

const SECTIONS: ChartCacheSection[] = ['home_loans', 'savings', 'term_deposits']
const REPRESENTATIONS = ['day', 'change'] as const
const REPORT_PLOT_MODES: ReportPlotMode[] = ['moves', 'bands']
const DEFAULT_CACHE_LOOKBACK_DAYS = 365

type PrecomputedScopeSpec = {
  cacheScope: ChartCacheScope
  window: ChartWindow | null
  preset: 'consumer-default' | null
}

const SECTION_TABLES: Record<ChartCacheSection, string> = {
  home_loans: 'historical_loan_rates',
  savings: 'historical_savings_rates',
  term_deposits: 'historical_term_deposit_rates',
}

/** Default end date for chart cache: today (YYYY-MM-DD). */
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function boundedLookbackStartDate(endDate: string): string {
  const start = new Date(`${endDate}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - DEFAULT_CACHE_LOOKBACK_DAYS)
  return start.toISOString().slice(0, 10)
}

/** Resolve default date range for a section: last 365 days, bounded by the dataset's earliest row. */
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

/** Build default filters for precomputed cache: last 365 days to today, no selective filters. */
async function defaultFilters(
  db: EnvBindings['DB'],
  section: ChartCacheSection,
): Promise<{ startDate: string; endDate: string; mode: 'all'; includeRemoved: false; sourceMode: 'all' }> {
  const { startDate, endDate } = await getDefaultDateRangeForSection(db, section)
  return {
    startDate,
    endDate,
    mode: 'all' as const,
    includeRemoved: false,
    sourceMode: 'all' as const,
  }
}

type PrecomputedFilters = {
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

function precomputedScopeSpecs(section: ChartCacheSection): PrecomputedScopeSpec[] {
  const rawScopes: PrecomputedScopeSpec[] = [null, ...PRECOMPUTED_CHART_WINDOWS].map((window) => ({
    cacheScope: buildPrecomputedChartScope(window),
    window,
    preset: null,
  }))
  if (section === 'home_loans' || section === 'savings') {
    return rawScopes.concat(
      [null, ...PRECOMPUTED_CHART_WINDOWS].map((window) => ({
        cacheScope: buildPrecomputedChartScopeForPreset(window, 'consumer-default'),
        window,
        preset: 'consumer-default' as const,
      })),
    )
  }
  return rawScopes
}

function applyPresetFilters(
  section: ChartCacheSection,
  filters: PrecomputedFilters,
  preset: 'consumer-default' | null,
): PrecomputedFilters {
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

async function scopeFilters(
  db: EnvBindings['DB'],
  section: ChartCacheSection,
  spec: PrecomputedScopeSpec,
): Promise<PrecomputedFilters> {
  const baseFilters = !spec.window
    ? await defaultFilters(db, section)
    : (await resolveChartDateRangeFromDb(
        db,
        section,
        {
          mode: 'all' as const,
          includeRemoved: false,
          sourceMode: 'all' as const,
        },
        { window: spec.window },
      )) as PrecomputedFilters
  return applyPresetFilters(section, baseFilters, spec.preset)
}

/** Refresh scoped chart request caches for all sections and representations. Called by cron every 15 min. */
export async function refreshChartPivotCache(env: EnvBindings): Promise<{ ok: boolean; refreshed: number; errors: string[] }> {
  const db = env.DB
  const rd = getReadDbFromEnv(env)
  const dbs = { canonicalDb: rd, analyticsDb: rd }
  const errors: string[] = []
  let refreshed = 0

  try {
    await refreshAllReportDeltaTables(db)
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    errors.push(`report_deltas: ${msg}`)
    log.warn('chart_cache_refresh', 'Failed to refresh report delta projections', {
      code: 'report_delta_refresh_failed',
      context: msg,
    })
  }

  for (const section of SECTIONS) {
    for (const spec of precomputedScopeSpecs(section)) {
      const filters = await scopeFilters(rd, section, spec)
      const cacheScope = spec.cacheScope
      for (const rep of REPRESENTATIONS) {
        try {
          const result =
            section === 'home_loans'
              ? await collectHomeLoanAnalyticsRowsResolved(dbs, rep, { ...filters, disableRowCap: true })
              : section === 'savings'
                ? await collectSavingsAnalyticsRowsResolved(dbs, rep, { ...filters, disableRowCap: true })
                : await collectTdAnalyticsRowsResolved(dbs, rep, { ...filters, disableRowCap: true })
          await writeD1ChartCache(db, section, rep, cacheScope, result)
          refreshed++
        } catch (e) {
          const msg = (e as Error)?.message ?? String(e)
          errors.push(`${section}:${rep}:${cacheScope}: ${msg}`)
          log.warn('chart_cache_refresh', `Failed to refresh ${section} ${rep} ${cacheScope}`, {
            code: 'chart_cache_refresh_failed',
            context: msg,
          })
        }
      }
      for (const mode of REPORT_PLOT_MODES) {
        try {
          const payload = await queryReportPlotPayload(rd, section, mode, filters)
          await writeD1ReportPlotCache(db, section, mode, cacheScope, payload)
          refreshed++
        } catch (e) {
          const msg = (e as Error)?.message ?? String(e)
          errors.push(`${section}:report-plot:${mode}:${cacheScope}: ${msg}`)
          log.warn('chart_cache_refresh', `Failed to refresh ${section} report-plot ${mode} ${cacheScope}`, {
            code: 'report_plot_cache_refresh_failed',
            context: msg,
          })
        }
      }
    }
  }

  if (refreshed > 0) {
    log.info('chart_cache_refresh', 'Chart pivot cache refreshed', {
      context: `refreshed=${refreshed} errors=${errors.length}`,
    })
  }
  return { ok: errors.length === 0, refreshed, errors }
}
