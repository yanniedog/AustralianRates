import { ensureAppConfigTable, getAppConfig, setAppConfig } from '../db/app-config'
import {
  DEFAULT_RATE_CHECK_INTERVAL_MINUTES,
  MIN_RATE_CHECK_INTERVAL_MINUTES,
  RATE_CHECK_INTERVAL_MINUTES_KEY,
  RATE_CHECK_LAST_RUN_ISO_KEY,
} from '../constants'
import { runAutoBackfillTick } from './auto-backfill'
import { triggerDailyRun } from './bootstrap-jobs'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { getMelbourneNowParts } from '../utils/time'
import { buildScheduledRunId } from '../utils/idempotency'

/** Minimum minutes between scheduled runs; cron fires every hour. */
const SCHEDULED_INTERVAL_MIN_MINUTES = MIN_RATE_CHECK_INTERVAL_MINUTES

export async function handleScheduledDaily(event: ScheduledController, env: EnvBindings) {
  try {
    await ensureAppConfigTable(env.DB)
  } catch (error) {
    log.error('scheduler', 'Failed to ensure app_config schema', {
      context: (error as Error)?.message || String(error),
    })
    return {
      ok: false,
      skipped: true,
      reason: 'app_config_unavailable',
    }
  }

  const melbourneParts = getMelbourneNowParts(new Date(), env.MELBOURNE_TIMEZONE || 'Australia/Melbourne')
  const collectionDate = melbourneParts.date

  const intervalRaw = await getAppConfig(env.DB, RATE_CHECK_INTERVAL_MINUTES_KEY)
  const configuredMinutes = Math.max(
    1,
    parseInt(intervalRaw ?? String(DEFAULT_RATE_CHECK_INTERVAL_MINUTES), 10) || DEFAULT_RATE_CHECK_INTERVAL_MINUTES,
  )
  const intervalMinutes = Math.max(SCHEDULED_INTERVAL_MIN_MINUTES, configuredMinutes)

  const lastRunIso = await getAppConfig(env.DB, RATE_CHECK_LAST_RUN_ISO_KEY)
  const cronIso = Number.isFinite(event.scheduledTime)
    ? new Date(event.scheduledTime).toISOString()
    : new Date().toISOString()
  const cronMs = new Date(cronIso).getTime()
  const lastRunMs = lastRunIso ? new Date(lastRunIso).getTime() : 0
  const elapsedMinutes = (cronMs - lastRunMs) / (60 * 1000)

  if (lastRunIso && elapsedMinutes < intervalMinutes) {
    log.info('scheduler', `Skipping: interval not elapsed (${Math.round(elapsedMinutes)}m < ${intervalMinutes}m)`)
    return {
      ok: true,
      skipped: true,
      reason: 'interval_not_elapsed',
      elapsedMinutes: Math.round(elapsedMinutes * 10) / 10,
      intervalMinutes,
    }
  }

  const runIdOverride = buildScheduledRunId(collectionDate, event.scheduledTime)
  log.info('scheduler', `Triggering rate check run (interval=${intervalMinutes}m, collectionDate=${collectionDate}, runId=${runIdOverride})`)
  const result = await triggerDailyRun(env, {
    source: 'scheduled',
    runIdOverride,
  })
  log.info('scheduler', `Rate check run result`, { context: JSON.stringify(result) })

  const skipped = (result as { skipped?: unknown }).skipped === true

  let autoBackfill: { ok: boolean; enqueued: number; cap: number; considered: number } | null = null
  const runId = (result as { runId?: unknown }).runId
  const runCollectionDate = (result as { collectionDate?: unknown }).collectionDate
  if (result.ok && typeof runId === 'string' && typeof runCollectionDate === 'string') {
    try {
      autoBackfill = await runAutoBackfillTick(env, {
        runId,
        collectionDate: runCollectionDate,
        runSource: 'scheduled',
      })
    } catch (error) {
      log.error('scheduler', 'Auto backfill tick failed', {
        context: (error as Error)?.message || String(error),
      })
    }
  }

  if (result.ok && !skipped) {
    await setAppConfig(env.DB, RATE_CHECK_LAST_RUN_ISO_KEY, cronIso)
  }

  return {
    ...result,
    auto_backfill: autoBackfill,
    melbourne: melbourneParts,
    intervalMinutes,
  }
}
