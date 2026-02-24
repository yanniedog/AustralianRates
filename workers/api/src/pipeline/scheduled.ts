import { ensureAppConfigTable, getAppConfig, setAppConfig } from '../db/app-config'
import { triggerDailyRun } from './bootstrap-jobs'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { getMelbourneNowParts } from '../utils/time'

const RATE_CHECK_INTERVAL_KEY = 'rate_check_interval_minutes'
const RATE_CHECK_LAST_RUN_KEY = 'rate_check_last_run_iso'
const DEFAULT_INTERVAL_MINUTES = 1440

export function shouldRunScheduledAtTargetHour(hour: number, targetHour: number): boolean {
  return hour === targetHour
}

export async function handleScheduledDaily(_event: ScheduledController, env: EnvBindings) {
  try {
    await ensureAppConfigTable(env.DB)
  } catch (error) {
    log.error('scheduler', 'Failed to ensure app_config schema', {
      context: (error as Error)?.message || String(error),
    })
    return {
      ok: false,
      skipped: true,
      reason: 'app_config_unavailable',
    }
  }

  const melbourneParts = getMelbourneNowParts(new Date(), env.MELBOURNE_TIMEZONE || 'Australia/Melbourne')
  const collectionDate = melbourneParts.date
  const targetHour = Math.max(0, Math.min(23, parseInt(env.MELBOURNE_TARGET_HOUR || '6', 10) || 6))

  if (!shouldRunScheduledAtTargetHour(melbourneParts.hour, targetHour)) {
    log.info('scheduler', `Skipping: hour=${melbourneParts.hour} target=${targetHour}`)
    return {
      ok: true,
      skipped: true,
      reason: 'outside_target_hour',
      melbourne: melbourneParts,
    }
  }

  const intervalRaw = await getAppConfig(env.DB, RATE_CHECK_INTERVAL_KEY)
  const intervalMinutes = Math.max(1, parseInt(intervalRaw ?? String(DEFAULT_INTERVAL_MINUTES), 10) || DEFAULT_INTERVAL_MINUTES)

  const lastRunIso = await getAppConfig(env.DB, RATE_CHECK_LAST_RUN_KEY)
  const now = Date.now()
  const lastRunMs = lastRunIso ? new Date(lastRunIso).getTime() : 0
  const elapsedMinutes = (now - lastRunMs) / (60 * 1000)

  if (lastRunIso && elapsedMinutes < intervalMinutes) {
    log.info('scheduler', `Skipping: interval not elapsed (${Math.round(elapsedMinutes)}m < ${intervalMinutes}m)`)
    return {
      ok: true,
      skipped: true,
      reason: 'interval_not_elapsed',
      elapsedMinutes: Math.round(elapsedMinutes * 10) / 10,
      intervalMinutes,
    }
  }

  log.info('scheduler', `Triggering rate check run (interval=${intervalMinutes}m, collectionDate=${collectionDate})`)
  const result = await triggerDailyRun(env, {
    source: 'scheduled',
  })
  log.info('scheduler', `Rate check run result`, { context: JSON.stringify(result) })

  if (result.ok) {
    await setAppConfig(env.DB, RATE_CHECK_LAST_RUN_KEY, new Date().toISOString())
  }

  return {
    ...result,
    melbourne: melbourneParts,
    intervalMinutes,
  }
}
