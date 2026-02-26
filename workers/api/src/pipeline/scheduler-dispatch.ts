import { DAILY_SCHEDULE_CRON_EXPRESSION, HOURLY_WAYBACK_CRON_EXPRESSION } from '../constants'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { handleScheduledHourlyWayback } from './hourly-wayback'
import { handleScheduledDaily } from './scheduled'

type CronEvent = ScheduledController & { cron?: string }

export async function dispatchScheduledEvent(event: ScheduledController, env: EnvBindings): Promise<unknown> {
  const cron = String((event as CronEvent).cron || '').trim()
  const scheduledIso = Number.isFinite(event.scheduledTime)
    ? new Date(event.scheduledTime).toISOString()
    : new Date().toISOString()

  log.info('scheduler', `Cron triggered`, {
    context: `scheduled_time=${scheduledIso} cron=${cron || 'unknown'}`,
  })

  if (cron === HOURLY_WAYBACK_CRON_EXPRESSION) {
    log.info('scheduler', `Dispatching hourly Wayback coverage cron (${cron})`, {
      context: `scheduled_time=${scheduledIso}`,
    })
    return handleScheduledHourlyWayback(event, env)
  }

  if (!cron || cron === DAILY_SCHEDULE_CRON_EXPRESSION) {
    log.info('scheduler', `Dispatching daily ingest cron (${cron || 'unknown'})`, {
      context: `scheduled_time=${scheduledIso}`,
    })
    return handleScheduledDaily(event, env)
  }

  log.warn('scheduler', `Skipping unknown cron expression: ${cron}`, {
    context:
      `scheduled_time=${scheduledIso}` +
      ` expected_hourly=${HOURLY_WAYBACK_CRON_EXPRESSION}` +
      ` expected_daily=${DAILY_SCHEDULE_CRON_EXPRESSION}`,
  })
  return {
    ok: true,
    skipped: true,
    reason: 'unknown_cron_expression',
    cron,
  }
}
