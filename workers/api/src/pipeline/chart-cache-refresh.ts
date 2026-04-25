import { getReadDbFromEnv } from '../db/read-db'
import {
  buildPrecomputedChartScope,
  buildPrecomputedChartScopeForPreset,
  PRECOMPUTED_CHART_WINDOWS,
  writeD1ChartCache,
  type ChartCacheScope,
  type ChartCacheSection,
} from '../db/chart-cache'
import { resolveFiltersForScope } from '../db/scope-filters'
import { queryReportPlotPayload, refreshAllReportDeltaTables } from '../db/report-plot'
import { writeD1ReportPlotCache } from '../db/report-plot-cache'
import { writeD1SnapshotCache, writeSnapshotKvBundles } from '../db/snapshot-cache'
import { buildSnapshotPayload } from '../routes/snapshot-public'
import type { EnvBindings } from '../types'
import { defaultPublicChartWindowForSection } from '../utils/chart-window'
import {
  collectHomeLoanAnalyticsRowsResolved,
  collectSavingsAnalyticsRowsResolved,
  collectTdAnalyticsRowsResolved,
} from '../routes/analytics-data'
import { log } from '../utils/logger'

const SECTIONS: ChartCacheSection[] = ['home_loans', 'savings', 'term_deposits']
const REPRESENTATIONS = ['day', 'change'] as const

function precomputedScopes(section: ChartCacheSection): ChartCacheScope[] {
  const raw: ChartCacheScope[] = [null, ...PRECOMPUTED_CHART_WINDOWS].map((window) =>
    buildPrecomputedChartScope(window),
  )
  if (section === 'home_loans' || section === 'savings') {
    return raw.concat(
      [null, ...PRECOMPUTED_CHART_WINDOWS].map((window) =>
        buildPrecomputedChartScopeForPreset(window, 'consumer-default'),
      ),
    )
  }
  return raw
}

function publicPackageScopes(section: ChartCacheSection, allScopes = false): ChartCacheScope[] {
  if (allScopes) return precomputedScopes(section)
  const defaultWindow = defaultPublicChartWindowForSection(section)
  if (section === 'home_loans' || section === 'savings') {
    return [`preset:consumer-default:window:${defaultWindow}`, `window:${defaultWindow}`]
  }
  return [`window:${defaultWindow}`]
}

export async function refreshPublicSnapshotPackages(
  env: EnvBindings,
  options?: { allScopes?: boolean },
): Promise<{ ok: boolean; refreshed: number; errors: string[] }> {
  const errors: string[] = []
  let refreshed = 0

  for (const section of SECTIONS) {
    for (const cacheScope of publicPackageScopes(section, options?.allScopes)) {
      try {
        const snapshot = await buildSnapshotPayload(env, section, cacheScope)
        await writeSnapshotKvBundles(env.CHART_CACHE_KV, section, cacheScope, snapshot)
        refreshed++
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e)
        errors.push(`${section}:snapshot:${cacheScope}: ${msg}`)
        log.warn('public_package_refresh', `Failed to refresh ${section} snapshot ${cacheScope}`, {
          code: 'public_package_refresh_failed',
          context: msg,
        })
      }
    }
  }

  log.info('public_package_refresh', 'Public snapshot packages refreshed', {
    context: `refreshed=${refreshed} errors=${errors.length}`,
  })
  return { ok: errors.length === 0, refreshed, errors }
}

/** Refresh scoped chart request caches for all sections and representations. Manual/admin-only in production. */
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
    for (const cacheScope of precomputedScopes(section)) {
      const filters = await resolveFiltersForScope(rd, section, cacheScope)
      for (const rep of REPRESENTATIONS) {
        try {
          const result =
            section === 'home_loans'
              ? await collectHomeLoanAnalyticsRowsResolved(dbs, rep, {
                  ...filters,
                  disableRowCap: true,
                  chartInternalRefresh: true,
                })
              : section === 'savings'
                ? await collectSavingsAnalyticsRowsResolved(dbs, rep, {
                    ...filters,
                    disableRowCap: true,
                    chartInternalRefresh: true,
                  })
                : await collectTdAnalyticsRowsResolved(dbs, rep, {
                    ...filters,
                    disableRowCap: true,
                    chartInternalRefresh: true,
                  })
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
      for (const mode of ['moves', 'bands'] as const) {
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

      try {
        const snapshot = await buildSnapshotPayload(env, section, cacheScope)
        await writeD1SnapshotCache(db, section, cacheScope, snapshot)
        await writeSnapshotKvBundles(env.CHART_CACHE_KV, section, cacheScope, snapshot)
        refreshed++
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e)
        errors.push(`${section}:snapshot:${cacheScope}: ${msg}`)
        log.warn('chart_cache_refresh', `Failed to refresh ${section} snapshot ${cacheScope}`, {
          code: 'snapshot_cache_refresh_failed',
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
