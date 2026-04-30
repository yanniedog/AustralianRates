/**
 * Precomputed per-section snapshot cache: bundles the small dependencies a page needs
 * (site-ui, filters, overview, latest-all, changes, exec-summary, rba/cpi, report-plot)
 * into one D1 row so the public site can load them in a single request. Refreshed by cron.
 */

import { log } from '../utils/logger'
import { trimSnapshotDataForHtmlInline } from '../utils/snapshot-inline-trim'
import {
  CHART_CACHE_KV_TTL,
  GZIP_PREFIX,
  MAX_UNCOMPRESSED_CHARS,
  gunzipFromBase64,
  gzipToBase64,
  type ChartCacheScope,
  type ChartCacheSection,
} from './chart-cache'

const SNAPSHOT_CACHE_TABLE = 'snapshot_cache'
/** Bump when snapshot payload shape changes so stale rows are ignored. v11 aligns chart window end with latest_* max collection_date; v10 adds slicePairStats; v9 raised the inline snapshot budget for raw home-loan report bundles. */
const SNAPSHOT_PAYLOAD_VERSION = 11
/** Snapshot considered fresh if built within this many minutes. */
const D1_CACHE_FRESH_MINUTES = 90

/** Snapshot scope matches chart-cache scope so the same scope strings cover both caches. */
export type SnapshotScope = ChartCacheScope
export type SnapshotPayload = {
  builtAt: string
  scope: SnapshotScope
  section: ChartCacheSection
  data: Record<string, unknown>
}

export function buildSnapshotKvKey(section: ChartCacheSection, scope: SnapshotScope): string {
  // Include payload version so bumping SNAPSHOT_PAYLOAD_VERSION instantly invalidates all KV keys.
  return `snapshot:v${SNAPSHOT_PAYLOAD_VERSION}:${section}:${scope}`
}

/** Slim KV entry for Pages HTML inlining (same payload version as full `snapshot:v*` keys). */
export function buildSnapshotInlineKvKey(section: ChartCacheSection, scope: SnapshotScope): string {
  return `snapshot-inline:v${SNAPSHOT_PAYLOAD_VERSION}:${section}:${scope}`
}

function isNoSuchTableError(error: unknown, table: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no such table/i.test(message) && message.includes(table)
}

/**
 * Cloudflare KV value size hard limit is 25 MiB; serialized snapshots that
 * exceed this fail on `put` with `400 KV value size of N bytes is over the
 * 25 MiB limit`. Treat anything above this as a refresh failure rather than
 * silently retaining the prior bundle, which is how stale ribbons used to
 * survive ingest cycles for a full day.
 */
const KV_VALUE_BYTE_LIMIT = 25 * 1024 * 1024

/** Writes full snapshot KV plus a byte-capped inline variant for Pages `_middleware`. */
export async function writeSnapshotKvBundles(
  kv: KVNamespace | undefined,
  section: ChartCacheSection,
  scope: SnapshotScope,
  payload: SnapshotPayload,
): Promise<void> {
  if (!kv) return
  const mainKey = buildSnapshotKvKey(section, scope)
  const inlineKey = buildSnapshotInlineKvKey(section, scope)
  const serialized = JSON.stringify(payload)
  const byteLength =
    typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(serialized).length : serialized.length
  if (byteLength > KV_VALUE_BYTE_LIMIT) {
    log.error('snapshot_cache', 'snapshot KV bundle exceeds 25 MiB limit', {
      code: 'snapshot_kv_value_too_large',
      context: `key=${mainKey} bytes=${byteLength} limit=${KV_VALUE_BYTE_LIMIT} chars=${serialized.length}`,
    })
    return
  }
  try {
    await kv.put(mainKey, serialized, { expirationTtl: CHART_CACHE_KV_TTL })
  } catch (error) {
    log.error('snapshot_cache', 'snapshot KV put failed', {
      code: 'snapshot_kv_put_failed',
      error,
      context: `key=${mainKey} bytes=${byteLength}`,
    })
    return
  }
  try {
    const trimmed = trimSnapshotDataForHtmlInline(
      payload.section,
      String(payload.scope),
      payload.builtAt,
      payload.data as Record<string, unknown>,
    )
    if (trimmed) {
      const inlinePayload: SnapshotPayload = { ...payload, data: trimmed }
      await kv.put(inlineKey, JSON.stringify(inlinePayload), { expirationTtl: CHART_CACHE_KV_TTL })
    } else {
      await kv.delete(inlineKey)
    }
  } catch (error) {
    log.warn('snapshot_cache', 'snapshot inline KV write failed', {
      code: 'snapshot_inline_kv_write_failed',
      error,
      context: `key=${inlineKey}`,
    })
  }
}

export async function readD1SnapshotCache(
  db: D1Database,
  section: ChartCacheSection,
  scope: SnapshotScope = 'default',
): Promise<SnapshotPayload | null> {
  let row: { payload_json: string; built_at: string } | null = null
  try {
    row = await db
      .prepare(
        `SELECT payload_json, built_at
         FROM ${SNAPSHOT_CACHE_TABLE}
         WHERE section = ? AND request_scope = ?`,
      )
      .bind(section, scope)
      .first<{ payload_json: string; built_at: string }>()
  } catch (error) {
    if (isNoSuchTableError(error, SNAPSHOT_CACHE_TABLE)) return null
    throw error
  }
  if (!row?.payload_json) return null

  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() - D1_CACHE_FRESH_MINUTES)
  if (new Date(row.built_at) < cutoff) return null

  try {
    const payloadText = row.payload_json.startsWith(GZIP_PREFIX)
      ? await gunzipFromBase64(row.payload_json.slice(GZIP_PREFIX.length))
      : row.payload_json
    const parsed = JSON.parse(payloadText) as { v?: number; payload?: SnapshotPayload }
    if (!parsed || parsed.v !== SNAPSHOT_PAYLOAD_VERSION || !parsed.payload) return null
    return parsed.payload
  } catch {
    return null
  }
}

/** Hard ceiling for a single stored snapshot row (uncompressed+base64 size). Beyond this we log and store anyway — callers that care about size should drop heavy fields before calling. */
const SNAPSHOT_SIZE_WARN_CHARS = 2_000_000

export async function writeD1SnapshotCache(
  db: D1Database,
  section: ChartCacheSection,
  scope: SnapshotScope,
  payload: SnapshotPayload,
): Promise<{ rawBytes: number; storedBytes: number; compressed: boolean }> {
  const rawJson = JSON.stringify({ v: SNAPSHOT_PAYLOAD_VERSION, payload })
  const compressed = rawJson.length > MAX_UNCOMPRESSED_CHARS
  const payloadJson = compressed ? `${GZIP_PREFIX}${await gzipToBase64(rawJson)}` : rawJson
  const rawBytes = rawJson.length
  const storedBytes = payloadJson.length
  if (storedBytes > SNAPSHOT_SIZE_WARN_CHARS) {
    log.warn('snapshot_cache', 'Snapshot row exceeds soft size ceiling', {
      code: 'snapshot_payload_oversize',
      context: JSON.stringify({ section, scope, rawBytes, storedBytes, compressed }),
    })
  } else {
    log.info('snapshot_cache', 'Snapshot row written', {
      context: `section=${section} scope=${scope} raw=${rawBytes} stored=${storedBytes} compressed=${compressed ? 1 : 0}`,
    })
  }
  try {
    await db
      .prepare(
        `INSERT INTO ${SNAPSHOT_CACHE_TABLE} (section, request_scope, payload_json, built_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (section, request_scope) DO UPDATE SET
           payload_json = excluded.payload_json,
           built_at = excluded.built_at`,
      )
      .bind(section, scope, payloadJson, payload.builtAt)
      .run()
  } catch (error) {
    if (isNoSuchTableError(error, SNAPSHOT_CACHE_TABLE)) return { rawBytes, storedBytes, compressed }
    throw error
  }
  return { rawBytes, storedBytes, compressed }
}

export async function getCachedOrComputeSnapshot(
  env: { DB: D1Database; CHART_CACHE_KV?: KVNamespace },
  section: ChartCacheSection,
  scope: SnapshotScope,
  compute: () => Promise<SnapshotPayload>,
  options?: { allowD1Fallback?: boolean; allowLiveCompute?: boolean },
): Promise<SnapshotPayload & { fromCache: 'kv' | 'd1' | 'live' }> {
  const kvKey = buildSnapshotKvKey(section, scope)
  if (env.CHART_CACHE_KV) {
    const kvCached = await env.CHART_CACHE_KV.get(kvKey)
    if (kvCached) {
      try {
        const payload = JSON.parse(kvCached) as SnapshotPayload
        await writeSnapshotKvBundles(env.CHART_CACHE_KV, section, scope, payload)
        return { ...payload, fromCache: 'kv' }
      } catch {
        /* ignore invalid KV entry */
      }
    }
  }

  if (options?.allowD1Fallback !== false) {
    const d1Cached = await readD1SnapshotCache(env.DB, section, scope)
    if (d1Cached) {
      await writeSnapshotKvBundles(env.CHART_CACHE_KV, section, scope, d1Cached)
      return { ...d1Cached, fromCache: 'd1' }
    }
  }

  if (options?.allowLiveCompute === false) {
    throw new Error(`snapshot_cache_miss:${section}:${scope}`)
  }

  const payload = await compute()
  try {
    await writeD1SnapshotCache(env.DB, section, scope, payload)
  } catch {
    /* ignore D1 write failure on live requests */
  }
  await writeSnapshotKvBundles(env.CHART_CACHE_KV, section, scope, payload)
  return { ...payload, fromCache: 'live' }
}
