import { MELBOURNE_TIMEZONE } from '../constants'
import type { EnvBindings } from '../types'
import { getMelbourneNowParts } from '../utils/time'
import { log } from '../utils/logger'
import { processHistoricalQualityRunUntilSettled, startHistoricalQualityRun } from './historical-quality-runner'

export async function runScheduledHistoricalQualitySnapshot(
  env: Pick<EnvBindings, 'DB' | 'MELBOURNE_TIMEZONE'>,
  scheduledTime: number,
): Promise<{
  ok: boolean
  skipped: boolean
  reason?: string
  audit_run_id?: string
  collection_date?: string
  status?: string
  steps?: number
}> {
  const parts = getMelbourneNowParts(
    new Date(Number.isFinite(scheduledTime) ? scheduledTime : Date.now()),
    env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE,
  )
  if (parts.hour !== 23 || parts.minute !== 59) {
    return {
      ok: true,
      skipped: true,
      reason: 'not_local_end_of_day',
      collection_date: parts.date,
    }
  }
  const auditRunId = `historical-quality:scheduled:${parts.date}`
  log.info('scheduler', 'Starting scheduled historical quality daily snapshot', {
    context: JSON.stringify({
      audit_run_id: auditRunId,
      collection_date: parts.date,
      local_time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
      time_zone: parts.timeZone,
    }),
  })
  const created = await startHistoricalQualityRun(env, {
    startDate: parts.date,
    endDate: parts.date,
    triggerSource: 'scheduled',
    targetDb: 'australianrates_api',
    auditRunId,
    replaceExisting: true,
  })
  const settled = await processHistoricalQualityRunUntilSettled(env, created.auditRunId, {
    maxSteps: 256,
    maxMs: 25000,
  })
  return {
    ok: settled.status === 'completed',
    skipped: false,
    audit_run_id: created.auditRunId,
    collection_date: parts.date,
    status: settled.status,
    steps: settled.steps,
  }
}
