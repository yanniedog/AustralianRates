import { TARGET_LENDERS } from '../constants'
import { claimHistoricalTask, createHistoricalRunWithTasks, daysBetweenInclusive, findActiveHistoricalRun, finalizeHistoricalTask, getHistoricalRunDetail, getHistoricalRunById, getHistoricalTaskById, getLastHistoricalRunCreatedAt, refreshHistoricalRunStats, registerHistoricalBatch, addHistoricalTaskBatchCounts } from '../db/client-historical-runs'
import { getCachedEndpoint } from '../db/endpoint-cache'
import { upsertHistoricalRateRows } from '../db/historical-rates'
import { upsertSavingsRateRows } from '../db/savings-rates'
import { upsertTdRateRows } from '../db/td-rates'
import { discoverProductsEndpoint } from '../ingest/cdr'
import { type NormalizedRateRow, validateNormalizedRow } from '../ingest/normalize'
import { type NormalizedSavingsRow, type NormalizedTdRow, validateNormalizedSavingsRow, validateNormalizedTdRow } from '../ingest/normalize-savings'
import type { EnvBindings } from '../types'
import { sha256HexFromJson } from '../utils/hash'
import { parseIntegerEnv } from '../utils/time'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

type ServiceSuccess<T> = { ok: true; value: T }
type ServiceError = { ok: false; status: ContentfulStatusCode; code: string; message: string; details?: unknown }

type ServiceResult<T> = ServiceSuccess<T> | ServiceError

type HistoricalCreateInput = {
  triggerSource: 'public' | 'admin'
  requestedBy?: string | null
  startDate: string
  endDate: string
}

type HistoricalBatchInput = {
  runId: string
  taskId: number
  batchId: string
  workerId?: string | null
  hadSignals?: boolean
  mortgageRows: NormalizedRateRow[]
  savingsRows: NormalizedSavingsRow[]
  tdRows: NormalizedTdRow[]
}

function ok<T>(value: T): ServiceSuccess<T> {
  return { ok: true, value }
}

function fail(status: ContentfulStatusCode, code: string, message: string, details?: unknown): ServiceError {
  return { ok: false, status, code, message, details }
}

function isDateOnly(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(input || ''))
}

function clampRangeDays(value: number, fallback: number): number {
  return Math.max(1, Math.min(3650, Number.isFinite(value) ? Math.floor(value) : fallback))
}

function toHistoricalRunId(triggerSource: 'public' | 'admin', startDate: string, endDate: string): string {
  return `historical:${triggerSource}:${startDate}:${endDate}:${crypto.randomUUID()}`
}

function toWorkerCommand(runId: string): string {
  return `AR_ADMIN_TOKEN=<token> npm run historical:worker -- --run-id ${runId}`
}

function parseRowArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return []
  return value as T[]
}

function toLoanRows(rawRows: unknown, runId: string): ServiceResult<NormalizedRateRow[]> {
  const rows = parseRowArray<NormalizedRateRow>(rawRows)
  const out: NormalizedRateRow[] = []
  for (const row of rows) {
    const normalized = {
      ...row,
      runId,
      runSource: 'manual' as const,
      retrievalType: 'historical_scrape' as const,
    }
    const verdict = validateNormalizedRow(normalized)
    if (!verdict.ok) {
      return fail(400, 'INVALID_ROW', `Invalid mortgage row: ${verdict.reason}`)
    }
    out.push(normalized)
  }
  return ok(out)
}

function toSavingsRows(rawRows: unknown, runId: string): ServiceResult<NormalizedSavingsRow[]> {
  const rows = parseRowArray<NormalizedSavingsRow>(rawRows)
  const out: NormalizedSavingsRow[] = []
  for (const row of rows) {
    const normalized = {
      ...row,
      runId,
      runSource: 'manual' as const,
      retrievalType: 'historical_scrape' as const,
    }
    const verdict = validateNormalizedSavingsRow(normalized)
    if (!verdict.ok) {
      return fail(400, 'INVALID_ROW', `Invalid savings row: ${verdict.reason}`)
    }
    out.push(normalized)
  }
  return ok(out)
}

function toTdRows(rawRows: unknown, runId: string): ServiceResult<NormalizedTdRow[]> {
  const rows = parseRowArray<NormalizedTdRow>(rawRows)
  const out: NormalizedTdRow[] = []
  for (const row of rows) {
    const normalized = {
      ...row,
      runId,
      runSource: 'manual' as const,
      retrievalType: 'historical_scrape' as const,
    }
    const verdict = validateNormalizedTdRow(normalized)
    if (!verdict.ok) {
      return fail(400, 'INVALID_ROW', `Invalid term-deposit row: ${verdict.reason}`)
    }
    out.push(normalized)
  }
  return ok(out)
}

export async function startHistoricalPullRun(
  env: EnvBindings,
  input: HistoricalCreateInput,
): Promise<ServiceResult<{ run_id: string; worker_command: string; range_days: number }>> {
  const startDate = String(input.startDate || '').trim()
  const endDate = String(input.endDate || '').trim()
  if (!isDateOnly(startDate) || !isDateOnly(endDate)) {
    return fail(400, 'INVALID_REQUEST', 'start_date and end_date must be YYYY-MM-DD.')
  }
  const rangeDays = daysBetweenInclusive(startDate, endDate)
  if (rangeDays <= 0) {
    return fail(400, 'INVALID_REQUEST', 'end_date must be on or after start_date.')
  }

  const publicMaxDays = clampRangeDays(parseIntegerEnv(env.PUBLIC_HISTORICAL_MAX_RANGE_DAYS, 30), 30)
  const adminMaxDays = clampRangeDays(parseIntegerEnv(env.ADMIN_HISTORICAL_MAX_RANGE_DAYS, 365), 365)
  const allowedDays = input.triggerSource === 'public' ? publicMaxDays : adminMaxDays
  if (rangeDays > allowedDays) {
    return fail(400, 'INVALID_REQUEST', `Date range exceeds max ${allowedDays} days for ${input.triggerSource} runs.`)
  }

  if (input.triggerSource === 'public') {
    const active = await findActiveHistoricalRun(env.DB, 'public')
    if (active) {
      return fail(429, 'RUN_ALREADY_ACTIVE', 'A public historical pull is already running.', {
        run_id: active.run_id,
      })
    }
    const cooldownSeconds = Math.max(0, parseIntegerEnv(env.PUBLIC_HISTORICAL_COOLDOWN_SECONDS, 300))
    if (cooldownSeconds > 0) {
      const lastCreatedAt = await getLastHistoricalRunCreatedAt(env.DB, 'public')
      if (lastCreatedAt) {
        const lastMs = new Date(lastCreatedAt).getTime()
        const elapsed = Number.isNaN(lastMs) ? cooldownSeconds * 1000 : Date.now() - lastMs
        if (elapsed >= 0 && elapsed < cooldownSeconds * 1000) {
          return fail(429, 'COOLDOWN_ACTIVE', 'Public historical pull cooldown is active.', {
            retry_after_seconds: Math.max(1, Math.ceil((cooldownSeconds * 1000 - elapsed) / 1000)),
          })
        }
      }
    }
  }

  const lenderCodes = TARGET_LENDERS.map((x) => x.code)
  const runId = toHistoricalRunId(input.triggerSource, startDate, endDate)
  await createHistoricalRunWithTasks(env.DB, {
    runId,
    triggerSource: input.triggerSource,
    requestedBy: input.requestedBy ?? null,
    startDate,
    endDate,
    lenderCodes,
    runSource: 'manual',
  })

  return ok({
    run_id: runId,
    worker_command: toWorkerCommand(runId),
    range_days: rangeDays,
  })
}

export async function getHistoricalPullDetail(
  env: EnvBindings,
  runId: string,
  expectedTriggerSource?: 'public' | 'admin',
): Promise<ServiceResult<Awaited<ReturnType<typeof getHistoricalRunDetail>>>> {
  const trimmed = String(runId || '').trim()
  if (!trimmed) return fail(400, 'INVALID_REQUEST', 'runId is required.')
  await refreshHistoricalRunStats(env.DB, trimmed)
  const detail = await getHistoricalRunDetail(env.DB, trimmed)
  if (!detail) return fail(404, 'NOT_FOUND', 'Historical run not found.')
  if (expectedTriggerSource && detail.run.trigger_source !== expectedTriggerSource) {
    return fail(404, 'NOT_FOUND', 'Historical run not found.')
  }
  return ok(detail)
}

export async function claimHistoricalPullTask(
  env: EnvBindings,
  input: { runId: string; workerId: string },
): Promise<ServiceResult<{ run_id: string; task: null | {
  task_id: number
  lender_code: string
  collection_date: string
  seed_urls: string[]
  endpoint_candidates: string[]
  attempt_count: number
} }>> {
  const runId = String(input.runId || '').trim()
  const workerId = String(input.workerId || '').trim()
  if (!runId || !workerId) {
    return fail(400, 'INVALID_REQUEST', 'run_id and worker_id are required.')
  }
  const run = await getHistoricalRunById(env.DB, runId)
  if (!run) return fail(404, 'NOT_FOUND', 'Historical run not found.')
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'partial') {
    return ok({ run_id: runId, task: null })
  }

  const claimTtl = Math.max(60, parseIntegerEnv(env.HISTORICAL_TASK_CLAIM_TTL_SECONDS, 900))
  const task = await claimHistoricalTask(env.DB, { runId, workerId, claimTtlSeconds: claimTtl })
  if (!task) {
    return ok({ run_id: runId, task: null })
  }

  const lender = TARGET_LENDERS.find((x) => x.code === task.lender_code)
  if (!lender) {
    await finalizeHistoricalTask(env.DB, {
      taskId: task.task_id,
      runId,
      workerId,
      status: 'failed',
      lastError: `unknown_lender_code:${task.lender_code}`,
      hadSignals: false,
    })
    return fail(500, 'INTERNAL_ERROR', `Unknown lender code in task: ${task.lender_code}`)
  }

  const endpointCandidates: string[] = []
  const cached = await getCachedEndpoint(env.DB, lender.code)
  if (cached?.endpointUrl) endpointCandidates.push(cached.endpointUrl)
  if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint)
  const discovered = await discoverProductsEndpoint(lender)
  if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl)

  return ok({
    run_id: runId,
    task: {
      task_id: task.task_id,
      lender_code: task.lender_code,
      collection_date: task.collection_date,
      seed_urls: lender.seed_rate_urls.slice(0, 2),
      endpoint_candidates: Array.from(new Set(endpointCandidates.filter(Boolean))),
      attempt_count: task.attempt_count,
    },
  })
}

export async function ingestHistoricalPullTaskBatch(
  env: EnvBindings,
  input: HistoricalBatchInput,
): Promise<ServiceResult<{
  deduped: boolean
  written: { mortgage_rows: number; savings_rows: number; td_rows: number; total_rows: number }
}>> {
  const runId = String(input.runId || '').trim()
  const batchId = String(input.batchId || '').trim()
  if (!runId || !batchId || !Number.isFinite(input.taskId)) {
    return fail(400, 'INVALID_REQUEST', 'run_id, task_id, and batch_id are required.')
  }

  const task = await getHistoricalTaskById(env.DB, input.taskId)
  if (!task || task.run_id !== runId) {
    return fail(404, 'NOT_FOUND', 'Task not found.')
  }
  if (task.status !== 'claimed') {
    return fail(409, 'TASK_NOT_CLAIMED', 'Task must be claimed before batch ingestion.')
  }
  if (input.workerId && task.claimed_by && task.claimed_by !== input.workerId) {
    return fail(409, 'TASK_CLAIMED_BY_OTHER', 'Task is claimed by another worker.')
  }

  const loanRowsResult = toLoanRows(input.mortgageRows, runId)
  if (!loanRowsResult.ok) return loanRowsResult
  const savingsRowsResult = toSavingsRows(input.savingsRows, runId)
  if (!savingsRowsResult.ok) return savingsRowsResult
  const tdRowsResult = toTdRows(input.tdRows, runId)
  if (!tdRowsResult.ok) return tdRowsResult

  const mortgageRows = loanRowsResult.value
  const savingsRows = savingsRowsResult.value
  const tdRows = tdRowsResult.value
  const totalRows = mortgageRows.length + savingsRows.length + tdRows.length
  const maxRows = Math.max(1, parseIntegerEnv(env.HISTORICAL_MAX_BATCH_ROWS, 50))
  if (totalRows > maxRows) {
    return fail(400, 'INVALID_REQUEST', `Batch exceeds max ${maxRows} rows.`)
  }

  const payloadHash = await sha256HexFromJson({
    runId,
    taskId: input.taskId,
    mortgageRows,
    savingsRows,
    tdRows,
    hadSignals: Boolean(input.hadSignals),
  })
  const inserted = await registerHistoricalBatch(env.DB, {
    batchId,
    runId,
    taskId: input.taskId,
    workerId: input.workerId ?? null,
    payloadHash,
    rowCount: totalRows,
  })
  if (!inserted) {
    return ok({
      deduped: true,
      written: { mortgage_rows: 0, savings_rows: 0, td_rows: 0, total_rows: 0 },
    })
  }

  const [mortgageWritten, savingsWritten, tdWritten] = await Promise.all([
    upsertHistoricalRateRows(env.DB, mortgageRows),
    upsertSavingsRateRows(env.DB, savingsRows),
    upsertTdRateRows(env.DB, tdRows),
  ])

  await addHistoricalTaskBatchCounts(env.DB, {
    taskId: input.taskId,
    runId,
    mortgageRows: mortgageWritten,
    savingsRows: savingsWritten,
    tdRows: tdWritten,
    hadSignals: Boolean(input.hadSignals),
  })
  await refreshHistoricalRunStats(env.DB, runId)

  return ok({
    deduped: false,
    written: {
      mortgage_rows: mortgageWritten,
      savings_rows: savingsWritten,
      td_rows: tdWritten,
      total_rows: mortgageWritten + savingsWritten + tdWritten,
    },
  })
}

export async function finalizeHistoricalPullTaskRun(
  env: EnvBindings,
  input: {
    runId: string
    taskId: number
    workerId?: string | null
    status: 'completed' | 'failed'
    hadSignals?: boolean
    error?: string | null
  },
): Promise<ServiceResult<{ task_id: number; status: string }>> {
  const runId = String(input.runId || '').trim()
  if (!runId || !Number.isFinite(input.taskId)) {
    return fail(400, 'INVALID_REQUEST', 'run_id and task_id are required.')
  }
  const task = await getHistoricalTaskById(env.DB, input.taskId)
  if (!task || task.run_id !== runId) {
    return fail(404, 'NOT_FOUND', 'Task not found.')
  }

  const updated = await finalizeHistoricalTask(env.DB, {
    taskId: input.taskId,
    runId,
    workerId: input.workerId ?? null,
    status: input.status,
    hadSignals: Boolean(input.hadSignals),
    lastError: input.error ?? null,
  })
  if (!updated) {
    return fail(409, 'TASK_FINALIZE_FAILED', 'Task could not be finalized.')
  }
  await refreshHistoricalRunStats(env.DB, runId)
  return ok({ task_id: input.taskId, status: updated.status })
}
