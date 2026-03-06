import type { DatasetKind, FetchEvent, IngestTaskKind } from '../../../../packages/shared/src'
import { buildRawR2Key } from '../utils/idempotency'
import { sha256HexFromBytes } from '../utils/hash'
import { nowIso } from '../utils/time'

type RawEnv = {
  DB: D1Database
  RAW_BUCKET: R2Bucket
}

type PersistFetchInput = {
  sourceType: string
  sourceUrl: string
  payload: unknown
  fetchedAtIso?: string
  httpStatus?: number | null
  notes?: string | null
  runId?: string | null
  lenderCode?: string | null
  dataset?: DatasetKind | null
  jobKind?: IngestTaskKind | string | null
  collectionDate?: string | null
  durationMs?: number | null
  productId?: string | null
  responseHeaders?: Headers | Record<string, string> | null
}

export type PersistFetchResult = {
  insertedObject: boolean
  contentHash: string
  r2Key: string
  fetchEventId: number | null
  rawObjectCreated: boolean
  bodyBytes: number
}

export type FetchEventRecord = FetchEvent & {
  id: number
  r2Key?: string | null
  contentType?: string | null
}

function contentTypeForSource(sourceType: string): string {
  return sourceType === 'wayback_html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'
}

function serializePayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload instanceof Uint8Array) return new TextDecoder().decode(payload)
  if (payload instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(payload))
  try {
    return JSON.stringify(payload ?? null, null, 2)
  } catch {
    return JSON.stringify({ fallback: String(payload) })
  }
}

function headersJson(headers: Headers | Record<string, string> | null | undefined): string | null {
  if (!headers) return null
  const entries: Record<string, string> = {}
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      entries[key] = value
    })
  } else {
    for (const [key, value] of Object.entries(headers)) entries[key] = String(value)
  }
  return JSON.stringify(entries)
}

export async function persistFetchEvent(env: RawEnv, input: PersistFetchInput): Promise<PersistFetchResult> {
  const fetchedAtIso = input.fetchedAtIso || nowIso()
  const payloadText = serializePayload(input.payload)
  const payloadBytes = new TextEncoder().encode(payloadText)
  const bodyBytes = payloadBytes.byteLength
  const contentHash = await sha256HexFromBytes(payloadBytes)
  const contentType = contentTypeForSource(input.sourceType)

  const existingObject = await env.DB
    .prepare(
      `SELECT content_hash, r2_key
       FROM raw_objects
       WHERE content_hash = ?1
       LIMIT 1`,
    )
    .bind(contentHash)
    .first<{ content_hash: string; r2_key: string }>()

  const r2Key = existingObject?.r2_key || buildRawR2Key(input.sourceType, fetchedAtIso, contentHash)
  const rawObjectCreated = !existingObject

  if (!existingObject) {
    await env.RAW_BUCKET.put(r2Key, payloadText, {
      httpMetadata: { contentType },
      customMetadata: {
        source_type: input.sourceType,
        source_url: input.sourceUrl,
        content_hash: contentHash,
      },
    })

    await env.DB
      .prepare(
        `INSERT INTO raw_objects (
           content_hash, source_type, first_source_url, body_bytes, content_type, r2_key, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(contentHash, input.sourceType, input.sourceUrl, bodyBytes, contentType, r2Key, fetchedAtIso)
      .run()
  }

  const inserted = await env.DB
    .prepare(
      `INSERT INTO fetch_events (
         run_id, lender_code, dataset_kind, job_kind, source_type, source_url, collection_date, fetched_at, http_status,
         content_hash, body_bytes, response_headers_json, duration_ms, product_id, raw_object_created, notes
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    )
    .bind(
      input.runId ?? null,
      input.lenderCode ?? null,
      input.dataset ?? null,
      input.jobKind ?? null,
      input.sourceType,
      input.sourceUrl,
      input.collectionDate ?? null,
      fetchedAtIso,
      input.httpStatus == null ? null : Math.floor(input.httpStatus),
      contentHash,
      bodyBytes,
      headersJson(input.responseHeaders),
      input.durationMs == null ? null : Math.max(0, Math.floor(input.durationMs)),
      input.productId ?? null,
      rawObjectCreated ? 1 : 0,
      input.notes ?? null,
    )
    .run()

  return {
    insertedObject: rawObjectCreated,
    contentHash,
    r2Key,
    fetchEventId: Number(inserted.meta?.last_row_id || 0) || null,
    rawObjectCreated,
    bodyBytes,
  }
}

export async function getRecentFetchEvents(
  db: D1Database,
  input: {
    dataset?: DatasetKind
    lenderCode?: string
    sourceType?: string
    sourceTypePrefix?: string
    limit?: number
  } = {},
): Promise<FetchEvent[]> {
  const where: string[] = []
  const binds: Array<string | number> = []
  if (input.dataset) {
    where.push('dataset_kind = ?')
    binds.push(input.dataset)
  }
  if (input.lenderCode) {
    where.push('lender_code = ?')
    binds.push(input.lenderCode)
  }
  if (input.sourceType) {
    where.push('source_type = ?')
    binds.push(input.sourceType)
  }
  if (input.sourceTypePrefix) {
    where.push('source_type LIKE ?')
    binds.push(`${input.sourceTypePrefix}%`)
  }
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(input.limit) || 100)))
  binds.push(limit)

  const sql = `SELECT
      id, run_id, lender_code, dataset_kind, job_kind, source_type, source_url, collection_date, fetched_at,
      http_status, content_hash, body_bytes, response_headers_json, duration_ms, product_id, raw_object_created, notes
    FROM fetch_events
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY fetched_at DESC
    LIMIT ?`

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return (result.results ?? []).map(mapFetchEventRow)
}

function mapFetchEventRow(row: Record<string, unknown>): FetchEventRecord {
  return {
    id: Number(row.id ?? 0),
    runId: row.run_id == null ? null : String(row.run_id),
    lenderCode: row.lender_code == null ? null : String(row.lender_code),
    dataset: row.dataset_kind == null ? null : (String(row.dataset_kind) as DatasetKind),
    jobKind: row.job_kind == null ? null : (String(row.job_kind) as IngestTaskKind),
    sourceType: String(row.source_type ?? ''),
    sourceUrl: String(row.source_url ?? ''),
    collectionDate: row.collection_date == null ? null : String(row.collection_date),
    fetchedAt: String(row.fetched_at ?? ''),
    httpStatus: row.http_status == null ? null : Number(row.http_status),
    contentHash: String(row.content_hash ?? ''),
    bodyBytes: Number(row.body_bytes ?? 0),
    responseHeadersJson: row.response_headers_json == null ? null : String(row.response_headers_json),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    productId: row.product_id == null ? null : String(row.product_id),
    rawObjectCreated: String(row.raw_object_created ?? '0') === '1' || row.raw_object_created === 1,
    notes: row.notes == null ? null : String(row.notes),
    r2Key: row.r2_key == null ? null : String(row.r2_key),
    contentType: row.content_type == null ? null : String(row.content_type),
  }
}

export async function getFetchEventById(
  db: D1Database,
  fetchEventId: number,
): Promise<FetchEventRecord | null> {
  const row = await db
    .prepare(
      `SELECT
         fe.id,
         fe.run_id,
         fe.lender_code,
         fe.dataset_kind,
         fe.job_kind,
         fe.source_type,
         fe.source_url,
         fe.collection_date,
         fe.fetched_at,
         fe.http_status,
         fe.content_hash,
         fe.body_bytes,
         fe.response_headers_json,
         fe.duration_ms,
         fe.product_id,
         fe.raw_object_created,
         fe.notes,
         ro.r2_key,
         ro.content_type
       FROM fetch_events fe
       LEFT JOIN raw_objects ro
         ON ro.content_hash = fe.content_hash
       WHERE fe.id = ?1
       LIMIT 1`,
    )
    .bind(Math.max(1, Math.floor(fetchEventId)))
    .first<Record<string, unknown>>()
  if (!row) return null
  return mapFetchEventRow(row)
}
