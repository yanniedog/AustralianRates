import type { D1Database } from '@cloudflare/workers-types'
import { getReadDb } from '../db/read-db'
import { writeD1ChartCache, type ChartCacheSection } from '../db/chart-cache'
import {
  collectHomeLoanAnalyticsRowsResolved,
  collectSavingsAnalyticsRowsResolved,
  collectTdAnalyticsRowsResolved,
} from '../routes/analytics-data'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'

const SECTIONS: ChartCacheSection[] = ['home_loans', 'savings', 'term_deposits']
const REPRESENTATIONS = ['day', 'change'] as const

const SECTION_TABLES: Record<ChartCacheSection, string> = {
  home_loans: 'historical_loan_rates',
  savings: 'historical_savings_rates',
  term_deposits: 'historical_term_deposit_rates',
}

/** Default end date for chart cache: today (YYYY-MM-DD). */
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Resolve default date range for a section: earliest collection_date in DB to today. */
async function getDefaultDateRangeForSection(
  db: D1Database,
  section: ChartCacheSection,
): Promise<{ startDate: string; endDate: string }> {
  const table = SECTION_TABLES[section]
  const row = await db
    .prepare(`SELECT MIN(collection_date) AS min_date FROM ${table}`)
    .first<{ min_date: string | null }>()
  const endDate = todayYmd()
  const minDate = row?.min_date && /^\d{4}-\d{2}-\d{2}$/.test(row.min_date) ? row.min_date : null
  let startDate: string
  if (minDate) {
    startDate = minDate
  } else {
    const fallback = new Date()
    fallback.setDate(fallback.getDate() - 365)
    startDate = fallback.toISOString().slice(0, 10)
  }
  return { startDate, endDate }
}

/** Build default filters for precomputed cache: data start to today, no selective filters. */
async function defaultFilters(
  db: D1Database,
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

/** Refresh chart_pivot_cache for all sections and representations. Called by cron every 15 min. */
export async function refreshChartPivotCache(env: EnvBindings): Promise<{ ok: boolean; refreshed: number; errors: string[] }> {
  const db = env.DB
  const analyticsDb = getReadDb(env)
  const dbs = { canonicalDb: db, analyticsDb }
  const errors: string[] = []
  let refreshed = 0

  for (const section of SECTIONS) {
    const filters = await defaultFilters(db, section)
    for (const rep of REPRESENTATIONS) {
      try {
        const result =
          section === 'home_loans'
            ? await collectHomeLoanAnalyticsRowsResolved(dbs, rep, filters)
            : section === 'savings'
              ? await collectSavingsAnalyticsRowsResolved(dbs, rep, filters)
              : await collectTdAnalyticsRowsResolved(dbs, rep, filters)
        await writeD1ChartCache(db, section, rep, result)
        refreshed++
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e)
        errors.push(`${section}:${rep}: ${msg}`)
        log.warn('chart_cache_refresh', `Failed to refresh ${section} ${rep}`, {
          code: 'chart_cache_refresh_failed',
          context: msg,
        })
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
