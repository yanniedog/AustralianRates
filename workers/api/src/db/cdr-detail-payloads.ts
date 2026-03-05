import { gzipCompressText, gzipDecompressToText } from '../utils/compression'
import { sha256HexFromText } from '../utils/hash'

// Keep SQL bind count safely below D1's variable cap (currently 100).
const HASH_BATCH_SIZE = 80
const D1_ROW_LIMIT_BYTES = 2_000_000

type HydratableRow = Record<string, unknown>

type PayloadRow = {
  payload_hash: string
  encoding: string
  payload_blob: ArrayBuffer | Uint8Array | null
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

function blobToBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return null
}

async function loadPayloadMap(db: D1Database, hashes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const batch of chunkValues(hashes, HASH_BATCH_SIZE)) {
    if (batch.length === 0) continue
    const placeholders = batch.map(() => '?').join(', ')
    const sql = `
      SELECT payload_hash, encoding, payload_blob
      FROM cdr_detail_payload_store
      WHERE payload_hash IN (${placeholders})
    `
    const result = await db.prepare(sql).bind(...batch).all<PayloadRow>()
    const rows = Array.isArray(result.results) ? result.results : []
    for (const row of rows) {
      const payloadHash = String(row.payload_hash ?? '').trim()
      if (!payloadHash) continue

      const bytes = blobToBytes(row.payload_blob)
      if (!bytes) continue

      const encoding = String(row.encoding ?? '').trim().toLowerCase()
      if (encoding !== 'gzip') continue

      try {
        const jsonText = await gzipDecompressToText(bytes)
        out.set(payloadHash, jsonText)
      } catch {
        continue
      }
    }
  }
  return out
}

export async function storeCdrDetailPayload(db: D1Database, json: string): Promise<string> {
  const payloadHash = await sha256HexFromText(json)
  const uncompressedBytes = new TextEncoder().encode(json).byteLength
  const compressedPayload = await gzipCompressText(json)
  const compressedBytes = compressedPayload.byteLength

  if (compressedBytes > D1_ROW_LIMIT_BYTES) {
    throw new Error(
      `cdr_detail_payload_too_large hash=${payloadHash} compressed_bytes=${compressedBytes} limit=${D1_ROW_LIMIT_BYTES}`,
    )
  }

  await db
    .prepare(
      `INSERT INTO cdr_detail_payload_store (
         payload_hash, encoding, payload_blob, uncompressed_bytes, compressed_bytes
       ) VALUES (?1, 'gzip', ?2, ?3, ?4)
       ON CONFLICT(payload_hash) DO NOTHING`,
    )
    .bind(payloadHash, compressedPayload, uncompressedBytes, compressedBytes)
    .run()

  return payloadHash
}

export async function hydrateCdrDetailJson<T extends HydratableRow>(db: D1Database, rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows

  const hashes = new Set<string>()
  for (const row of rows) {
    const hash = typeof row.cdr_product_detail_hash === 'string' ? row.cdr_product_detail_hash.trim() : ''
    if (!hash) continue
    const hasInline = typeof row.cdr_product_detail_json === 'string' && row.cdr_product_detail_json.length > 0
    if (!hasInline) hashes.add(hash)
  }

  const payloadMap = hashes.size > 0 ? await loadPayloadMap(db, Array.from(hashes)) : new Map<string, string>()

  return rows.map((row) => {
    const next = { ...row } as Record<string, unknown>
    const hash = typeof next.cdr_product_detail_hash === 'string' ? next.cdr_product_detail_hash.trim() : ''
    const existingJson = typeof next.cdr_product_detail_json === 'string' ? next.cdr_product_detail_json : null

    if (!existingJson && hash) {
      next.cdr_product_detail_json = payloadMap.get(hash) ?? null
    }

    if (!('cdr_product_detail_json' in next)) {
      next.cdr_product_detail_json = null
    }

    delete next.cdr_product_detail_hash
    return next as T
  })
}
