import { DEFAULT_LOCK_TTL_SECONDS } from '../constants'
import {
  COVERAGE_DATASETS,
  addUtcDays,
  ensureDatasetCoverageRows,
  getDatasetCoverageProgressRows,
  getGlobalDatasetFirstCoverageDates,
  setDatasetCoverageState,
  type CoverageDataset,
  type CoverageStatus,
} from '../db/dataset-coverage'
import { acquireRunLock, releaseRunLock } from '../durable/run-lock'
import { startHistoricalPullRun } from './client-historical'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { parseIntegerEnv } from '../utils/time'

const COVERAGE_LOWER_BOUND_DATE = '1996-01-01'

function hourlyBucketFromScheduledTime(scheduledTime: number): string {
  const iso = Number.isFinite(scheduledTime) ? new Date(scheduledTime).toISOString() : new Date().toISOString()
  return iso.slice(0, 13)
}

function resolveCursorDate(firstCoverageDate: string, existingCursorDate: string | null): string {
  const recommendedCursor = addUtcDays(firstCoverageDate, -1)
  if (!existingCursorDate) return recommendedCursor
  return existingCursorDate < recommendedCursor ? existingCursorDate : recommendedCursor
}

function statusForCursor(cursorDate: string): CoverageStatus {
  return cursorDate < COVERAGE_LOWER_BOUND_DATE ? 'completed_lower_bound' : 'active'
}

export async function handleScheduledHourlyWayback(event: ScheduledController, env: EnvBindings) {
  const bucket = hourlyBucketFromScheduledTime(event.scheduledTime)
  const owner = `hourly-wayback:${bucket}:${crypto.randomUUID().slice(0, 8)}`
  const lockKey = `hourly-wayback:${bucket}`
  const lockTtlSeconds = parseIntegerEnv(env.LOCK_TTL_SECONDS, DEFAULT_LOCK_TTL_SECONDS)

  const lock = await acquireRunLock(env, {
    key: lockKey,
    owner,
    ttlSeconds: lockTtlSeconds,
  })
  if (!lock.ok) {
    return {
      ok: false,
      skipped: true,
      reason: lock.reason || 'hourly_lock_failed',
      lockKey,
    }
  }
  if (!lock.acquired) {
    log.info('scheduler', `Hourly Wayback tick skipped due to lock (${lockKey})`)
    return {
      ok: true,
      skipped: true,
      reason: 'hourly_wayback_locked',
      lockKey,
    }
  }

  try {
    await ensureDatasetCoverageRows(env.DB)
    const [firstCoverageByDataset, rows] = await Promise.all([
      getGlobalDatasetFirstCoverageDates(env.DB),
      getDatasetCoverageProgressRows(env.DB),
    ])
    const rowMap = new Map(rows.map((row) => [row.dataset_key, row]))
    const datasetResults: Array<Record<string, unknown>> = []

    for (const dataset of COVERAGE_DATASETS) {
      const firstCoverageDate = firstCoverageByDataset[dataset]
      const row = rowMap.get(dataset)
      const existingCursor = row?.cursor_date ?? null

      if (!firstCoverageDate) {
        await setDatasetCoverageState(env.DB, {
          dataset,
          firstCoverageDate: null,
          cursorDate: existingCursor,
          status: 'pending',
          lastTickStatus: 'waiting_first_coverage',
          lastTickMessage: 'No coverage found yet for this dataset.',
        })
        log.info('scheduler', `Hourly Wayback waiting for first coverage date (${dataset})`)
        datasetResults.push({
          dataset,
          status: 'pending',
          reason: 'waiting_first_coverage',
        })
        continue
      }

      const cursorDate = resolveCursorDate(firstCoverageDate, existingCursor)
      if (cursorDate < COVERAGE_LOWER_BOUND_DATE) {
        await setDatasetCoverageState(env.DB, {
          dataset,
          firstCoverageDate,
          cursorDate,
          status: 'completed_lower_bound',
          lastTickStatus: 'completed_lower_bound',
          lastTickMessage: `Lower bound ${COVERAGE_LOWER_BOUND_DATE} reached.`,
        })
        log.info('scheduler', `Hourly Wayback completed at lower bound (${dataset})`, {
          context: `cursor=${cursorDate} lower_bound=${COVERAGE_LOWER_BOUND_DATE}`,
        })
        datasetResults.push({
          dataset,
          status: 'completed_lower_bound',
          cursor_date: cursorDate,
        })
        continue
      }

      const created = await startHistoricalPullRun(env, {
        triggerSource: 'admin',
        requestedBy: `scheduler_hourly_wayback:${dataset}`,
        startDate: cursorDate,
        endDate: cursorDate,
        runSource: 'scheduled',
        productScope: dataset,
      })

      if (!created.ok) {
        await setDatasetCoverageState(env.DB, {
          dataset,
          firstCoverageDate,
          cursorDate,
          status: 'active',
          lastTickStatus: 'enqueue_failed',
          lastTickMessage: `${created.code}: ${created.message}`,
        })
        log.error('scheduler', `Hourly Wayback enqueue failed (${dataset})`, {
          context: `${created.code}: ${created.message}`,
        })
        datasetResults.push({
          dataset,
          status: 'failed',
          code: created.code,
          message: created.message,
        })
        continue
      }

      const nextCursor = addUtcDays(cursorDate, -1)
      const nextStatus = statusForCursor(nextCursor)
      await setDatasetCoverageState(env.DB, {
        dataset,
        firstCoverageDate,
        cursorDate: nextCursor,
        status: nextStatus,
        lastTickStatus: 'enqueued',
        lastTickRunId: created.value.run_id,
        lastTickMessage: `Queued ${created.value.tasks_queued} tasks for ${cursorDate}.`,
      })
      log.info('scheduler', `Hourly Wayback enqueued dataset run`, {
        context: `dataset=${dataset} date=${cursorDate} run=${created.value.run_id} tasks=${created.value.tasks_queued} next_cursor=${nextCursor}`,
      })
      datasetResults.push({
        dataset,
        status: nextStatus,
        run_id: created.value.run_id,
        queued_for_date: cursorDate,
        tasks_queued: created.value.tasks_queued,
        next_cursor_date: nextCursor,
      })
    }

    return {
      ok: true,
      skipped: false,
      tick_type: 'hourly_wayback_coverage',
      lower_bound_date: COVERAGE_LOWER_BOUND_DATE,
      hour_bucket: bucket,
      datasets: datasetResults,
    }
  } finally {
    await releaseRunLock(env, { key: lockKey, owner })
  }
}
