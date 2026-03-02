import type { EnvBindings, LenderFinalizeJob } from '../../../types'
import { finalizeLenderDataset } from '../finalization'

export async function handleLenderFinalizeJob(env: EnvBindings, job: LenderFinalizeJob): Promise<void> {
  await finalizeLenderDataset(
    env,
    {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: job.dataset,
    },
    { throwIfNotReady: true },
  )
}
