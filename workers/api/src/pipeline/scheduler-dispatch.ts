import { DAILY_SCHEDULE_CRON_EXPRESSION, SITE_HEALTH_CRON_EXPRESSION } from '../constants'
import { insertHealthCheckRun } from '../db/health-check-runs'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { handleScheduledDaily } from './scheduled'
import { runSiteHealthChecks } from './site-health'

type CronEvent = ScheduledController & { cron?: string }

export async function dispatchScheduledEvent(event: ScheduledController, env: EnvBindings): Promise<unknown> {
  const cron = String((event as CronEvent).cron || '').trim()
  const scheduledIso = Number.isFinite(event.scheduledTime)
    ? new Date(event.scheduledTime).toISOString()
    : new Date().toISOString()

  log.info('scheduler', `Cron triggered`, {
    context: `scheduled_time=${scheduledIso} cron=${cron || 'unknown'}`,
  })

  if (!cron || cron === DAILY_SCHEDULE_CRON_EXPRESSION) {
    log.info('scheduler', `Dispatching daily ingest cron (${cron || 'unknown'})`, {
      context: `scheduled_time=${scheduledIso}`,
    })
    return handleScheduledDaily(event, env)
  }

  if (cron === SITE_HEALTH_CRON_EXPRESSION) {
    log.info('scheduler', `Dispatching site health cron (${cron})`, {
      context: `scheduled_time=${scheduledIso}`,
    })
    const origin = 'https://www.australianrates.com'
    const result = await runSiteHealthChecks(env, {
      triggerSource: 'scheduled',
      origin,
    })
    await insertHealthCheckRun(env.DB, {
      runId: result.runId,
      checkedAt: result.checkedAt,
      triggerSource: 'scheduled',
      overallOk: result.overallOk,
      durationMs: result.durationMs,
      componentsJson: JSON.stringify(result.components),
      integrityJson: JSON.stringify(result.integrity),
      e2eAligned: result.e2e.aligned,
      e2eReasonCode: result.e2e.reasonCode,
      e2eReasonDetail: result.e2e.reasonDetail ?? null,
      actionableJson: JSON.stringify(result.actionableIssues),
      failuresJson: JSON.stringify(result.failures),
    })
    return {
      ok: true,
      skipped: false,
      kind: 'site_health',
      run_id: result.runId,
      overall_ok: result.overallOk,
      failures: result.failures.length,
    }
  }

  log.warn('scheduler', `Skipping unknown cron expression: ${cron}`, {
    code: 'unknown_cron_expression',
    context: `scheduled_time=${scheduledIso} expected_daily=${DAILY_SCHEDULE_CRON_EXPRESSION}`,
  })
  return {
    ok: true,
    skipped: true,
    reason: 'unknown_cron_expression',
    cron,
  }
}
