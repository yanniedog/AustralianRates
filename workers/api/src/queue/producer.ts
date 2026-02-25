import type {
  BackfillDayJob,
  BackfillSnapshotJob,
  DailyLenderJob,
  DailySavingsLenderJob,
  EnvBindings,
  HistoricalTaskExecuteJob,
  IngestMessage,
  LenderConfig,
  ProductDetailJob,
  RunSource,
} from '../types'
import {
  buildBackfillDayIdempotencyKey,
  buildBackfillIdempotencyKey,
  buildDailyLenderIdempotencyKey,
  buildHistoricalTaskIdempotencyKey,
  buildProductDetailIdempotencyKey,
} from '../utils/idempotency'

type QueueEnv = Pick<EnvBindings, 'INGEST_QUEUE'>
const MAX_QUEUE_BATCH_SIZE = 100

function asQueueBatch(messages: IngestMessage[]) {
  return messages.map((message) => ({ body: message }))
}

async function sendInChunks(env: QueueEnv, messages: IngestMessage[]): Promise<void> {
  if (messages.length === 0) return
  for (let index = 0; index < messages.length; index += MAX_QUEUE_BATCH_SIZE) {
    await env.INGEST_QUEUE.sendBatch(asQueueBatch(messages.slice(index, index + MAX_QUEUE_BATCH_SIZE)))
  }
}

export async function enqueueDailyLenderJobs(
  env: QueueEnv,
  input: {
    runId: string
    runSource?: RunSource
    collectionDate: string
    lenders: LenderConfig[]
  },
): Promise<{ enqueued: number; perLender: Record<string, number> }> {
  const runSource = input.runSource ?? 'scheduled'
  const jobs: DailyLenderJob[] = input.lenders.map((lender) => ({
    kind: 'daily_lender_fetch',
    runId: input.runId,
    runSource,
    lenderCode: lender.code,
    collectionDate: input.collectionDate,
    attempt: 0,
    idempotencyKey: buildDailyLenderIdempotencyKey(input.runId, lender.code),
  }))

  await sendInChunks(env, jobs)

  return {
    enqueued: jobs.length,
    perLender: Object.fromEntries(jobs.map((job) => [job.lenderCode, 1])),
  }
}

export async function enqueueProductDetailJobs(
  env: QueueEnv,
  input: {
    runId: string
    runSource?: RunSource
    lenderCode: string
    collectionDate: string
    productIds: string[]
  },
): Promise<{ enqueued: number }> {
  const productIds = Array.from(new Set(input.productIds)).filter(Boolean)
  const runSource = input.runSource ?? 'scheduled'
  const jobs: ProductDetailJob[] = productIds.map((productId) => ({
    kind: 'product_detail_fetch',
    runId: input.runId,
    runSource,
    lenderCode: input.lenderCode,
    productId,
    collectionDate: input.collectionDate,
    attempt: 0,
    idempotencyKey: buildProductDetailIdempotencyKey(input.runId, input.lenderCode, productId),
  }))

  await sendInChunks(env, jobs)

  return {
    enqueued: jobs.length,
  }
}

export async function enqueueDailySavingsLenderJobs(
  env: QueueEnv,
  input: {
    runId: string
    runSource?: RunSource
    collectionDate: string
    lenders: LenderConfig[]
  },
): Promise<{ enqueued: number; perLender: Record<string, number> }> {
  const runSource = input.runSource ?? 'scheduled'
  const jobs: DailySavingsLenderJob[] = input.lenders.map((lender) => ({
    kind: 'daily_savings_lender_fetch',
    runId: input.runId,
    runSource,
    lenderCode: lender.code,
    collectionDate: input.collectionDate,
    attempt: 0,
    idempotencyKey: `${input.runId}:savings:${lender.code}`,
  }))

  await sendInChunks(env, jobs)

  return {
    enqueued: jobs.length,
    perLender: Object.fromEntries(jobs.map((job) => [job.lenderCode, 1])),
  }
}

export async function enqueueBackfillJobs(
  env: QueueEnv,
  input: {
    runId: string
    runSource?: RunSource
    jobs: Array<{ lenderCode: string; seedUrl: string; monthCursor: string }>
  },
): Promise<{ enqueued: number; perLender: Record<string, number> }> {
  const runSource = input.runSource ?? 'scheduled'
  const jobs: BackfillSnapshotJob[] = input.jobs.map((job) => ({
    kind: 'backfill_snapshot_fetch',
    runId: input.runId,
    runSource,
    lenderCode: job.lenderCode,
    seedUrl: job.seedUrl,
    monthCursor: job.monthCursor,
    attempt: 0,
    idempotencyKey: buildBackfillIdempotencyKey(input.runId, job.lenderCode, job.seedUrl, job.monthCursor),
  }))

  await sendInChunks(env, jobs)

  const perLender: Record<string, number> = {}
  for (const job of jobs) {
    perLender[job.lenderCode] = (perLender[job.lenderCode] || 0) + 1
  }

  return {
    enqueued: jobs.length,
    perLender,
  }
}

export async function enqueueBackfillDayJobs(
  env: QueueEnv,
  input: {
    runId: string
    runSource?: RunSource
    jobs: Array<{ lenderCode: string; collectionDate: string }>
  },
): Promise<{ enqueued: number; perLender: Record<string, number> }> {
  const runSource = input.runSource ?? 'scheduled'
  const jobs: BackfillDayJob[] = input.jobs.map((job) => ({
    kind: 'backfill_day_fetch',
    runId: input.runId,
    runSource,
    lenderCode: job.lenderCode,
    collectionDate: job.collectionDate,
    attempt: 0,
    idempotencyKey: buildBackfillDayIdempotencyKey(input.runId, job.lenderCode, job.collectionDate),
  }))

  await sendInChunks(env, jobs)

  const perLender: Record<string, number> = {}
  for (const job of jobs) {
    perLender[job.lenderCode] = (perLender[job.lenderCode] || 0) + 1
  }

  return { enqueued: jobs.length, perLender }
}

export async function enqueueHistoricalTaskJobs(
  env: QueueEnv,
  input: {
    runId: string
    runSource?: RunSource
    taskIds: number[]
  },
): Promise<{ enqueued: number }> {
  const runSource = input.runSource ?? 'manual'
  const uniqueTaskIds = Array.from(
    new Set(input.taskIds.map((taskId) => Math.floor(Number(taskId))).filter((taskId) => Number.isFinite(taskId) && taskId > 0)),
  )
  const jobs: HistoricalTaskExecuteJob[] = uniqueTaskIds.map((taskId) => ({
    kind: 'historical_task_execute',
    runId: input.runId,
    runSource,
    taskId,
    attempt: 0,
    idempotencyKey: buildHistoricalTaskIdempotencyKey(input.runId, taskId),
  }))

  await sendInChunks(env, jobs)
  return { enqueued: jobs.length }
}
