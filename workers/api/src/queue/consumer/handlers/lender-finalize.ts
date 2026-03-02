import { getLenderDatasetRun, tryMarkLenderDatasetFinalized } from '../../../db/lender-dataset-runs'
import { finalizePresenceForRun } from '../../../db/presence-finalize'
import type { EnvBindings, LenderFinalizeJob } from '../../../types'
import { log } from '../../../utils/logger'

export async function handleLenderFinalizeJob(env: EnvBindings, job: LenderFinalizeJob): Promise<void> {
  const run = await getLenderDatasetRun(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: job.dataset,
  })
  if (!run) {
    throw new Error(`lender_finalize_missing_run_state:${job.lenderCode}:${job.dataset}`)
  }
  if (run.finalized_at) {
    return
  }

  const detailProcessed = Number(run.completed_detail_count || 0) + Number(run.failed_detail_count || 0)
  const expected = Number(run.expected_detail_count || 0)
  if (detailProcessed < expected) {
    throw new Error(`lender_finalize_not_ready:${job.lenderCode}:${job.dataset}:${detailProcessed}/${expected}`)
  }

  const marked = await tryMarkLenderDatasetFinalized(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: job.dataset,
  })
  if (!marked) {
    return
  }

  await finalizePresenceForRun(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: job.dataset,
    bankName: run.bank_name,
    collectionDate: run.collection_date,
  })

  log.info('consumer', 'lender_finalize completed', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `dataset=${job.dataset} expected=${expected}` +
      ` completed=${run.completed_detail_count} failed=${run.failed_detail_count}`,
  })
}
