import { getLastManualRunStartedAt, hasRunningManualRun } from '../db/run-reports'
import { triggerDailyRun } from '../pipeline/bootstrap-jobs'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { parseIntegerEnv } from '../utils/time'

type TriggerRunResult =
  | { ok: true; status: 200; body: { ok: true; result: unknown } }
  | { ok: false; status: 429; body: { ok: false; reason: string; message?: string; retry_after_seconds: number } }
  | { ok: false; status: 500; body: { ok: false; reason: string; message?: string } }

function toRetryAfterSeconds(cooldownMs: number, elapsedMs: number): number {
  const remaining = Math.max(0, cooldownMs - elapsedMs)
  return Math.max(1, Math.ceil(remaining / 1000))
}

function isQueueThrottleError(error: unknown): boolean {
  const text = String((error as Error)?.message || error || '')
  return text.includes('Queue sendBatch failed: Too Many Requests')
}

export async function handlePublicTriggerRun(env: EnvBindings, logLabel: string): Promise<TriggerRunResult> {
  const DEFAULT_COOLDOWN_SECONDS = 60
  const cooldownSeconds = parseIntegerEnv(env.MANUAL_RUN_COOLDOWN_SECONDS, DEFAULT_COOLDOWN_SECONDS)
  const cooldownMs = cooldownSeconds * 1000

  if (await hasRunningManualRun(env.DB)) {
    const MIN_POLL_RETRY_SECONDS = 5
    let retryAfter = Math.max(MIN_POLL_RETRY_SECONDS, Math.min(30, cooldownSeconds))
    if (cooldownMs > 0) {
      const lastStartedAt = await getLastManualRunStartedAt(env.DB)
      if (lastStartedAt) {
        const lastMs = new Date(lastStartedAt.endsWith('Z') ? lastStartedAt : `${lastStartedAt.trim()}Z`).getTime()
        const elapsed = Number.isNaN(lastMs) ? cooldownMs : Date.now() - lastMs
        if (elapsed >= 0 && elapsed < cooldownMs) {
          retryAfter = toRetryAfterSeconds(cooldownMs, elapsed)
        }
      }
    }
    return {
      ok: false,
      status: 429,
      body: { ok: false, reason: 'manual_run_in_progress', message: 'A check is already running.', retry_after_seconds: retryAfter },
    }
  }

  if (cooldownMs > 0) {
    const lastStartedAt = await getLastManualRunStartedAt(env.DB)
    if (lastStartedAt) {
      const lastMs = new Date(lastStartedAt.endsWith('Z') ? lastStartedAt : `${lastStartedAt.trim()}Z`).getTime()
      const elapsed = Number.isNaN(lastMs) ? cooldownMs : Date.now() - lastMs
      if (elapsed >= 0 && elapsed < cooldownMs) {
        return {
          ok: false,
          status: 429,
          body: {
            ok: false,
            reason: 'rate_limited',
            message: 'Please wait before starting another run.',
            retry_after_seconds: toRetryAfterSeconds(cooldownMs, elapsed),
          },
        }
      }
    }
  }

  log.info('api', `Public manual run triggered (${logLabel})`)
  try {
    const result = await triggerDailyRun(env, { source: 'manual', force: true })

    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        result,
      },
    }
  } catch (error) {
    if (isQueueThrottleError(error)) {
      return {
        ok: false,
        status: 429,
        body: { ok: false, reason: 'queue_throttled', message: 'Too many requests. Try again later.', retry_after_seconds: Math.max(60, cooldownSeconds) },
      }
    }
    log.error('api', `trigger_run_failed (${logLabel})`, {
      context: (error as Error)?.message || String(error),
    })
    return { ok: false, status: 500, body: { ok: false, reason: 'trigger_run_failed', message: 'Run could not be started. Please try again later.' } }
  }
}
