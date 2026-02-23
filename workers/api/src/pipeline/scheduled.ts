import { MELBOURNE_TARGET_HOUR, MELBOURNE_TIMEZONE } from '../constants'
import { triggerDailyRun } from './bootstrap-jobs'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { getMelbourneNowParts, parseIntegerEnv } from '../utils/time'

export function shouldRunScheduledAtTargetHour(hour: number, targetHour: number): boolean {
  return hour === targetHour
}

export async function handleScheduledDaily(event: ScheduledController, env: EnvBindings) {
  const timezone = env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE
  const targetHour = parseIntegerEnv(env.MELBOURNE_TARGET_HOUR, MELBOURNE_TARGET_HOUR)
  const melbourneParts = getMelbourneNowParts(new Date(event.scheduledTime), timezone)

  if (!shouldRunScheduledAtTargetHour(melbourneParts.hour, targetHour)) {
    log.info('scheduler', `Skipping: hour=${melbourneParts.hour} target=${targetHour}`)
    return {
      ok: true,
      skipped: true,
      reason: 'outside_target_hour',
      melbourne: melbourneParts,
    }
  }

  log.info('scheduler', `Triggering daily run at Melbourne hour=${melbourneParts.hour}`)
  const result = await triggerDailyRun(env, {
    source: 'scheduled',
    force: false,
  })
  log.info('scheduler', `Daily run trigger result`, { context: JSON.stringify(result) })

  return {
    ...result,
    melbourne: melbourneParts,
  }
}
