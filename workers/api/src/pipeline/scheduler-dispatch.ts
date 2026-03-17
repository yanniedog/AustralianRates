import {
  DAILY_SCHEDULE_CRON_EXPRESSION,
  INTEGRITY_AUDIT_CRON_EXPRESSION,
  MONTHLY_EXPORT_CRON_EXPRESSION,
  SITE_HEALTH_CRON_EXPRESSION,
} from '../constants'
import { runDataIntegrityAudit } from '../db/data-integrity-audit'
import { insertIntegrityAuditRun } from '../db/integrity-audit-runs'
import { insertHealthCheckRun } from '../db/health-check-runs'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { handleScheduledHourlyWayback } from './hourly-wayback'
import { triggerMonthlyExport } from './monthly-export'
import { dispatchReplayQueue } from './replay-queue'
import { handleScheduledDaily } from './scheduled'
import { runSiteHealthChecks } from './site-health'

type CronEvent = ScheduledController & { cron?: string }
export type ScheduledTask = 'daily' | 'hourly_wayback' | 'site_health' | 'monthly_export' | 'integrity_audit'

export function scheduledTasksForCron(cron: string): ScheduledTask[] {
  const normalizedCron = String(cron || '').trim()
  if (!normalizedCron || normalizedCron === DAILY_SCHEDULE_CRON_EXPRESSION) {
    return ['daily']
  }
  if (normalizedCron === SITE_HEALTH_CRON_EXPRESSION) {
    return ['hourly_wayback', 'site_health']
  }
  if (normalizedCron === MONTHLY_EXPORT_CRON_EXPRESSION) {
    return ['monthly_export']
  }
  if (normalizedCron === INTEGRITY_AUDIT_CRON_EXPRESSION) {
    return ['integrity_audit']
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

  const replayDispatch = await dispatchReplayQueue(env, { limit: 50 }).catch((error) => {
    log.error('scheduler', 'Replay queue dispatch failed', {
      code: 'replay_queue_dispatch_failed',
      error,
      context: `scheduled_time=${scheduledIso} cron=${cron || 'unknown'}`,
    })
    return null
  })

  const tasks = scheduledTasksForCron(cron)
  if (tasks.length === 1 && tasks[0] === 'daily') {
    log.info('scheduler', `Dispatching daily ingest cron (${cron || 'unknown'})`, {
      context: `scheduled_time=${scheduledIso}`,
    })
    const result = await handleScheduledDaily(event, env)
    return {
      replay_dispatch: replayDispatch,
      ...result,
    }
  }

  if (tasks.length === 1 && tasks[0] === 'monthly_export') {
    log.info('scheduler', `Dispatching monthly export cron (${cron})`, {
      context: `scheduled_time=${scheduledIso}`,
    })
    const monthlyResult = await triggerMonthlyExport(env, event.scheduledTime)
    return {
      replay_dispatch: replayDispatch,
      ok: monthlyResult.ok,
      skipped: monthlyResult.skipped,
      kind: 'monthly_export',
      reason: monthlyResult.reason,
      job_id: monthlyResult.job_id,
      month_iso: monthlyResult.month_iso,
    }
  }

  if (tasks.length === 1 && tasks[0] === 'integrity_audit') {
    log.info('scheduler', `Dispatching data integrity audit cron (${cron})`, {
      context: `scheduled_time=${scheduledIso}`,
    })
    const timezone = env.MELBOURNE_TIMEZONE || 'Australia/Melbourne'
    const result = await runDataIntegrityAudit(env.DB, timezone)
    const runId = `integrity:${result.status}:${result.checked_at}:${crypto.randomUUID()}`
    await insertIntegrityAuditRun(env.DB, {
      runId,
      checkedAt: result.checked_at,
      triggerSource: 'scheduled',
      overallOk: result.ok,
      durationMs: result.duration_ms,
      status: result.status,
      summaryJson: JSON.stringify(result.summary),
      findingsJson: JSON.stringify(result.findings),
    })
    return {
      replay_dispatch: replayDispatch,
      ok: true,
      skipped: false,
      kind: 'integrity_audit',
      run_id: runId,
      status: result.status,
      failed_count: result.summary.failed,
    }
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
      replay_dispatch: replayDispatch,
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
    replay_dispatch: replayDispatch,
  }
}
