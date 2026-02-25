import { DAILY_SCHEDULE_CRON_EXPRESSION, HOURLY_WAYBACK_CRON_EXPRESSION } from '../constants'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { handleScheduledHourlyWayback } from './hourly-wayback'
import { handleScheduledDaily } from './scheduled'

type CronEvent = ScheduledController & { cron?: string }

export async function dispatchScheduledEvent(event: ScheduledController, env: EnvBindings): Promise<unknown> {
  const cron = String((event as CronEvent).cron || '').trim()
  if (cron === HOURLY_WAYBACK_CRON_EXPRESSION) {
    log.info('scheduler', `Dispatching hourly Wayback coverage cron (${cron})`)
    return handleScheduledHourlyWayback(event, env)
  }

  if (!cron || cron === DAILY_SCHEDULE_CRON_EXPRESSION) {
    log.info('scheduler', `Dispatching daily ingest cron (${cron || 'unknown'})`)
    return handleScheduledDaily(event, env)
  }

  log.warn('scheduler', `Skipping unknown cron expression: ${cron}`)
  return {
    ok: true,
    skipped: true,
    reason: 'unknown_cron_expression',
    cron,
  }
}
