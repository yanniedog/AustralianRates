import type { DatasetKind } from '../../../../packages/shared/src'
import type { IngestMessage } from '../types'

export type ReplayQueueStatus = 'queued' | 'dispatching' | 'succeeded' | 'failed'

export type ReplayQueueRow = {
  replay_id: string
  replay_key: string
  message_kind: IngestMessage['kind']
  payload_json: string
  run_id: string | null
  lender_code: string | null
  dataset_kind: DatasetKind | null
  product_id: string | null
  collection_date: string | null
  queue_exhausted_count: number
  replay_attempt_count: number
  max_replay_attempts: number
  status: ReplayQueueStatus
  last_error: string | null
  next_attempt_at: string
  last_attempt_at: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

type ReplayScope = {
  runId: string | null
  lenderCode: string | null
  datasetKind: DatasetKind | null
  productId: string | null
  collectionDate: string | null
}

function asText(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text ? text : null
}

function scopeForMessage(message: IngestMessage): ReplayScope {
  if (message.kind === 'product_detail_fetch') {
    return {
      runId: message.runId,
      lenderCode: message.lenderCode,
      datasetKind: message.dataset,
      productId: message.productId,
      collectionDate: message.collectionDate,
    }
  }
  if (message.kind === 'lender_finalize') {
    return {
      runId: message.runId,
      lenderCode: message.lenderCode,
      datasetKind: message.dataset,
      productId: null,
      collectionDate: message.collectionDate,
    }
  }
  if (message.kind === 'daily_lender_fetch' || message.kind === 'daily_savings_lender_fetch' || message.kind === 'backfill_day_fetch') {
    return {
      runId: message.runId,
      lenderCode: message.lenderCode,
      datasetKind: null,
      productId: null,
      collectionDate: message.collectionDate,
    }
  }
  if (message.kind === 'backfill_snapshot_fetch') {
    return {
      runId: message.runId,
      lenderCode: message.lenderCode,
      datasetKind: null,
      productId: message.seedUrl,
      collectionDate: message.monthCursor,
    }
  }
  return {
    runId: message.runId,
    lenderCode: null,
    datasetKind: null,
    productId: String(message.taskId),
    collectionDate: null,
  }
}

function replayKeyPart(value: string | null): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function buildReplayKey(message: IngestMessage): string {
  const scope = scopeForMessage(message)
  return [
    replayKeyPart(message.kind),
    replayKeyPart(scope.runId),
    replayKeyPart(scope.lenderCode),
    replayKeyPart(scope.datasetKind),
    replayKeyPart(scope.productId),
    replayKeyPart(scope.collectionDate),
    replayKeyPart(message.idempotencyKey),
  ].join(':')
}

function payloadJson(message: IngestMessage): string {
  return JSON.stringify({
    ...message,
    replayTicketId: undefined,
    replayAttempt: undefined,
  })
}

function nextAttemptIso(baseDelaySeconds: number, replayAttemptCount: number): string {
  const delaySeconds = Math.max(60, Math.floor(baseDelaySeconds)) * Math.max(1, 2 ** Math.max(0, replayAttemptCount))
  return new Date(Date.now() + delaySeconds * 1000).toISOString()
}

export async function getReplayQueueRow(
  db: D1Database,
  replayId: string,
): Promise<ReplayQueueRow | null> {
  const row = await db
    .prepare(
      `SELECT
         replay_id, replay_key, message_kind, payload_json, run_id, lender_code, dataset_kind, product_id,
         collection_date, queue_exhausted_count, replay_attempt_count, max_replay_attempts, status,
         last_error, next_attempt_at, last_attempt_at, resolved_at, created_at, updated_at
       FROM ingest_replay_queue
       WHERE replay_id = ?1`,
    )
    .bind(replayId)
    .first<ReplayQueueRow>()
  return row ?? null
}

export async function queueReplayFromExhaustedMessage(
  db: D1Database,
  input: {
    message: IngestMessage
    errorMessage: string
    maxReplayAttempts: number
    baseDelaySeconds: number
  },
): Promise<ReplayQueueRow> {
  const scope = scopeForMessage(input.message)
  const replayKey = buildReplayKey(input.message)
  const now = new Date().toISOString()
  const nextAttemptAt = nextAttemptIso(input.baseDelaySeconds, 0)
  const replayId = crypto.randomUUID()

  await db
    .prepare(
      `INSERT INTO ingest_replay_queue (
         replay_id, replay_key, message_kind, payload_json, run_id, lender_code, dataset_kind, product_id,
         collection_date, queue_exhausted_count, replay_attempt_count, max_replay_attempts, status, last_error,
         next_attempt_at, last_attempt_at, resolved_at, created_at, updated_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
         ?9, 1, 0, ?10, 'queued', ?11,
         ?12, NULL, NULL, ?13, ?13
       )
       ON CONFLICT(replay_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         run_id = excluded.run_id,
         lender_code = excluded.lender_code,
         dataset_kind = excluded.dataset_kind,
         product_id = excluded.product_id,
         collection_date = excluded.collection_date,
         queue_exhausted_count = ingest_replay_queue.queue_exhausted_count + 1,
         max_replay_attempts = excluded.max_replay_attempts,
         status = CASE
           WHEN ingest_replay_queue.status = 'succeeded' THEN ingest_replay_queue.status
           WHEN ingest_replay_queue.status = 'failed' THEN ingest_replay_queue.status
           ELSE 'queued'
         END,
         last_error = excluded.last_error,
         next_attempt_at = CASE
           WHEN ingest_replay_queue.status IN ('succeeded', 'failed') THEN ingest_replay_queue.next_attempt_at
           ELSE excluded.next_attempt_at
         END,
         updated_at = excluded.updated_at`,
    )
    .bind(
      replayId,
      replayKey,
      input.message.kind,
      payloadJson(input.message),
      scope.runId,
      scope.lenderCode,
      scope.datasetKind,
      scope.productId,
      scope.collectionDate,
      Math.max(1, Math.floor(input.maxReplayAttempts)),
      input.errorMessage.slice(0, 2000),
      nextAttemptAt,
      now,
    )
    .run()

  const row = await db
    .prepare(
      `SELECT
         replay_id, replay_key, message_kind, payload_json, run_id, lender_code, dataset_kind, product_id,
         collection_date, queue_exhausted_count, replay_attempt_count, max_replay_attempts, status,
         last_error, next_attempt_at, last_attempt_at, resolved_at, created_at, updated_at
       FROM ingest_replay_queue
       WHERE replay_key = ?1`,
    )
    .bind(replayKey)
    .first<ReplayQueueRow>()
  if (!row) {
    throw new Error(`replay_queue_upsert_failed:${replayKey}`)
  }
  return row
}

export async function claimReplayQueueRows(
  db: D1Database,
  input: {
    limit: number
    lenderCode?: string
    collectionDate?: string
    dataset?: DatasetKind
    forceDue?: boolean
  },
): Promise<ReplayQueueRow[]> {
  const now = new Date().toISOString()
  const where = [`status = 'queued'`]
  const binds: Array<string | number> = []
  if (!input.forceDue) {
    where.push(`next_attempt_at <= ?${binds.length + 1}`)
    binds.push(now)
  }
  if (input.lenderCode) {
    where.push(`lender_code = ?${binds.length + 1}`)
    binds.push(input.lenderCode)
  }
  if (input.collectionDate) {
    where.push(`collection_date = ?${binds.length + 1}`)
    binds.push(input.collectionDate)
  }
  if (input.dataset) {
    where.push(`dataset_kind = ?${binds.length + 1}`)
    binds.push(input.dataset)
  }
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit || 50)))
  binds.push(limit)

  const rowsResult = await db
    .prepare(
      `SELECT
         replay_id, replay_key, message_kind, payload_json, run_id, lender_code, dataset_kind, product_id,
         collection_date, queue_exhausted_count, replay_attempt_count, max_replay_attempts, status,
         last_error, next_attempt_at, last_attempt_at, resolved_at, created_at, updated_at
       FROM ingest_replay_queue
       WHERE ${where.join(' AND ')}
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT ?${binds.length}`,
    )
    .bind(...binds)
    .all<ReplayQueueRow>()

  const claimed: ReplayQueueRow[] = []
  for (const row of rowsResult.results ?? []) {
    const update = await db
      .prepare(
        `UPDATE ingest_replay_queue
         SET status = 'dispatching',
             replay_attempt_count = replay_attempt_count + 1,
             last_attempt_at = ?1,
             updated_at = ?1
         WHERE replay_id = ?2
           AND status = 'queued'`,
      )
      .bind(now, row.replay_id)
      .run()
    if (Number(update.meta?.changes ?? 0) <= 0) continue
    claimed.push({
      ...row,
      status: 'dispatching',
      replay_attempt_count: Number(row.replay_attempt_count || 0) + 1,
      last_attempt_at: now,
      updated_at: now,
    })
  }

  return claimed
}

export async function markReplayQueueSuccess(db: D1Database, replayId: string): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE ingest_replay_queue
       SET status = 'succeeded',
           resolved_at = ?1,
           updated_at = ?1
       WHERE replay_id = ?2`,
    )
    .bind(now, replayId)
    .run()
}

export async function rescheduleReplayQueueRow(
  db: D1Database,
  input: {
    replayId: string
    errorMessage: string
    baseDelaySeconds: number
  },
): Promise<ReplayQueueRow | null> {
  const existing = await getReplayQueueRow(db, input.replayId)
  if (!existing) return null
  const now = new Date().toISOString()
  const exceededBudget = Number(existing.replay_attempt_count || 0) >= Number(existing.max_replay_attempts || 0)
  const nextAttemptAt = exceededBudget
    ? existing.next_attempt_at
    : nextAttemptIso(input.baseDelaySeconds, Number(existing.replay_attempt_count || 0))

  await db
    .prepare(
      `UPDATE ingest_replay_queue
       SET status = ?1,
           last_error = ?2,
           next_attempt_at = ?3,
           resolved_at = CASE WHEN ?1 = 'failed' THEN ?4 ELSE NULL END,
           updated_at = ?4
       WHERE replay_id = ?5`,
    )
    .bind(
      exceededBudget ? 'failed' : 'queued',
      input.errorMessage.slice(0, 2000),
      nextAttemptAt,
      now,
      input.replayId,
    )
    .run()

  return getReplayQueueRow(db, input.replayId)
}

export async function listReplayQueueRows(
  db: D1Database,
  input: {
    status?: ReplayQueueStatus
    limit?: number
  } = {},
): Promise<ReplayQueueRow[]> {
  const where: string[] = []
  const binds: Array<string | number> = []
  if (input.status) {
    where.push(`status = ?${binds.length + 1}`)
    binds.push(input.status)
  }
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit || 50)))
  binds.push(limit)

  const result = await db
    .prepare(
      `SELECT
         replay_id, replay_key, message_kind, payload_json, run_id, lender_code, dataset_kind, product_id,
         collection_date, queue_exhausted_count, replay_attempt_count, max_replay_attempts, status,
         last_error, next_attempt_at, last_attempt_at, resolved_at, created_at, updated_at
       FROM ingest_replay_queue
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY updated_at DESC
       LIMIT ?${binds.length}`,
    )
    .bind(...binds)
    .all<ReplayQueueRow>()

  return result.results ?? []
}

export function parseReplayPayload(row: ReplayQueueRow): IngestMessage {
  const parsed = JSON.parse(row.payload_json) as IngestMessage
  return parsed
}

export function replayScopeSummary(row: ReplayQueueRow): string {
  return [
    row.message_kind,
    asText(row.lender_code),
    asText(row.dataset_kind),
    asText(row.product_id),
    asText(row.collection_date),
  ]
    .filter(Boolean)
    .join('|')
}
