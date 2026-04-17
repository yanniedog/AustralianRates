/**
 * Precomputed per-section snapshot cache: bundles the small dependencies a page needs
 * (site-ui, filters, overview, latest-all, changes, exec-summary, rba/cpi, report-plot)
 * into one D1 row so the public site can load them in a single request. Refreshed by cron.
 */

import {
  CHART_CACHE_KV_TTL,
  GZIP_PREFIX,
  MAX_UNCOMPRESSED_CHARS,
  gunzipFromBase64,
  gzipToBase64,
  type ChartCacheSection,
} from './chart-cache'

const SNAPSHOT_CACHE_TABLE = 'snapshot_cache'
/** Bump when snapshot payload shape changes so stale rows are ignored. */
const SNAPSHOT_PAYLOAD_VERSION = 1
/** Snapshot considered fresh if built within this many minutes. */
const D1_CACHE_FRESH_MINUTES = 90

export type SnapshotScope = 'default'
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

export async function writeD1SnapshotCache(
  db: D1Database,
  section: ChartCacheSection,
  scope: SnapshotScope,
  payload: SnapshotPayload,
): Promise<void> {
  const rawJson = JSON.stringify({ v: SNAPSHOT_PAYLOAD_VERSION, payload })
  const payloadJson =
    rawJson.length <= MAX_UNCOMPRESSED_CHARS ? rawJson : `${GZIP_PREFIX}${await gzipToBase64(rawJson)}`
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
    if (isNoSuchTableError(error, SNAPSHOT_CACHE_TABLE)) return
    throw error
  }
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
