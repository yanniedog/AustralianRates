import { describe, expect, it } from 'vitest'
import {
  DAILY_SCHEDULE_CRON_EXPRESSION,
  INTEGRITY_AUDIT_CRON_EXPRESSION,
  SITE_HEALTH_CRON_EXPRESSION,
} from '../src/constants'
import { scheduledTasksForCron } from '../src/pipeline/scheduler-dispatch'

describe('scheduledTasksForCron', () => {
  it('routes the daily cron to the ingest pipeline', () => {
    expect(scheduledTasksForCron('')).toEqual(['daily'])
    expect(scheduledTasksForCron(DAILY_SCHEDULE_CRON_EXPRESSION)).toEqual(['daily'])
  })

  it('routes the quarter-hour cron to both coverage backfill and site health', () => {
    expect(scheduledTasksForCron(SITE_HEALTH_CRON_EXPRESSION)).toEqual(['hourly_wayback', 'site_health'])
  })

  it('routes the daily 04:00 UTC cron to integrity audit', () => {
    expect(scheduledTasksForCron(INTEGRITY_AUDIT_CRON_EXPRESSION)).toEqual(['integrity_audit'])
  })

  it('ignores unknown cron expressions', () => {
    expect(scheduledTasksForCron('0 0 * * 0')).toEqual([])
  })
})
