import {
  completeAdminDownloadJob,
  failAdminDownloadJob,
  type AdminDownloadJobRow,
  type AdminDownloadScope,
  type AdminDownloadStream,
} from '../db/admin-download-jobs'
import { keyColumnsForTable, streamTables, streamScopeDatasets } from '../db/analytics/download-config'
import { type AdminDownloadEnv, writeAdminDownloadArtifact } from './admin-download-artifact-writer'
import { runDatabaseDumpPass } from './admin-download-dump-builder'

type ChangeFeedRow = {
  cursor_id: number
  table_name: string
  entity_key_json: string
  op: string
}

type PayloadObjectRow = {
  content_hash: string
  source_type: string
  first_source_url: string
  content_type: string
  r2_key: string
}

const ROW_BATCH_SIZE = 500

function targetDb(env: AdminDownloadEnv, stream: AdminDownloadStream): D1Database {
  return stream === 'optimized' ? env.READ_DB ?? env.DB : env.DB
}

function buildKey(tableName: string, row: Record<string, unknown>): Record<string, unknown> | null {
  const keyColumns = keyColumnsForTable(tableName)
  if (keyColumns.length === 0) return null
  const key: Record<string, unknown> = {}
  for (const column of keyColumns) key[column] = row[column]
  return key
}

async function readAllTableRows(db: D1Database, tableName: string): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = []
  let offset = 0
  while (true) {
    const result = await db
      .prepare(`SELECT * FROM ${tableName} LIMIT ?1 OFFSET ?2`)
      .bind(ROW_BATCH_SIZE, offset)
      .all<Record<string, unknown>>()
    const chunk = result.results ?? []
    rows.push(...chunk)
    if (chunk.length < ROW_BATCH_SIZE) break
    offset += chunk.length
  }
  return rows
}

async function readRowByKey(
  db: D1Database,
  tableName: string,
  entityKey: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const keyColumns = keyColumnsForTable(tableName)
  if (keyColumns.length === 0) return null
  const where = keyColumns.map((column, index) => `${column} = ?${index + 1}`).join(' AND ')
  const values = keyColumns.map((column) => entityKey[column])
  return db.prepare(`SELECT * FROM ${tableName} WHERE ${where} LIMIT 1`).bind(...values).first<Record<string, unknown>>()
}

async function readChangeFeed(
  db: D1Database,
  input: { stream: AdminDownloadStream; scope: AdminDownloadScope; sinceCursor: number },
): Promise<ChangeFeedRow[]> {
  const tables = streamTables(input.stream, input.scope)
  const datasets = input.stream === 'operational' ? [] : streamScopeDatasets(input.scope)
  const where = ['stream = ?1', 'cursor_id > ?2']
  const binds: Array<string | number> = [input.stream, input.sinceCursor]
  if (tables.length > 0) {
    where.push(`table_name IN (${tables.map((_table, index) => `?${binds.length + index + 1}`).join(', ')})`)
    binds.push(...tables)
  }
  if (input.scope !== 'all' && datasets.length === 1) {
    where.push(`dataset_kind = ?${binds.length + 1}`)
    binds.push(datasets[0])
  }
  const result = await db
    .prepare(
      `SELECT cursor_id, table_name, entity_key_json, op
       FROM download_change_feed
       WHERE ${where.join(' AND ')}
       ORDER BY cursor_id ASC`,
    )
    .bind(...binds)
    .all<ChangeFeedRow>()
  return result.results ?? []
}

async function payloadRowsForSnapshot(db: D1Database, scope: AdminDownloadScope): Promise<PayloadObjectRow[]> {
  const datasets = streamScopeDatasets(scope)
  const where =
    scope === 'all'
      ? ''
      : `WHERE fe.dataset_kind IN (${datasets.map((_dataset, index) => `?${index + 1}`).join(', ')})`
  const result = await db
    .prepare(
      `SELECT DISTINCT
         ro.content_hash,
         ro.source_type,
         ro.first_source_url,
         ro.content_type,
         ro.r2_key
       FROM fetch_events fe
       JOIN raw_objects ro
         ON ro.content_hash = fe.content_hash
       ${where}
       ORDER BY ro.content_hash ASC`,
    )
    .bind(...(scope === 'all' ? [] : datasets))
    .all<PayloadObjectRow>()
  return result.results ?? []
}

async function payloadRowsForDelta(
  env: AdminDownloadEnv,
  scope: AdminDownloadScope,
  changes: ChangeFeedRow[],
): Promise<PayloadObjectRow[]> {
  const datasets = new Set(streamScopeDatasets(scope))
  const fetchEventIds = new Set<number>()
  for (const change of changes) {
    if (change.op !== 'upsert') continue
    const key = JSON.parse(change.entity_key_json) as Record<string, unknown>
    const row = await readRowByKey(env.DB, change.table_name, key)
    const fetchEventId = Number(row?.fetch_event_id ?? 0)
    if (Number.isFinite(fetchEventId) && fetchEventId > 0) fetchEventIds.add(fetchEventId)
  }
  if (fetchEventIds.size === 0) return []
  const rows: PayloadObjectRow[] = []
  const ids = Array.from(fetchEventIds)
  for (let index = 0; index < ids.length; index += ROW_BATCH_SIZE) {
    const batch = ids.slice(index, index + ROW_BATCH_SIZE)
    const placeholders = batch.map((_id, batchIndex) => `?${batchIndex + 1}`).join(', ')
    const result = await env.DB
      .prepare(
        `SELECT DISTINCT
           ro.content_hash,
           ro.source_type,
           ro.first_source_url,
           ro.content_type,
           ro.r2_key
         FROM fetch_events fe
         JOIN raw_objects ro
           ON ro.content_hash = fe.content_hash
         WHERE fe.id IN (${placeholders})`,
      )
      .bind(...batch)
      .all<PayloadObjectRow>()
    for (const row of result.results ?? []) {
      if (scope !== 'all' && !datasets.has((await datasetForPayload(env.DB, row.content_hash)) ?? 'home_loans')) continue
      rows.push(row)
    }
  }
  return rows
}

async function datasetForPayload(db: D1Database, contentHash: string): Promise<'home_loans' | 'savings' | 'term_deposits' | null> {
  const row = await db
    .prepare(
      `SELECT dataset_kind
       FROM fetch_events
       WHERE content_hash = ?1
         AND dataset_kind IS NOT NULL
       ORDER BY fetched_at DESC
       LIMIT 1`,
    )
    .bind(contentHash)
    .first<{ dataset_kind: 'home_loans' | 'savings' | 'term_deposits' }>()
  return row?.dataset_kind ?? null
}

async function buildSnapshotLines(env: AdminDownloadEnv, job: AdminDownloadJobRow): Promise<{ lines: string[]; rowCount: number }> {
  const db = targetDb(env, job.stream)
  const tables = streamTables(job.stream, job.scope)
  const lines = [
    JSON.stringify({
      record_type: 'manifest',
      stream: job.stream,
      scope: job.scope,
      mode: job.mode,
      generated_at: new Date().toISOString(),
      tables,
    }),
  ]
  let rowCount = 0
  for (const tableName of tables) {
    const rows = await readAllTableRows(db, tableName)
    for (const row of rows) {
      lines.push(JSON.stringify({ record_type: 'upsert', table: tableName, key: buildKey(tableName, row), row }))
      rowCount += 1
    }
  }
  return { lines, rowCount }
}


async function buildDeltaLines(env: AdminDownloadEnv, job: AdminDownloadJobRow): Promise<{ lines: string[]; rowCount: number; endCursor: number | null; changes: ChangeFeedRow[] }> {
  const changes = await readChangeFeed(env.DB, {
    stream: job.stream,
    scope: job.scope,
    sinceCursor: Math.max(0, Number(job.since_cursor ?? 0)),
  })
  const db = targetDb(env, job.stream)
  const endCursor = changes.length ? Number(changes[changes.length - 1].cursor_id) : Number(job.since_cursor ?? 0)
  const lines = [
    JSON.stringify({
      record_type: 'manifest',
      stream: job.stream,
      scope: job.scope,
      mode: job.mode,
      generated_at: new Date().toISOString(),
      cursor_start: job.since_cursor ?? 0,
      cursor_end: endCursor,
      change_count: changes.length,
    }),
  ]
  let rowCount = 0
  for (const change of changes) {
    const key = JSON.parse(change.entity_key_json) as Record<string, unknown>
    if (change.op === 'upsert') {
      const row = await readRowByKey(db, change.table_name, key)
      if (row) {
        lines.push(JSON.stringify({ record_type: 'upsert', table: change.table_name, cursor_id: change.cursor_id, key, row }))
      } else {
        lines.push(JSON.stringify({ record_type: 'tombstone', table: change.table_name, cursor_id: change.cursor_id, key }))
      }
    } else {
      lines.push(JSON.stringify({ record_type: 'tombstone', table: change.table_name, cursor_id: change.cursor_id, key }))
    }
    rowCount += 1
  }
  return { lines, rowCount, endCursor, changes }
}

async function buildPayloadLines(
  env: AdminDownloadEnv,
  job: AdminDownloadJobRow,
  changes: ChangeFeedRow[] | null,
): Promise<{ lines: string[]; rowCount: number }> {
  const payloadRows =
    job.mode === 'snapshot'
      ? await payloadRowsForSnapshot(env.DB, job.scope)
      : await payloadRowsForDelta(env, job.scope, changes ?? [])
  const lines = [
    JSON.stringify({
      record_type: 'manifest',
      stream: 'canonical_payloads',
      scope: job.scope,
      mode: job.mode,
      generated_at: new Date().toISOString(),
      payload_count: payloadRows.length,
    }),
  ]
  let rowCount = 0
  for (const row of payloadRows) {
    const object = await env.RAW_BUCKET.get(row.r2_key)
    if (!object) continue
    lines.push(
      JSON.stringify({
        record_type: 'payload',
        content_hash: row.content_hash,
        source_type: row.source_type,
        source_url: row.first_source_url,
        content_type: row.content_type,
        r2_key: row.r2_key,
        body: await object.text(),
      }),
    )
    rowCount += 1
  }
  return { lines, rowCount }
}

export async function runAdminDownloadJob(env: AdminDownloadEnv, job: AdminDownloadJobRow): Promise<void> {
  try {
    if (job.stream === 'operational' && job.mode === 'snapshot') {
      const dump = await runDatabaseDumpPass(env, job)
      if (!dump.done) return
      await completeAdminDownloadJob(env.DB, { jobId: job.job_id, endCursor: null })
      return
    }

    const main =
      job.mode === 'snapshot'
        ? { kind: 'snapshot' as const, ...(await buildSnapshotLines(env, job)) }
        : { kind: 'delta' as const, ...(await buildDeltaLines(env, job)) }
    const endCursor = main.kind === 'delta' ? main.endCursor : null
    await writeAdminDownloadArtifact(
      env,
      env.DB,
      job,
      'main',
      main.lines,
      main.rowCount,
      job.since_cursor ?? null,
      endCursor,
    )
    if (job.stream === 'canonical' && job.include_payload_bodies === 1) {
      const payloads = await buildPayloadLines(env, job, main.kind === 'delta' ? main.changes : null)
      await writeAdminDownloadArtifact(
        env,
        env.DB,
        job,
        'payload_bodies',
        payloads.lines,
        payloads.rowCount,
        job.since_cursor ?? null,
        endCursor,
      )
    }
    await completeAdminDownloadJob(env.DB, { jobId: job.job_id, endCursor })
  } catch (error) {
    await failAdminDownloadJob(env.DB, job.job_id, (error as Error)?.message || String(error))
  }
}
