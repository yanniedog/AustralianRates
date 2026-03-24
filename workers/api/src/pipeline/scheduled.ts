import { ensureAppConfigTable, getIngestPauseConfig, setAppConfig } from '../db/app-config'
import {
  RATE_CHECK_LAST_RUN_ISO_KEY,
} from '../constants'
import { triggerDailyRun } from './bootstrap-jobs'
import { backfillRbaCashRatesForDateRange } from '../ingest/rba'
import { collectCpiFromRbaG1 } from '../ingest/cpi'
import { collectEconomicSeries } from '../economic/collect'
import { runCoverageGapAudit } from './coverage-gap-audit'
import { runCoverageGapRemediation } from './coverage-gap-remediation'
import { runLenderUniverseAudit } from './lender-universe-audit'
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
  let coverageAudit: Awaited<ReturnType<typeof runCoverageGapAudit>> | null = null
  let coverageRemediation: Awaited<ReturnType<typeof runCoverageGapRemediation>> | null = null
  let lenderUniverseAudit: Awaited<ReturnType<typeof runLenderUniverseAudit>> | null = null
  let economic: Awaited<ReturnType<typeof collectEconomicSeries>> | null = null
  try {
    reconciliation = await runLifecycleReconciliation(env.DB, {
      dryRun: false,
      idleMinutes: 5,
      staleRunMinutes: 90,
    })
    const ready = reconciliation.ready_finalizations
    const stale = reconciliation.stale_runs
    const staleUnfinalized = reconciliation.stale_unfinalized
    const context = JSON.stringify({
      scanned_rows: ready.scanned_rows,
      finalized_rows: ready.finalized_rows,
      skipped_rows: ready.skipped_rows,
      ready_passes: ready.pass_count ?? 1,
      ready_stop: ready.stopped_reason ?? null,
      closed_runs: stale.closed_runs,
      abandoned_eod: stale.abandoned_eod,
      stale_scanned_runs: stale.scanned_runs,
      force_closed_unfinalized: staleUnfinalized.force_closed_rows,
      stale_unfinalized_scanned: staleUnfinalized.scanned_rows,
      error_sample: compactErrorSample([
        ...ready.errors,
        ...stale.errors,
        ...staleUnfinalized.errors,
      ]),
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

  try {
    coverageAudit = await runCoverageGapAudit(env, {
      runSource: 'scheduled',
      idleMinutes: 120,
      limit: 200,
    })
  } catch (error) {
    log.error('scheduler', 'Coverage gap audit failed', {
      code: 'coverage_slo_breach',
      error,
      context: (error as Error)?.message || String(error),
    })
  }

  try {
    lenderUniverseAudit = await runLenderUniverseAudit(env)
  } catch (error) {
    log.error('scheduler', 'Lender universe audit failed', {
      code: 'lender_universe_drift',
      error,
      context: (error as Error)?.message || String(error),
    })
  }

  // RBA + CPI collection — runs regardless of ingest pause state so rate changes are never missed.
  // RBA: rolling 7-day backfill self-heals any dates that stored a stale rate.
  // CPI: full quarter upsert (idempotent) — always reflects the latest ABS release.
  try {
    const sevenDaysAgo = new Date(new Date(collectionDate).getTime() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    await backfillRbaCashRatesForDateRange(env.DB, sevenDaysAgo, collectionDate, env)
  } catch (error) {
    log.warn('scheduler', 'RBA cash rate rolling backfill failed', {
      code: 'rba_collection_failed',
      context: (error as Error)?.message || String(error),
    })
  }
  try {
    await collectCpiFromRbaG1(env.DB, env)
  } catch (error) {
    log.warn('scheduler', 'CPI collection failed', {
      code: 'cpi_collection_failed',
      context: (error as Error)?.message || String(error),
    })
  }
  try {
    economic = await collectEconomicSeries(env)
  } catch (error) {
    log.warn('scheduler', 'Economic series collection failed', {
      code: 'economic_series_fetch_failed',
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
      coverageAudit,
      economic,
      lenderUniverseAudit,
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

  if (coverageAudit && !coverageAudit.ok) {
    try {
      coverageRemediation = await runCoverageGapRemediation(env, {
        auditReport: coverageAudit,
        dailyRunResult: result,
        scopeLimit: 12,
        replayLimit: 25,
        persist: true,
      })
    } catch (error) {
      log.error('scheduler', 'Coverage gap auto-remediation failed', {
        code: 'coverage_slo_breach',
        error,
        context: (error as Error)?.message || String(error),
      })
    }
  }

  const skipped = (result as { skipped?: unknown }).skipped === true

  if (result.ok && !skipped) {
    await setAppConfig(env.DB, RATE_CHECK_LAST_RUN_ISO_KEY, cronIso)
  }

  return {
    ...result,
    reconciliation,
    coverageAudit,
    coverageRemediation,
    economic,
    lenderUniverseAudit,
    melbourne: melbourneParts,
    intervalMinutes: 0,
  }
}
