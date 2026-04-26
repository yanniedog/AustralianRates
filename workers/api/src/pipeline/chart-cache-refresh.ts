import { getReadDbFromEnv } from '../db/read-db'
import {
  writeD1ChartCache,
} from '../db/chart-cache'
import { resolveFiltersForScope } from '../db/scope-filters'
import { queryReportPlotPayload, refreshAllReportDeltaTables, REPORT_BANDS_SOURCE_VERSION } from '../db/report-plot'
import { writeD1ReportPlotCache } from '../db/report-plot-cache'
import { buildSnapshotKvKey, writeD1SnapshotCache, writeSnapshotKvBundles } from '../db/snapshot-cache'
import { buildSnapshotPayload } from '../routes/snapshot-public'
import type { EnvBindings } from '../types'
import {
  collectHomeLoanAnalyticsRowsResolved,
  collectSavingsAnalyticsRowsResolved,
  collectTdAnalyticsRowsResolved,
} from '../routes/analytics-data'
import { log } from '../utils/logger'
import {
  precomputedSnapshotScopesForSection,
  publicSnapshotPackageScopeItems,
  PUBLIC_PACKAGE_SECTIONS,
} from './public-package-scopes'

const REPRESENTATIONS = ['day', 'change'] as const
const PUBLIC_PACKAGE_REFRESH_FRESH_MS = 20 * 60 * 60 * 1000

async function isFreshPublicSnapshotPackage(
  kv: KVNamespace | undefined,
  section: (typeof PUBLIC_PACKAGE_SECTIONS)[number],
  scope: string,
): Promise<boolean> {
  if (!kv) return false
  const raw = await kv.get(buildSnapshotKvKey(section, scope as Parameters<typeof buildSnapshotKvKey>[1]))
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as {
      builtAt?: string
      data?: { reportPlotBands?: { meta?: { band_source_version?: number } } }
    }
    if (parsed.data?.reportPlotBands?.meta?.band_source_version !== REPORT_BANDS_SOURCE_VERSION) return false
    const builtAt = new Date(String(parsed.builtAt || '')).getTime()
    return Number.isFinite(builtAt) && Date.now() - builtAt < PUBLIC_PACKAGE_REFRESH_FRESH_MS
  } catch {
    return false
  }
}

export async function refreshPublicSnapshotPackages(
  env: EnvBindings,
  options?: { allScopes?: boolean },
): Promise<{ ok: boolean; refreshed: number; skipped: number; errors: string[] }> {
  const errors: string[] = []
  let refreshed = 0
  let skipped = 0

  for (const { section, scope: cacheScope } of publicSnapshotPackageScopeItems({ allScopes: options?.allScopes })) {
    try {
      if (!options?.allScopes && (await isFreshPublicSnapshotPackage(env.CHART_CACHE_KV, section, cacheScope))) {
        skipped++
        continue
      }
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

  log.info('public_package_refresh', 'Public snapshot packages refreshed', {
    context: `refreshed=${refreshed} skipped=${skipped} errors=${errors.length}`,
  })
  return { ok: errors.length === 0, refreshed, skipped, errors }
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

  for (const section of PUBLIC_PACKAGE_SECTIONS) {
    for (const cacheScope of precomputedSnapshotScopesForSection(section)) {
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
