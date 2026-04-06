import { getReadDb } from '../db/read-db'
import {
  buildPrecomputedChartScope,
  PRECOMPUTED_CHART_WINDOWS,
  resolveChartDateRangeFromDb,
  writeD1ChartCache,
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
const PRECOMPUTED_SCOPES: Array<'default' | ChartWindow> = ['default', ...PRECOMPUTED_CHART_WINDOWS]

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

async function scopeFilters(
  db: EnvBindings['DB'],
  section: ChartCacheSection,
  scope: 'default' | ChartWindow,
): Promise<{ startDate: string; endDate: string; mode: 'all'; includeRemoved: false; sourceMode: 'all' }> {
  if (scope === 'default') return defaultFilters(db, section)
  return resolveChartDateRangeFromDb(
    db,
    section,
    {
      mode: 'all' as const,
      includeRemoved: false,
      sourceMode: 'all' as const,
    },
    { window: scope },
  ) as Promise<{ startDate: string; endDate: string; mode: 'all'; includeRemoved: false; sourceMode: 'all' }>
}

/** Refresh scoped chart request caches for all sections and representations. Called by cron every 15 min. */
export async function refreshChartPivotCache(env: EnvBindings): Promise<{ ok: boolean; refreshed: number; errors: string[] }> {
  const db = env.DB
  const analyticsDb = getReadDb(env)
  const dbs = { canonicalDb: db, analyticsDb }
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
    for (const scope of PRECOMPUTED_SCOPES) {
      const filters = await scopeFilters(db, section, scope)
      const cacheScope = buildPrecomputedChartScope(scope === 'default' ? null : scope)
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
          const payload = await queryReportPlotPayload(db, section, mode, filters)
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
