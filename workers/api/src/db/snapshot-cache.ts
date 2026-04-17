/**
 * Precomputed per-section snapshot cache: bundles the small dependencies a page needs
 * (site-ui, filters, overview, latest-all, changes, exec-summary, rba/cpi, report-plot)
 * into one D1 row so the public site can load them in a single request. Refreshed by cron.
 */

import { log } from '../utils/logger'
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
/** Bump when snapshot payload shape changes so stale rows are ignored. v3: analyticsSeries switched from flat rows to grouped_v1. */
const SNAPSHOT_PAYLOAD_VERSION = 3
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

function buildSnapshotKvKey(section: ChartCacheSection, scope: SnapshotScope): string {
  return `snapshot:${section}:${scope}`
}

function isNoSuchTableError(error: unknown, table: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no such table/i.test(message) && message.includes(table)
}

async function writeSnapshotToKv(
  kv: KVNamespace | undefined,
  key: string,
  payload: SnapshotPayload,
): Promise<void> {
  if (!kv) return
  try {
    await kv.put(key, JSON.stringify(payload), { expirationTtl: CHART_CACHE_KV_TTL })
  } catch {
    /* ignore KV write failure */
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
): Promise<SnapshotPayload & { fromCache: 'kv' | 'd1' | 'live' }> {
  const kvKey = buildSnapshotKvKey(section, scope)
  if (env.CHART_CACHE_KV) {
    const kvCached = await env.CHART_CACHE_KV.get(kvKey)
    if (kvCached) {
      try {
        return { ...(JSON.parse(kvCached) as SnapshotPayload), fromCache: 'kv' }
      } catch {
        /* ignore invalid KV entry */
      }
    }
  }

  const d1Cached = await readD1SnapshotCache(env.DB, section, scope)
  if (d1Cached) {
    await writeSnapshotToKv(env.CHART_CACHE_KV, kvKey, d1Cached)
    return { ...d1Cached, fromCache: 'd1' }
  }

  const payload = await compute()
  try {
    await writeD1SnapshotCache(env.DB, section, scope, payload)
  } catch {
    /* ignore D1 write failure on live requests */
  }
  await writeSnapshotToKv(env.CHART_CACHE_KV, kvKey, payload)
  return { ...payload, fromCache: 'live' }
}
