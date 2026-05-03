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
import { getMelbourneNowParts } from '../utils/time'
import { log } from '../utils/logger'
import { PUBLIC_CACHE_DATASETS } from './public-cache-datasets'
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
 *
 * `latestRunFinishedMs` is hoisted by the caller so a single D1 read covers
 * every (section, scope) pair in the refresh sweep.
 */
async function isFreshPublicSnapshotPackage(
  env: EnvBindings,
  section: (typeof PUBLIC_PACKAGE_SECTIONS)[number],
  scope: string,
  latestRunFinishedMs: number | null,
): Promise<boolean> {
  const kv = env.CHART_CACHE_KV
  if (!kv) return false
  const raw = await kv.get(buildSnapshotKvKey(section, scope as Parameters<typeof buildSnapshotKvKey>[1]))
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as {
      builtAt?: string
      data?: {
        reportPlotBands?: { meta?: { band_source_version?: number } }
        filtersResolved?: { endDate?: string }
      }
    }
    if (parsed.data?.reportPlotBands?.meta?.band_source_version !== REPORT_BANDS_SOURCE_VERSION) return false
    const builtAt = new Date(String(parsed.builtAt || '')).getTime()
    if (!Number.isFinite(builtAt) || Date.now() - builtAt >= PUBLIC_PACKAGE_REFRESH_FRESH_MS) return false
    if (latestRunFinishedMs != null && latestRunFinishedMs > builtAt) return false
    // Reject snapshots whose endDate is more than one Melbourne day old. Allow
    // previous-day endDate for early-morning hours (after Melbourne midnight but
    // before today's data is ingested) to avoid cron rebuilding every cycle.
    const endDate = parsed.data?.filtersResolved?.endDate
    if (endDate) {
      const melbourneToday = getMelbourneNowParts().date
      const melbourneYesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(
        new Date(Date.now() - 86400000),
      )
      if (endDate !== melbourneToday && endDate !== melbourneYesterday) return false
    }
    return true
  } catch {
    return false
  }
}

async function resolveLatestRunFinishedAt(env: EnvBindings): Promise<string | null> {
  try {
    return await getLatestCompletedDailyRunFinishedAt(env.DB)
  } catch {
    return null
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
  // Hoist the run-finalisation cutoff so freshness check stays O(1) D1 reads
  // regardless of how many (section, scope) pairs we iterate.
  const skipFreshnessCheck = options?.allScopes || options?.force
  const latestRunFinishedAt = await resolveLatestRunFinishedAt(env)
  const latestRunFinishedMs = skipFreshnessCheck
    ? null
    : latestRunFinishedAt
      ? new Date(latestRunFinishedAt).getTime()
      : null
  const overallStartedAt = Date.now()
  for (const { section, scope: cacheScope } of items) {
    const itemStartedAt = Date.now()
    try {
      if (!skipFreshnessCheck && (await isFreshPublicSnapshotPackage(env, section, cacheScope, latestRunFinishedMs))) {
        skipped++
        continue
      }
      const snapshot = await buildSnapshotPayload(env, section, cacheScope, { sourceRunFinishedAt: latestRunFinishedAt })
      await writeSnapshotKvBundles(env.CHART_CACHE_KV, section, cacheScope, snapshot)
      refreshed++
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e)
      errors.push(`${section}:snapshot:${cacheScope}: ${msg}`)
      log.warn('public_package_refresh', `Failed to refresh ${section} snapshot ${cacheScope}`, {
        code: 'public_package_refresh_failed',
        context: `${msg} elapsed_ms=${Date.now() - itemStartedAt}`,
      })
    }
  }

  log.warn('public_package_refresh', 'Public snapshot packages refreshed', {
    code: 'public_package_refresh_completed',
    context: `refreshed=${refreshed} skipped=${skipped} errors=${errors.length} elapsed_ms=${Date.now() - overallStartedAt}`,
  })
  return { ok: errors.length === 0, refreshed, skipped, errors }
}

/** Refresh scoped chart/report/snapshot caches for all public sections and representations. */
export async function refreshChartPivotCache(env: EnvBindings): Promise<{ ok: boolean; refreshed: number; errors: string[] }> {
  const db = env.DB
  const rd = getReadDbFromEnv(env)
  const dbs = { canonicalDb: rd, analyticsDb: rd }
  const errors: string[] = []
  let refreshed = 0
  const sourceRunFinishedAt = await resolveLatestRunFinishedAt(env)

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

  for (const dataset of PUBLIC_CACHE_DATASETS) {
    const section = dataset.section
    for (const cacheScope of precomputedSnapshotScopesForSection(section)) {
      const filters = await resolveFiltersForScope(rd, section, cacheScope)
      for (const rep of REPRESENTATIONS) {
        try {
          const result = await dataset.collectAnalyticsRows(dbs, rep, {
            ...filters,
            disableRowCap: true,
            chartInternalRefresh: true,
          })
          await writeD1ChartCache(db, section, rep, cacheScope, result, {
            filtersResolved: { startDate: filters.startDate, endDate: filters.endDate },
            sourceRunFinishedAt,
          })
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
          await writeD1ReportPlotCache(db, section, mode, cacheScope, payload, { sourceRunFinishedAt })
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
        const snapshot = await buildSnapshotPayload(env, section, cacheScope, { sourceRunFinishedAt })
        await writeD1SnapshotCache(db, section, cacheScope, snapshot, { sourceRunFinishedAt })
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
