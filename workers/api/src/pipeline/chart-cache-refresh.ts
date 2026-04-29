import { getReadDbFromEnv } from '../db/read-db'
import {
  writeD1ChartCache,
} from '../db/chart-cache'
import { resolveFiltersForScope } from '../db/scope-filters'
import { queryReportPlotPayload, refreshAllReportDeltaTables, REPORT_BANDS_SOURCE_VERSION } from '../db/report-plot'
import { writeD1ReportPlotCache } from '../db/report-plot-cache'
import { getLatestCompletedDailyRunFinishedAt } from '../db/run-reports'
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
  type PublicPackageScope,
  publicSnapshotPackageScopeItems,
  PUBLIC_PACKAGE_SECTIONS,
} from './public-package-scopes'

const REPRESENTATIONS = ['day', 'change'] as const
const PUBLIC_PACKAGE_REFRESH_FRESH_MS = 20 * 60 * 60 * 1000

/**
 * Bundle is considered fresh when:
 *  1. KV has a parseable payload with the current band_source_version, AND
 *  2. builtAt is within `PUBLIC_PACKAGE_REFRESH_FRESH_MS`, AND
 *  3. no daily run has finished after the snapshot was built (otherwise the
 *     snapshot reflects pre-ingest state and must be rebuilt to surface the
 *     new data on the public ribbon / slice-pair indicators).
 */
async function isFreshPublicSnapshotPackage(
  env: EnvBindings,
  section: (typeof PUBLIC_PACKAGE_SECTIONS)[number],
  scope: string,
): Promise<boolean> {
  const kv = env.CHART_CACHE_KV
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
    if (!Number.isFinite(builtAt) || Date.now() - builtAt >= PUBLIC_PACKAGE_REFRESH_FRESH_MS) return false
    const latestRunFinishedAt = await getLatestCompletedDailyRunFinishedAt(env.DB)
    if (latestRunFinishedAt) {
      const finishedMs = new Date(latestRunFinishedAt).getTime()
      if (Number.isFinite(finishedMs) && finishedMs > builtAt) return false
    }
    return true
  } catch {
    return false
  }
}

export async function refreshPublicSnapshotPackages(
  env: EnvBindings,
  options?: { allScopes?: boolean; force?: boolean; items?: PublicPackageScope[] },
): Promise<{ ok: boolean; refreshed: number; skipped: number; errors: string[] }> {
  const errors: string[] = []
  let refreshed = 0
  let skipped = 0

  const items = options?.items || publicSnapshotPackageScopeItems({ allScopes: options?.allScopes })
  for (const { section, scope: cacheScope } of items) {
    try {
      if (!options?.allScopes && !options?.force && (await isFreshPublicSnapshotPackage(env, section, cacheScope))) {
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
