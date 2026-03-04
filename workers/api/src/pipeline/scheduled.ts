import { ensureAppConfigTable, setAppConfig } from '../db/app-config'
import {
  RATE_CHECK_LAST_RUN_ISO_KEY,
} from '../constants'
import { triggerDailyRun } from './bootstrap-jobs'
import { runLifecycleReconciliation } from './run-reconciliation'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { getMelbourneNowParts } from '../utils/time'
import { buildScheduledRunId } from '../utils/idempotency'

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
    log.info('scheduler', 'Run lifecycle reconciliation completed', {
      context:
        `ready_finalized=${reconciliation.ready_finalizations.finalized_rows}` +
        ` stale_closed=${reconciliation.stale_runs.closed_runs}` +
        ` duration_ms=${reconciliation.duration_ms}`,
    })
  } catch (error) {
    log.error('scheduler', 'Run lifecycle reconciliation failed', {
      code: 'run_lifecycle_reconciliation_failed',
      error,
      context: (error as Error)?.message || String(error),
    })
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
