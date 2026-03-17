import { getReadDb } from '../db/read-db'
import { getDefaultDateRange, writeD1ChartCache, type ChartCacheSection } from '../db/chart-cache'
import {
  collectHomeLoanAnalyticsRowsResolved,
  collectSavingsAnalyticsRowsResolved,
  collectTdAnalyticsRowsResolved,
} from '../routes/analytics-data'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'

const SECTIONS: ChartCacheSection[] = ['home_loans', 'savings', 'term_deposits']
const REPRESENTATIONS = ['day', 'change'] as const

/** Build default filters for precomputed cache (last 365 days, no selective filters). */
function defaultFilters() {
  const { startDate, endDate } = getDefaultDateRange()
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
    for (const rep of REPRESENTATIONS) {
      try {
        const filters = defaultFilters()
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
