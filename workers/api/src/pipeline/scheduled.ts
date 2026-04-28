import { ensureAppConfigTable, getIngestPauseConfig, setAppConfig } from '../db/app-config'
import {
  MELBOURNE_TARGET_HOUR,
  RATE_CHECK_LAST_RUN_ISO_KEY,
} from '../constants'
import { triggerDailyRun } from './bootstrap-jobs'
import { collectEconomicSeries } from '../economic/collect'
import { runCoverageGapAudit } from './coverage-gap-audit'
import { runCoverageGapRemediation } from './coverage-gap-remediation'
import { runLenderUniverseAudit } from './lender-universe-audit'
import { runProductClassificationAudit } from './product-classification-audit'
import { runLifecycleReconciliation } from './run-reconciliation'
import { runPostIngestAssurance } from './post-ingest-assurance'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { getMelbourneNowParts, parseIntegerEnv } from '../utils/time'
import { buildScheduledRunId } from '../utils/idempotency'

function compactErrorSample(values: string[], max = 3): string[] {
  return values.slice(0, Math.max(1, max))
}

function isEnabled(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function melbourneDailyIngestHours(env: EnvBindings): number[] {
  const raw = env.MELBOURNE_DAILY_INGEST_HOURS?.trim()
  if (raw) {
    const parts: number[] = []
    for (const token of raw.split(',')) {
      const n = parseInt(token.trim(), 10)
      if (Number.isFinite(n)) parts.push(Math.max(0, Math.min(23, n)))
    }
    const uniq = [...new Set(parts)].sort((a, b) => a - b)
    if (uniq.length > 0) return uniq
  }
  return [Math.max(0, Math.min(23, parseIntegerEnv(env.MELBOURNE_TARGET_HOUR, MELBOURNE_TARGET_HOUR)))]
}

async function runOptionalScheduledPrelude(env: EnvBindings) {
  let reconciliation: Awaited<ReturnType<typeof runLifecycleReconciliation>> | null = null
  let coverageAudit: Awaited<ReturnType<typeof runCoverageGapAudit>> | null = null
  let lenderUniverseAudit: Awaited<ReturnType<typeof runLenderUniverseAudit>> | null = null
  let economic: Awaited<ReturnType<typeof collectEconomicSeries>> | null = null

  try {
    reconciliation = await runLifecycleReconciliation(env.DB, {
      dryRun: false,
      idleMinutes: 5,
      staleRunMinutes: 90,
      timeZone: env.MELBOURNE_TIMEZONE,
    })
    const ready = reconciliation.ready_finalizations
    const stale = reconciliation.stale_runs
    const staleUnfinalized = reconciliation.stale_unfinalized
    const context = JSON.stringify({
      scanned_rows: ready.scanned_rows,
      ready_candidate_rows: ready.ready_candidate_rows,
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
    log.info('scheduler', 'Run lifecycle reconciliation completed', { context })
    if (ready.stalled) {
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

  try {
    economic = await collectEconomicSeries(env)
  } catch (error) {
    log.warn('scheduler', 'Economic series collection failed', {
      code: 'economic_series_fetch_failed',
      context: (error as Error)?.message || String(error),
    })
  }

  return { reconciliation, coverageAudit, lenderUniverseAudit, economic }
}

export async function handleScheduledDaily(event: ScheduledController, env: EnvBindings) {
  const scheduledMs = Number.isFinite(event.scheduledTime) ? event.scheduledTime : Date.now()
  const melbourneParts = getMelbourneNowParts(
    new Date(scheduledMs),
    env.MELBOURNE_TIMEZONE || 'Australia/Melbourne',
  )
  const ingestHours = melbourneDailyIngestHours(env)
  if (!ingestHours.includes(melbourneParts.hour)) {
    return {
      ok: true,
      skipped: true,
      reason: 'not_melbourne_ingest_hour',
      melbourne: melbourneParts,
      intervalMinutes: 0,
    }
  }

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

  const collectionDate = melbourneParts.date
  const cronIso = new Date(scheduledMs).toISOString()
  const runCostlyPrelude = isEnabled(env.FEATURE_SCHEDULED_INGEST_AUDITS_ENABLED)
  const prelude = runCostlyPrelude
    ? await runOptionalScheduledPrelude(env)
    : {
        reconciliation: null,
        coverageAudit: null,
        lenderUniverseAudit: null,
        economic: null,
      }
  let coverageAudit = prelude.coverageAudit
  let coverageRemediation: Awaited<ReturnType<typeof runCoverageGapRemediation>> | null = null
  let postIngestAssurance: Awaited<ReturnType<typeof runPostIngestAssurance>> | null = null

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
      reconciliation: prelude.reconciliation,
      coverageAudit,
      economic: prelude.economic,
      lenderUniverseAudit: prelude.lenderUniverseAudit,
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
  if (!runCostlyPrelude && result.ok && !skipped) {
    try {
      postIngestAssurance = await runPostIngestAssurance(env, {
        collectionDate,
        persist: true,
        coverageGapLimit: 120,
        // Keep ingestion integrity red for data issues while avoiding false-red on delayed package refresh.
        requirePackageFreshness: false,
      })
    } catch (error) {
      log.error('scheduler', 'Post-ingest assurance pulse failed', {
        code: 'post_ingest_assurance_failed',
        error,
        context: (error as Error)?.message || String(error),
      })
    }

    try {
      coverageAudit = await runCoverageGapAudit(env, {
        collectionDate,
        runSource: 'scheduled',
        idleMinutes: 120,
        limit: 80,
        persist: true,
      })
      if (!coverageAudit.ok) {
        coverageRemediation = await runCoverageGapRemediation(env, {
          auditReport: coverageAudit,
          dailyRunResult: result,
          scopeLimit: 6,
          replayLimit: 10,
          persist: true,
        })
        coverageAudit = await runCoverageGapAudit(env, {
          collectionDate,
          runSource: 'scheduled',
          idleMinutes: 120,
          limit: 80,
          persist: true,
          emitDetectedGapsLog: false,
        })
      }
    } catch (error) {
      log.error('scheduler', 'Coverage pulse after daily ingest failed', {
        code: 'coverage_slo_breach',
        error,
        context: (error as Error)?.message || String(error),
      })
    }
  }

  if (runCostlyPrelude && coverageAudit && !coverageAudit.ok) {
    try {
      coverageRemediation = await runCoverageGapRemediation(env, {
        auditReport: coverageAudit,
        dailyRunResult: result,
        scopeLimit: 12,
        replayLimit: 25,
        persist: true,
      })
      coverageAudit = await runCoverageGapAudit(env, {
        collectionDate,
        runSource: 'scheduled',
        idleMinutes: 120,
        limit: 200,
        persist: true,
        emitDetectedGapsLog: false,
      })
    } catch (error) {
      log.error('scheduler', 'Coverage gap auto-remediation failed', {
        code: 'coverage_slo_breach',
        error,
        context: (error as Error)?.message || String(error),
      })
    }
  }

  if (result.ok && !skipped) {
    await setAppConfig(env.DB, RATE_CHECK_LAST_RUN_ISO_KEY, cronIso)
  }

  if (isEnabled(env.FEATURE_SCHEDULED_PRODUCT_CLASSIFICATION_AUDIT_ENABLED)) {
    try {
      await runProductClassificationAudit(env, { persist: true })
    } catch (error) {
      log.error('scheduler', 'product_classification_audit_failed', {
        code: 'product_classification_gaps',
        error,
        context: (error as Error)?.message || String(error),
      })
    }
  }

  return {
    ...result,
    reconciliation: prelude.reconciliation,
    coverageAudit,
    coverageRemediation,
    postIngestAssurance,
    economic: prelude.economic,
    lenderUniverseAudit: prelude.lenderUniverseAudit,
    melbourne: melbourneParts,
    intervalMinutes: 0,
  }
}
