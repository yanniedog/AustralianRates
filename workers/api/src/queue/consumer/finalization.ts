import { getLenderDatasetRun, markLenderDatasetDetailProcessed, tryMarkLenderDatasetFinalized } from '../../db/lender-dataset-runs'
import { finalizePresenceForRun } from '../../db/presence-finalize'
import type { EnvBindings } from '../../types'
import { log } from '../../utils/logger'
import type { DatasetKind } from '../../../../../packages/shared/src'

export async function finalizeLenderDatasetIfReady(
  env: EnvBindings,
  input: { runId: string; lenderCode: string; dataset: DatasetKind },
): Promise<boolean> {
  const run = await getLenderDatasetRun(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: input.dataset,
  })
  if (!run || run.finalized_at) {
    return false
  }

  const expected = Number(run.expected_detail_count || 0)
  if (expected <= 0) {
    return false
  }
  const detailProcessed = Number(run.completed_detail_count || 0) + Number(run.failed_detail_count || 0)
  if (detailProcessed < expected) {
    return false
  }

  const marked = await tryMarkLenderDatasetFinalized(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: input.dataset,
  })
  if (!marked) {
    return false
  }

  await finalizePresenceForRun(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: input.dataset,
    bankName: run.bank_name,
    collectionDate: run.collection_date,
  })

  log.info('consumer', 'lender_finalize auto_completed', {
    runId: input.runId,
    lenderCode: input.lenderCode,
    context:
      `dataset=${input.dataset} expected=${expected}` +
      ` completed=${run.completed_detail_count} failed=${run.failed_detail_count}`,
  })
  return true
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
  await markLenderDatasetDetailProcessed(env.DB, input)
  await finalizeLenderDatasetIfReady(env, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: input.dataset,
  })
}
