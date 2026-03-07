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

async function getRawObjectByHash(
  db: D1Database,
  contentHash: string,
): Promise<{ content_hash: string; r2_key: string } | null> {
  return db
    .prepare(
      `SELECT content_hash, r2_key
       FROM raw_objects
       WHERE content_hash = ?1
       LIMIT 1`,
    )
    .bind(contentHash)
    .first<{ content_hash: string; r2_key: string }>()
}

export async function persistFetchEvent(env: RawEnv, input: PersistFetchInput): Promise<PersistFetchResult> {
  const fetchedAtIso = input.fetchedAtIso || nowIso()
  const payloadText = serializePayload(input.payload)
  const payloadBytes = new TextEncoder().encode(payloadText)
  const bodyBytes = payloadBytes.byteLength
  const contentHash = await sha256HexFromBytes(payloadBytes)
  const contentType = contentTypeForSource(input.sourceType)
  const generatedR2Key = buildRawR2Key(input.sourceType, fetchedAtIso, contentHash)

  let rawObject = await getRawObjectByHash(env.DB, contentHash)
  let rawObjectCreated = false

  if (!rawObject) {
    await env.RAW_BUCKET.put(generatedR2Key, payloadText, {
      httpMetadata: { contentType },
      customMetadata: {
        source_type: input.sourceType,
        source_url: input.sourceUrl,
        content_hash: contentHash,
      },
    })

    const insertedRawObject = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO raw_objects (
           content_hash, source_type, first_source_url, body_bytes, content_type, r2_key, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(contentHash, input.sourceType, input.sourceUrl, bodyBytes, contentType, generatedR2Key, fetchedAtIso)
      .run()

    rawObjectCreated = Number(insertedRawObject.meta?.changes || 0) > 0
    if (rawObjectCreated) {
      rawObject = {
        content_hash: contentHash,
        r2_key: generatedR2Key,
      }
    } else {
      rawObject = await getRawObjectByHash(env.DB, contentHash)
      if (!rawObject) {
        throw new Error(`raw_object_persist_failed:${contentHash}`)
      }
    }
  }

  const r2Key = rawObject.r2_key

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

  let fetchEventId = Number(inserted.meta?.last_row_id || 0) || null
  if (fetchEventId == null) {
    // D1 can omit last_row_id for successful inserts, so recover the row id by payload identity.
    fetchEventId = await resolveFetchEventIdByPayloadIdentity(env.DB, {
      runId: input.runId ?? null,
      lenderCode: input.lenderCode ?? null,
      dataset: input.dataset ?? null,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      contentHash,
      productId: input.productId ?? null,
      collectionDate: input.collectionDate ?? null,
    })
  }

  return {
    insertedObject: rawObjectCreated,
    contentHash,
    r2Key,
    fetchEventId,
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

export async function resolveFetchEventIdByPayloadIdentity(
  db: D1Database,
  input: {
    runId?: string | null
    lenderCode?: string | null
    dataset?: DatasetKind | null
    sourceType: string
    sourceUrl: string
    contentHash: string
    productId?: string | null
    collectionDate?: string | null
  },
): Promise<number | null> {
  const exact = await db
    .prepare(
      `SELECT id
       FROM fetch_events
       WHERE source_type = ?1
         AND source_url = ?2
         AND content_hash = ?3
         AND ((run_id IS NULL AND ?4 IS NULL) OR run_id = ?4)
         AND ((lender_code IS NULL AND ?5 IS NULL) OR lender_code = ?5)
         AND ((dataset_kind IS NULL AND ?6 IS NULL) OR dataset_kind = ?6)
         AND ((product_id IS NULL AND ?7 IS NULL) OR product_id = ?7)
         AND ((collection_date IS NULL AND ?8 IS NULL) OR collection_date = ?8)
       ORDER BY fetched_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(
      input.sourceType,
      input.sourceUrl,
      input.contentHash,
      input.runId ?? null,
      input.lenderCode ?? null,
      input.dataset ?? null,
      input.productId ?? null,
      input.collectionDate ?? null,
    )
    .first<{ id: number }>()

  if (exact?.id != null) {
    return Number(exact.id)
  }

  const fallback = await db
    .prepare(
      `SELECT id
       FROM fetch_events
       WHERE source_type = ?1
         AND content_hash = ?2
         AND ((run_id IS NULL AND ?3 IS NULL) OR run_id = ?3)
         AND ((lender_code IS NULL AND ?4 IS NULL) OR lender_code = ?4)
         AND ((dataset_kind IS NULL AND ?5 IS NULL) OR dataset_kind = ?5)
       ORDER BY fetched_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(
      input.sourceType,
      input.contentHash,
      input.runId ?? null,
      input.lenderCode ?? null,
      input.dataset ?? null,
    )
    .first<{ id: number }>()

  return fallback?.id == null ? null : Number(fallback.id)
}
