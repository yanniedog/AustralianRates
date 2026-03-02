import type { EnvBindings, IngestMessage } from '../../types'
import { handleBackfillDayJob } from './handlers/backfill-day'
import { handleBackfillSnapshotJob } from './handlers/backfill-snapshot'
import { handleDailyLenderJob } from './handlers/daily-home-loans'
import { handleDailySavingsLenderJob } from './handlers/daily-savings-term-deposits'
import { handleHistoricalTaskJob } from './handlers/historical-task'
import { handleLenderFinalizeJob } from './handlers/lender-finalize'
import { handleProductDetailJob } from './handlers/product-detail'

export async function processMessage(env: EnvBindings, message: IngestMessage): Promise<void> {
  if (message.kind === 'daily_lender_fetch') {
    return handleDailyLenderJob(env, message)
  }
  if (message.kind === 'product_detail_fetch') {
    return handleProductDetailJob(env, message)
  }
  if (message.kind === 'lender_finalize') {
    return handleLenderFinalizeJob(env, message)
  }
  if (message.kind === 'backfill_snapshot_fetch') {
    return handleBackfillSnapshotJob(env, message)
  }
  if (message.kind === 'backfill_day_fetch') {
    return handleBackfillDayJob(env, message)
  }
  if (message.kind === 'daily_savings_lender_fetch') {
    return handleDailySavingsLenderJob(env, message)
  }
  if (message.kind === 'historical_task_execute') {
    return handleHistoricalTaskJob(env, message)
  }

  throw new Error(`Unsupported message kind: ${String((message as Record<string, unknown>).kind)}`)
}
