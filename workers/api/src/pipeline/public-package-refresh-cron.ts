import type { EnvBindings } from '../types'
import { isD1NonEssentialWorkDisabled } from '../utils/d1-budget'
import { isD1EmergencyMinimumWrites } from '../utils/d1-emergency'
import { log } from '../utils/logger'
import { refreshPublicSnapshotPackages } from './chart-cache-refresh'
import { runPostIngestAssurance } from './post-ingest-assurance'
import { runReplayQueueMaintenance } from './replay-queue'

type PublicPackageSideEffectPolicyInput = {
  emergencyMinimumWrites: boolean
  nonEssentialDisabled: boolean
}

export function publicPackageRefreshSideEffectPolicy(input: PublicPackageSideEffectPolicyInput) {
  const suppressed = input.emergencyMinimumWrites || input.nonEssentialDisabled
  return {
    suppressed,
    reason: input.emergencyMinimumWrites
      ? 'd1_emergency_minimum_writes'
      : input.nonEssentialDisabled
        ? 'd1_nonessential_disabled'
        : null,
    runReplayMaintenance: !suppressed,
    assuranceOptions: {
      persist: !suppressed,
      emitHardFailureLog: !suppressed,
    },
  }
}

export async function runPublicPackageRefreshCron(
  env: EnvBindings,
  input: { scheduledIso: string; cron: string },
) {
  const emergencyMinimumWrites = isD1EmergencyMinimumWrites(env)
  const nonEssentialDisabled = await isD1NonEssentialWorkDisabled(env)
  const policy = publicPackageRefreshSideEffectPolicy({ emergencyMinimumWrites, nonEssentialDisabled })

  log.info('scheduler', `Dispatching public package refresh cron (${input.cron})`, {
    context: `scheduled_time=${input.scheduledIso}`,
  })
  if (policy.suppressed) {
    log.warn('scheduler', 'Running public package refresh with D1 side effects suppressed', {
      code: 'd1_public_package_refresh_side_effects_suppressed',
      context: `scheduled_time=${input.scheduledIso} cron=${input.cron} reason=${policy.reason}`,
    })
  }

  const replayMaintenance = policy.runReplayMaintenance
    ? await runReplayQueueMaintenance(env, {
        limit: 25,
        source: 'public_package_refresh_cron',
      })
    : null
  const packageResult = await refreshPublicSnapshotPackages(env)
  const assurance = await runPostIngestAssurance(env, policy.assuranceOptions)

  return {
    ok: packageResult.ok && assurance.ok,
    skipped: false,
    kind: 'public_package_refresh',
    refreshed: packageResult.refreshed,
    package_skipped: packageResult.skipped,
    errors: packageResult.errors,
    replay_maintenance: replayMaintenance,
    post_ingest_assurance: assurance,
    side_effects_suppressed: policy.suppressed,
    side_effects_reason: policy.reason,
  }
}
