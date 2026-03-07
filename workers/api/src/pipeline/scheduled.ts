import { ensureAppConfigTable, getIngestPauseConfig, setAppConfig } from '../db/app-config'
import {
  RATE_CHECK_LAST_RUN_ISO_KEY,
} from '../constants'
import { triggerDailyRun } from './bootstrap-jobs'
import { runLifecycleReconciliation } from './run-reconciliation'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { getMelbourneNowParts } from '../utils/time'
import { buildScheduledRunId } from '../utils/idempotency'

function compactErrorSample(values: string[], max = 3): string[] {
  return values.slice(0, Math.max(1, max))
}

export async function handleScheduledDaily(event: ScheduledController, env: EnvBindings) {
  try {
    await ensureAppConfigTable(env.DB)
  } catch (error) {
    log.error('scheduler', 'Failed to ensure app_config schema', {
      code: 'app_config_unavailable',
      error,
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

  const cronIso = Number.isFinite(event.scheduledTime)
    ? new Date(event.scheduledTime).toISOString()
    : new Date().toISOString()

  let reconciliation: Awaited<ReturnType<typeof runLifecycleReconciliation>> | null = null
  try {
    reconciliation = await runLifecycleReconciliation(env.DB, {
      dryRun: false,
      idleMinutes: 5,
      staleRunMinutes: 120,
    })
    const ready = reconciliation.ready_finalizations
    const stale = reconciliation.stale_runs
    const context = JSON.stringify({
      scanned_rows: ready.scanned_rows,
      finalized_rows: ready.finalized_rows,
      skipped_rows: ready.skipped_rows,
      ready_passes: ready.pass_count ?? 1,
      ready_stop: ready.stopped_reason ?? null,
      closed_runs: stale.closed_runs,
      stale_scanned_runs: stale.scanned_runs,
      error_sample: compactErrorSample([...ready.errors, ...stale.errors]),
      duration_ms: reconciliation.duration_ms,
    })
    log.info('scheduler', 'Run lifecycle reconciliation completed', {
      context,
    })
    if (ready.scanned_rows > 0 && ready.finalized_rows === 0) {
      log.error('scheduler', 'Run lifecycle reconciliation stalled', {
        code: 'run_lifecycle_reconciliation_stalled',
        context,
      })
    }
  } catch (error) {
    log.error('scheduler', 'Run lifecycle reconciliation failed', {
      code: 'run_lifecycle_reconciliation_failed',
      error,
      context: (error as Error)?.message || String(error),
    })
  }

  const pause = await getIngestPauseConfig(env.DB)
  if (pause.mode === 'repair_pause') {
    log.warn('scheduler', 'Scheduled daily ingest paused by app config', {
      code: 'ingest_paused',
      context: JSON.stringify({
        reason: pause.reason,
        collection_date: collectionDate,
        scheduled_at: cronIso,
      }),
    })
    return {
      ok: true,
      skipped: true,
      reason: 'ingest_paused',
      pause,
      reconciliation,
      melbourne: melbourneParts,
      intervalMinutes: 0,
    }
  }

  const runIdOverride = buildScheduledRunId(collectionDate, event.scheduledTime)
  log.info('scheduler', `Triggering rate check run (collectionDate=${collectionDate}, runId=${runIdOverride})`)
  const result = await triggerDailyRun(env, {
    source: 'scheduled',
    runIdOverride,
  })
  log.info('scheduler', `Rate check run result`, { context: JSON.stringify(result) })

  const skipped = (result as { skipped?: unknown }).skipped === true

  if (result.ok && !skipped) {
    await setAppConfig(env.DB, RATE_CHECK_LAST_RUN_ISO_KEY, cronIso)
  }

  return {
    ...result,
    reconciliation,
    melbourne: melbourneParts,
    intervalMinutes: 0,
  }
}
