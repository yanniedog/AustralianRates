import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import lendersConfigRaw from '../../config/lenders.json'
import { collectHistoricalDayFromWayback } from '../ingest/wayback-historical'
import type { LenderConfigFile } from '../types'

const DEFAULT_API_BASE = 'https://www.australianrates.com/api/home-loan-rates'
const DEFAULT_BATCH_SIZE = 50
const MAX_RETRIES = 4

type ClaimTask = {
  task_id: number
  lender_code: string
  collection_date: string
  seed_urls: string[]
  endpoint_candidates: string[]
  attempt_count: number
}

type ClaimResponse = {
  ok: boolean
  task: ClaimTask | null
}

type BatchRequest = {
  run_id: string
  batch_id: string
  worker_id: string
  mortgage_rows: unknown[]
  savings_rows: unknown[]
  td_rows: unknown[]
  had_signals: boolean
}

const lendersConfig = lendersConfigRaw as LenderConfigFile
const lendersByCode = new Map(lendersConfig.lenders.map((x) => [x.code, x]))

export function parseRunId(argv: string[]): string {
  const idx = argv.findIndex((arg) => arg === '--run-id')
  if (idx >= 0 && argv[idx + 1]) return String(argv[idx + 1]).trim()
  return ''
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetries<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt >= MAX_RETRIES) break
      const delayMs = Math.min(10000, 500 * Math.pow(2, attempt - 1))
      console.warn(`[retry] ${label} attempt=${attempt} failed; waiting ${delayMs}ms`)
      await sleep(delayMs)
    }
  }
  throw lastError
}

async function fetchJson<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { ok: false, raw: text }
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}: ${JSON.stringify(parsed)}`)
  }
  return parsed as T
}

export function chunkRows<T>(rows: T[], size: number): T[][] {
  const out: T[][] = []
  const safeSize = Math.max(1, Math.floor(size))
  for (let i = 0; i < rows.length; i += safeSize) {
    out.push(rows.slice(i, i + safeSize))
  }
  return out
}

export function buildBatchRequests(input: {
  runId: string
  workerId: string
  taskId: number
  hadSignals: boolean
  mortgageRows: unknown[]
  savingsRows: unknown[]
  tdRows: unknown[]
}): BatchRequest[] {
  const requests: BatchRequest[] = []
  let seq = 0

  for (const chunk of chunkRows(input.mortgageRows, DEFAULT_BATCH_SIZE)) {
    seq += 1
    requests.push({
      run_id: input.runId,
      batch_id: `${input.runId}:${input.taskId}:m:${seq}`,
      worker_id: input.workerId,
      mortgage_rows: chunk,
      savings_rows: [],
      td_rows: [],
      had_signals: input.hadSignals,
    })
  }
  for (const chunk of chunkRows(input.savingsRows, DEFAULT_BATCH_SIZE)) {
    seq += 1
    requests.push({
      run_id: input.runId,
      batch_id: `${input.runId}:${input.taskId}:s:${seq}`,
      worker_id: input.workerId,
      mortgage_rows: [],
      savings_rows: chunk,
      td_rows: [],
      had_signals: input.hadSignals,
    })
  }
  for (const chunk of chunkRows(input.tdRows, DEFAULT_BATCH_SIZE)) {
    seq += 1
    requests.push({
      run_id: input.runId,
      batch_id: `${input.runId}:${input.taskId}:t:${seq}`,
      worker_id: input.workerId,
      mortgage_rows: [],
      savings_rows: [],
      td_rows: chunk,
      had_signals: input.hadSignals,
    })
  }

  return requests
}

function isDirectExecution(): boolean {
  const entryArg = process.argv[1]
  if (!entryArg) return false
  return resolve(entryArg) === resolve(fileURLToPath(import.meta.url))
}

async function main(): Promise<void> {
  const runId = parseRunId(process.argv.slice(2))
  const apiBase = String(process.env.AR_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '')
  const adminToken = String(process.env.AR_ADMIN_TOKEN || '').trim()
  const workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`

  if (!runId) {
    throw new Error('Missing --run-id <id>')
  }
  if (!adminToken) {
    throw new Error('Missing AR_ADMIN_TOKEN environment variable')
  }

  const authHeaders = {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  }

  console.log(`[start] run_id=${runId} worker_id=${workerId} api_base=${apiBase}`)

  let processedTasks = 0
  while (true) {
    const claim = await withRetries(
      () =>
        fetchJson<ClaimResponse>(`${apiBase}/admin/historical/pull/tasks/claim`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ run_id: runId, worker_id: workerId }),
        }),
      'claim_task',
    )
    if (!claim.ok || !claim.task) {
      console.log(`[done] run_id=${runId} processed_tasks=${processedTasks}`)
      break
    }

    const task = claim.task
    const lender = lendersByCode.get(task.lender_code)
    if (!lender) {
      await withRetries(
        () =>
          fetchJson(`${apiBase}/admin/historical/pull/tasks/${task.task_id}/finalize`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              run_id: runId,
              worker_id: workerId,
              status: 'failed',
              error: `unknown_lender_code:${task.lender_code}`,
            }),
          }),
        'finalize_failed_unknown_lender',
      )
      continue
    }

    console.log(`[task] task_id=${task.task_id} lender=${task.lender_code} date=${task.collection_date}`)
    try {
      const collected = await withRetries(
        () =>
          collectHistoricalDayFromWayback({
            lender,
            collectionDate: task.collection_date,
            endpointCandidates: task.endpoint_candidates,
            productCap: 80,
            maxSeedUrls: 2,
          }),
        `collect_${task.task_id}`,
      )

      const batches = buildBatchRequests({
        runId,
        workerId,
        taskId: task.task_id,
        hadSignals: collected.hadSignals,
        mortgageRows: collected.mortgageRows,
        savingsRows: collected.savingsRows,
        tdRows: collected.tdRows,
      })

      for (const batch of batches) {
        await withRetries(
          () =>
            fetchJson(`${apiBase}/admin/historical/pull/tasks/${task.task_id}/batch`, {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify(batch),
            }),
          `batch_${task.task_id}_${batch.batch_id}`,
        )
      }

      await withRetries(
        () =>
          fetchJson(`${apiBase}/admin/historical/pull/tasks/${task.task_id}/finalize`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              run_id: runId,
              worker_id: workerId,
              status: 'completed',
              had_signals: collected.hadSignals,
            }),
          }),
        `finalize_completed_${task.task_id}`,
      )
      processedTasks += 1
      console.log(
        `[task-complete] task_id=${task.task_id} mortgage=${collected.mortgageRows.length} savings=${collected.savingsRows.length} td=${collected.tdRows.length}`,
      )
    } catch (error) {
      const message = (error as Error)?.message || String(error)
      await withRetries(
        () =>
          fetchJson(`${apiBase}/admin/historical/pull/tasks/${task.task_id}/finalize`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              run_id: runId,
              worker_id: workerId,
              status: 'failed',
              error: message.slice(0, 1800),
            }),
          }),
        `finalize_failed_${task.task_id}`,
      )
      console.error(`[task-failed] task_id=${task.task_id} ${message}`)
    }
  }
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(`[fatal] ${(error as Error)?.stack || String(error)}`)
    process.exit(1)
  })
}
