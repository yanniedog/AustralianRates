import { DAILY_SCHEDULE_CRON_EXPRESSION, SITE_HEALTH_CRON_EXPRESSION } from '../constants'
import { insertHealthCheckRun } from '../db/health-check-runs'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { handleScheduledHourlyWayback } from './hourly-wayback'
import { handleScheduledDaily } from './scheduled'
import { runSiteHealthChecks } from './site-health'

type CronEvent = ScheduledController & { cron?: string }
export type ScheduledTask = 'daily' | 'hourly_wayback' | 'site_health'

export function scheduledTasksForCron(cron: string): ScheduledTask[] {
  const normalizedCron = String(cron || '').trim()
  if (!normalizedCron || normalizedCron === DAILY_SCHEDULE_CRON_EXPRESSION) {
    return ['daily']
  }
  if (normalizedCron === SITE_HEALTH_CRON_EXPRESSION) {
    return ['hourly_wayback', 'site_health']
  }
  return []
}

async function runSiteHealthCron(env: EnvBindings) {
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
    e2eJson: JSON.stringify(result.e2e),
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

export async function dispatchScheduledEvent(event: ScheduledController, env: EnvBindings): Promise<unknown> {
  const cron = String((event as CronEvent).cron || '').trim()
  const scheduledIso = Number.isFinite(event.scheduledTime)
    ? new Date(event.scheduledTime).toISOString()
    : new Date().toISOString()

  log.info('scheduler', `Cron triggered`, {
    context: `scheduled_time=${scheduledIso} cron=${cron || 'unknown'}`,
  })

  const tasks = scheduledTasksForCron(cron)
  if (tasks.length === 1 && tasks[0] === 'daily') {
    log.info('scheduler', `Dispatching daily ingest cron (${cron || 'unknown'})`, {
      context: `scheduled_time=${scheduledIso}`,
    })
    return handleScheduledDaily(event, env)
  }

  if (tasks.includes('site_health')) {
    log.info('scheduler', `Dispatching coverage + site health cron (${cron})`, {
      context: `scheduled_time=${scheduledIso}`,
    })

    const [coverageResult, siteHealthResult] = await Promise.allSettled([
      handleScheduledHourlyWayback(event, env),
      runSiteHealthCron(env),
    ])

    if (coverageResult.status === 'rejected' || siteHealthResult.status === 'rejected') {
      const failureContext = JSON.stringify({
        scheduled_time: scheduledIso,
        cron,
        coverage_error:
          coverageResult.status === 'rejected'
            ? (coverageResult.reason as Error)?.message || String(coverageResult.reason)
            : null,
        site_health_error:
          siteHealthResult.status === 'rejected'
            ? (siteHealthResult.reason as Error)?.message || String(siteHealthResult.reason)
            : null,
      })
      log.error('scheduler', 'Coverage + site health cron dispatch failed', {
        error:
          coverageResult.status === 'rejected'
            ? coverageResult.reason
            : siteHealthResult.status === 'rejected'
              ? siteHealthResult.reason
              : undefined,
        context: failureContext,
      })
      throw new Error(`scheduled_dispatch_failed:${failureContext}`)
    }

    return {
      ok: true,
      skipped: false,
      kind: 'coverage_and_site_health',
      hourly_wayback: coverageResult.value,
      site_health: siteHealthResult.value,
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
