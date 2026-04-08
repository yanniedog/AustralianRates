import {
  getLenderDatasetRun,
  markLenderDatasetDetailProcessed,
  tryMarkLenderDatasetFinalized,
  type LenderDatasetRunRow,
} from '../../db/lender-dataset-runs'
import { runWithD1Retry } from '../../db/d1-retry'
import { finalizePresenceForRun } from '../../db/presence-finalize'
import type { EnvBindings } from '../../types'
import { isLenderDatasetReadyForFinalization } from '../../utils/lender-dataset-invariants'
import { log } from '../../utils/logger'
import type { DatasetKind } from '../../../../../packages/shared/src'

type FinalizationDeps = {
  getLenderDatasetRun: typeof getLenderDatasetRun
  tryMarkLenderDatasetFinalized: typeof tryMarkLenderDatasetFinalized
  finalizePresenceForRun: typeof finalizePresenceForRun
  markLenderDatasetDetailProcessed: typeof markLenderDatasetDetailProcessed
}

const defaultDeps: FinalizationDeps = {
  getLenderDatasetRun,
  tryMarkLenderDatasetFinalized,
  finalizePresenceForRun,
  markLenderDatasetDetailProcessed,
}

const FINALIZATION_MAX_ATTEMPTS = 3
const FINALIZATION_RETRY_BASE_MS = 75

function isTransientDbError(error: unknown): boolean {
  const message = ((error as Error)?.message || String(error)).toLowerCase()
  return (
    message.includes('d1_error') ||
    message.includes('sqlite_busy') ||
    message.includes('database is locked') ||
    message.includes('temporarily unavailable') ||
    message.includes('timed out') ||
    message.includes('timeout')
  )
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Compact counts for lender_finalize_not_ready errors (ops triage without D1 query). */
function formatLenderDatasetRunSnapshot(run: LenderDatasetRunRow): string {
  return (
    `exp${Number(run.expected_detail_count || 0)}` +
    `_acc${Number(run.accepted_row_count || 0)}` +
    `_w${Number(run.written_row_count || 0)}` +
    `_c${Number(run.completed_detail_count || 0)}` +
    `_f${Number(run.failed_detail_count || 0)}` +
    `_dfe${Number(run.detail_fetch_event_count || 0)}`
  )
}

async function runWithTransientRetry<T>(
  input: { runId: string; lenderCode: string; dataset: DatasetKind; operation: string },
  task: () => Promise<T>,
): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= FINALIZATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      const retryable = isTransientDbError(error)
      if (!retryable || attempt >= FINALIZATION_MAX_ATTEMPTS) break
      const backoffMs = FINALIZATION_RETRY_BASE_MS * attempt
      log.warn('consumer', 'lender_finalize_retry', {
        runId: input.runId,
        lenderCode: input.lenderCode,
        context:
          `dataset=${input.dataset} operation=${input.operation}` +
          ` attempt=${attempt}/${FINALIZATION_MAX_ATTEMPTS}` +
          ` backoff_ms=${backoffMs} error=${(error as Error)?.message || String(error)}`,
      })
      await sleep(backoffMs)
    }
  }
  throw lastError
}

export async function finalizeLenderDataset(
  env: EnvBindings,
  input: { runId: string; lenderCode: string; dataset: DatasetKind },
  options?: { throwIfNotReady?: boolean },
  deps: FinalizationDeps = defaultDeps,
): Promise<boolean> {
  const run = await deps.getLenderDatasetRun(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: input.dataset,
  })
  if (!run) {
    if (options?.throwIfNotReady) {
      throw new Error(`lender_finalize_missing_run_state:${input.lenderCode}:${input.dataset}`)
    }
    return false
  }
  if (run.finalized_at) {
    return false
  }

  const expected = Number(run.expected_detail_count || 0)
  const readiness = isLenderDatasetReadyForFinalization(run)
  if (!readiness.ready) {
    if (options?.throwIfNotReady) {
      if (readiness.reason === 'detail_processing_incomplete') {
        log.info('consumer', 'lender_finalize deferred', {
          runId: input.runId,
          lenderCode: input.lenderCode,
          context: `dataset=${input.dataset} awaiting_detail_jobs`,
        })
        return false
      }
      throw new Error(
        `lender_finalize_not_ready:${input.lenderCode}:${input.dataset}:${readiness.reason || 'unknown'}:${formatLenderDatasetRunSnapshot(run)}`,
      )
    }
    return false
  }

  if (expected <= 0) {
    const marked = await runWithTransientRetry(
      {
        runId: input.runId,
        lenderCode: input.lenderCode,
        dataset: input.dataset,
        operation: 'mark_dataset_finalized_zero_expected',
      },
      async () =>
        deps.tryMarkLenderDatasetFinalized(env.DB, {
          runId: input.runId,
          lenderCode: input.lenderCode,
          dataset: input.dataset,
        }),
    )
    if (!marked) return false
    log.info('consumer', 'lender_finalize completed', {
      runId: input.runId,
      lenderCode: input.lenderCode,
      context:
        `dataset=${input.dataset} expected=0` +
        ` completed=${run.completed_detail_count} failed=${run.failed_detail_count}` +
        ` presence_skipped=1`,
    })
    return true
  }

  const presenceSummary = await runWithTransientRetry(
    {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: input.dataset,
      operation: 'finalize_presence_for_run',
    },
    async () =>
      deps.finalizePresenceForRun(env.DB, {
        runId: input.runId,
        lenderCode: input.lenderCode,
        dataset: input.dataset,
        bankName: run.bank_name,
        collectionDate: run.collection_date,
      }),
  )

  const marked = await runWithTransientRetry(
    {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: input.dataset,
      operation: 'mark_dataset_finalized',
    },
    async () =>
      deps.tryMarkLenderDatasetFinalized(env.DB, {
        runId: input.runId,
        lenderCode: input.lenderCode,
        dataset: input.dataset,
      }),
  )
  if (!marked) {
    return false
  }

  log.info('consumer', 'lender_finalize completed', {
    runId: input.runId,
    lenderCode: input.lenderCode,
    context:
      `dataset=${input.dataset} expected=${expected}` +
      ` completed=${run.completed_detail_count} failed=${run.failed_detail_count}` +
      ` presence(seen=${presenceSummary.seenProducts},removed_products=${presenceSummary.removedProducts},removed_series=${presenceSummary.removedSeries})`,
  })
  return true
}

export async function finalizeLenderDatasetIfReady(
  env: EnvBindings,
  input: { runId: string; lenderCode: string; dataset: DatasetKind },
): Promise<boolean> {
  return finalizeLenderDataset(env, input, { throwIfNotReady: false })
}

export async function markDetailProcessedAndFinalize(
  env: EnvBindings,
  input: {
    runId: string
    lenderCode: string
    dataset: DatasetKind
    failed?: boolean
    errorMessage?: string | null
  },
): Promise<void> {
  await runWithD1Retry(async () => {
    await defaultDeps.markLenderDatasetDetailProcessed(env.DB, input)
  })
  await finalizeLenderDataset(env, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: input.dataset,
  }, { throwIfNotReady: false })
}
