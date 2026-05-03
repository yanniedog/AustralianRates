import {
  MELBOURNE_PUBLIC_CACHE_REFRESH_HOUR,
  MELBOURNE_PUBLIC_CACHE_REFRESH_MINUTE,
  MELBOURNE_TIMEZONE,
} from '../constants'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { getMelbourneNowParts, parseIntegerEnv } from '../utils/time'
import { refreshChartPivotCache } from './chart-cache-refresh'

function targetCacheRefreshTotalMinutes(env: EnvBindings): number {
  const hour = Math.max(
    0,
    Math.min(23, parseIntegerEnv(env.MELBOURNE_PUBLIC_CACHE_REFRESH_HOUR, MELBOURNE_PUBLIC_CACHE_REFRESH_HOUR)),
  )
  const minute = Math.max(
    0,
    Math.min(59, parseIntegerEnv(env.MELBOURNE_PUBLIC_CACHE_REFRESH_MINUTE, MELBOURNE_PUBLIC_CACHE_REFRESH_MINUTE)),
  )
  return hour * 60 + minute
}

function isAfterScheduledCacheRefreshWindow(env: EnvBindings, now = new Date()): boolean {
  const melbourne = getMelbourneNowParts(now, env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE)
  return melbourne.hour * 60 + melbourne.minute >= targetCacheRefreshTotalMinutes(env)
}

/**
 * Queue-consumer post-run hook retained for observability. Public cache rebuilds
 * are deferred to the Melbourne 03:01 scheduled cache refresh so a completed
 * daily ingest produces one coherent chart/report/snapshot cache pass.
 */
export async function triggerPostRunPackageRefresh(env: EnvBindings, runIds: Iterable<string>): Promise<void> {
  let triggeredRuns = 0
  for (const id of runIds) {
    if (typeof id === 'string' && id.length > 0) triggeredRuns++
  }
  if (triggeredRuns === 0) return
  if (isAfterScheduledCacheRefreshWindow(env)) {
    try {
      const result = await refreshChartPivotCache(env)
      log.info('post_run_refresh', 'public cache refreshed after late run finalisation', {
        context: `triggered_runs=${triggeredRuns} refreshed=${result.refreshed} errors=${result.errors.length}`,
      })
    } catch (error) {
      log.warn('post_run_refresh', 'public cache refresh after late run finalisation failed', {
        code: 'post_run_refresh_failed',
        error,
        context: `triggered_runs=${triggeredRuns}`,
      })
    }
    return
  }
  log.info('post_run_refresh', 'public cache refresh deferred to scheduled daily cache cron', {
    context: `triggered_runs=${triggeredRuns}`,
  })
}
