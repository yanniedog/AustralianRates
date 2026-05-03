import {
  MELBOURNE_PUBLIC_CACHE_REFRESH_HOUR,
  MELBOURNE_PUBLIC_CACHE_REFRESH_MINUTE,
  MELBOURNE_TIMEZONE,
} from '../constants'
import type { EnvBindings } from '../types'
import { isD1NonEssentialWorkDisabled } from '../utils/d1-budget'
import { isD1EmergencyMinimumWrites } from '../utils/d1-emergency'
import { log } from '../utils/logger'
import { getMelbourneNowParts, parseIntegerEnv } from '../utils/time'
import { refreshChartPivotCache } from './chart-cache-refresh'
import { runPostIngestAssurance } from './post-ingest-assurance'
import { runReplayQueueMaintenance } from './replay-queue'

type PublicPackageSideEffectPolicyInput = {
  emergencyMinimumWrites: boolean
  nonEssentialDisabled: boolean
}

export function publicPackageRefreshSideEffectPolicy(input: PublicPackageSideEffectPolicyInput) {
  const ancillarySuppressed = input.emergencyMinimumWrites || input.nonEssentialDisabled
  return {
    ancillarySuppressed,
    reason: input.emergencyMinimumWrites
      ? 'd1_emergency_minimum_writes'
      : input.nonEssentialDisabled
        ? 'd1_nonessential_disabled'
        : null,
    runReplayMaintenance: !ancillarySuppressed,
    assuranceOptions: {
      persist: !ancillarySuppressed,
      emitHardFailureLog: !ancillarySuppressed,
    },
  }
}

const CACHE_REFRESH_CRON_TOLERANCE_MINUTES = 5

function scheduledMelbourneCacheRefreshTime(env: EnvBindings): { hour: number; minute: number } {
  return {
    hour: Math.max(
      0,
      Math.min(23, parseIntegerEnv(env.MELBOURNE_PUBLIC_CACHE_REFRESH_HOUR, MELBOURNE_PUBLIC_CACHE_REFRESH_HOUR)),
    ),
    minute: Math.max(
      0,
      Math.min(59, parseIntegerEnv(env.MELBOURNE_PUBLIC_CACHE_REFRESH_MINUTE, MELBOURNE_PUBLIC_CACHE_REFRESH_MINUTE)),
    ),
  }
}

function isWithinCacheRefreshWindow(
  melbourne: { hour: number; minute: number },
  target: { hour: number; minute: number },
): boolean {
  const melbourneTotalMinutes = melbourne.hour * 60 + melbourne.minute
  const targetTotalMinutes = target.hour * 60 + target.minute
  return (
    melbourneTotalMinutes >= targetTotalMinutes &&
    melbourneTotalMinutes <= targetTotalMinutes + CACHE_REFRESH_CRON_TOLERANCE_MINUTES
  )
}

export async function runPublicPackageRefreshCron(
  env: EnvBindings,
  input: { scheduledIso: string; cron: string },
) {
  const scheduledDate = new Date(input.scheduledIso)
  const melbourne = getMelbourneNowParts(
    Number.isFinite(scheduledDate.getTime()) ? scheduledDate : new Date(),
    env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE,
  )
  const target = scheduledMelbourneCacheRefreshTime(env)
  if (!isWithinCacheRefreshWindow(melbourne, target)) {
    return {
      ok: true,
      skipped: true,
      kind: 'public_package_refresh',
      reason: 'not_melbourne_cache_refresh_time',
      melbourne,
      target,
    }
  }

  const emergencyMinimumWrites = isD1EmergencyMinimumWrites(env)
  const nonEssentialDisabled = await isD1NonEssentialWorkDisabled(env)
  const policy = publicPackageRefreshSideEffectPolicy({ emergencyMinimumWrites, nonEssentialDisabled })

  log.info('scheduler', `Dispatching public package refresh cron (${input.cron})`, {
    context: `scheduled_time=${input.scheduledIso} melbourne=${melbourne.date}T${String(melbourne.hour).padStart(2, '0')}:${String(melbourne.minute).padStart(2, '0')}`,
  })
  if (policy.ancillarySuppressed) {
    log.warn('scheduler', 'Running public cache refresh with ancillary D1 side effects suppressed', {
      code: 'd1_public_package_refresh_ancillary_side_effects_suppressed',
      context: `scheduled_time=${input.scheduledIso} cron=${input.cron} reason=${policy.reason}`,
    })
  }

  const replayMaintenance = policy.runReplayMaintenance
    ? await runReplayQueueMaintenance(env, {
        limit: 25,
        source: 'public_package_refresh_cron',
      })
    : null
  const cacheResult = await refreshChartPivotCache(env)
  const assurance = await runPostIngestAssurance(env, policy.assuranceOptions)

  return {
    ok: cacheResult.ok && assurance.ok,
    skipped: false,
    kind: 'public_package_refresh',
    refreshed: cacheResult.refreshed,
    package_skipped: 0,
    errors: cacheResult.errors,
    replay_maintenance: replayMaintenance,
    post_ingest_assurance: assurance,
    ancillary_side_effects_suppressed: policy.ancillarySuppressed,
    side_effects_reason: policy.reason,
  }
}
