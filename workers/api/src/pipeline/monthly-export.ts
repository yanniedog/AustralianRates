import {
  claimAdminDownloadJobProcessing,
  createAdminDownloadJob,
  getAdminDownloadJob,
} from '../db/admin-download-jobs'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { runAdminDownloadJob } from '../routes/admin-download-builder'

/**
 * Returns true when the given timestamp is on the last calendar day of its month (UTC).
 * Used so the 23:59 daily cron only runs the monthly export once per month.
 */
export function isLastDayOfMonthUtc(scheduledTime: number): boolean {
  if (!Number.isFinite(scheduledTime)) return false
  const d = new Date(scheduledTime)
  const tomorrow = new Date(d)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return tomorrow.getUTCDate() === 1
}

/**
 * Returns YYYY-MM for the month containing the given timestamp (UTC).
 */
export function monthIsoFromUtc(scheduledTime: number): string {
  const d = new Date(scheduledTime)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}

/**
 * Creates and runs a monthly database dump job when invoked on the last day of the month.
 * The dump contains schema plus data filtered by that month (time-series tables) or full table
 * (dimension tables), with INSERT OR REPLACE so a batch of monthly backups can reconstruct the DB.
 */
export async function triggerMonthlyExport(
  env: EnvBindings,
  scheduledTime: number,
): Promise<{ ok: boolean; skipped: boolean; reason?: string; job_id?: string; month_iso?: string }> {
  if (!isLastDayOfMonthUtc(scheduledTime)) {
    return { ok: true, skipped: true, reason: 'not_last_day_of_month' }
  }

  const monthIso = monthIsoFromUtc(scheduledTime)
  const jobId = crypto.randomUUID()

  await createAdminDownloadJob(env.DB, {
    jobId,
    stream: 'operational',
    scope: 'all',
    mode: 'snapshot',
    format: 'jsonl_gzip',
    sinceCursor: null,
    includePayloadBodies: false,
    exportKind: 'monthly',
    monthIso,
  })

  const job = await getAdminDownloadJob(env.DB, jobId)
  if (!job) {
    log.error('monthly_export', 'Monthly export job not found after create', {
      context: JSON.stringify({ job_id: jobId, month_iso: monthIso }),
    })
    return { ok: false, skipped: false, reason: 'job_not_found', job_id: jobId, month_iso: monthIso }
  }

  const claimed = await claimAdminDownloadJobProcessing(env.DB, jobId)
  if (!claimed) {
    log.error('monthly_export', 'Could not claim monthly export job', {
      context: JSON.stringify({ job_id: jobId, month_iso: monthIso }),
    })
    return { ok: false, skipped: false, reason: 'claim_failed', job_id: jobId, month_iso: monthIso }
  }

  const claimedJob = await getAdminDownloadJob(env.DB, jobId)
  if (!claimedJob) {
    return { ok: false, skipped: false, reason: 'job_not_found_after_claim', job_id: jobId, month_iso: monthIso }
  }

  log.info('monthly_export', 'Running monthly dump', {
    context: JSON.stringify({ job_id: jobId, month_iso: monthIso }),
  })

  await runAdminDownloadJob(env, claimedJob)

  const completed = await getAdminDownloadJob(env.DB, jobId)
  const status = completed?.status ?? 'unknown'
  if (status !== 'completed') {
    log.error('monthly_export', 'Monthly export job did not complete', {
      context: JSON.stringify({
        job_id: jobId,
        month_iso: monthIso,
        status,
        error_message: completed?.error_message ?? null,
      }),
    })
    return {
      ok: false,
      skipped: false,
      reason: `status_${status}`,
      job_id: jobId,
      month_iso: monthIso,
    }
  }

  log.info('monthly_export', 'Monthly dump completed', {
    context: JSON.stringify({ job_id: jobId, month_iso: monthIso }),
  })
  return {
    ok: true,
    skipped: false,
    job_id: jobId,
    month_iso: monthIso,
  }
}
