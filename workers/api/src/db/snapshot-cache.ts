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
import { getMelbourneNowParts } from '../utils/time'
import { getLatestCompletedDailyRunFinishedAt } from './run-reports'
import {
  isPublicDailyCacheFresh,
  publicCacheMetadata,
  type PublicCacheMetadata,
} from './public-cache-freshness'

const SNAPSHOT_CACHE_TABLE = 'snapshot_cache'
/** Bump when snapshot payload shape changes so stale rows are ignored. v11 aligns chart window end with latest_* max collection_date; v10 adds slicePairStats; v9 raised the inline snapshot budget for raw home-loan report bundles. */
const SNAPSHOT_PAYLOAD_VERSION = 11

/** Snapshot scope matches chart-cache scope so the same scope strings cover both caches. */
export type SnapshotScope = ChartCacheScope
export type SnapshotPayload = {
  builtAt: string
  scope: SnapshotScope
  section: ChartCacheSection
  sourceRunFinishedAt?: string | null
  data: Record<string, unknown>
}

function snapshotFiltersResolved(payload: SnapshotPayload): PublicCacheMetadata['filtersResolved'] {
  return (payload.data as { filtersResolved?: { startDate?: string; endDate?: string } } | undefined)
    ?.filtersResolved
}

function isSnapshotPayloadFresh(payload: SnapshotPayload): boolean {
  return isPublicDailyCacheFresh({
    builtAt: payload.builtAt,
    filtersResolved: snapshotFiltersResolved(payload),
    sourceRunFinishedAt: payload.sourceRunFinishedAt ?? null,
  })
}

export function buildSnapshotKvKey(section: ChartCacheSection, scope: SnapshotScope, melbourneDate?: string): string {
  // Include Melbourne date so snapshots don't serve across day boundaries (stale endDate → missing today-slice).
  const day = melbourneDate ?? getMelbourneNowParts().date
  return `snapshot:v${SNAPSHOT_PAYLOAD_VERSION}:${section}:${scope}:d${day}`
}

/** Slim KV entry for Pages HTML inlining (same payload version as full `snapshot:v*` keys). */
export function buildSnapshotInlineKvKey(section: ChartCacheSection, scope: SnapshotScope, melbourneDate?: string): string {
  const day = melbourneDate ?? getMelbourneNowParts().date
  return `snapshot-inline:v${SNAPSHOT_PAYLOAD_VERSION}:${section}:${scope}:d${day}`
}

function isNoSuchTableError(error: unknown, table: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no such table/i.test(message) && message.includes(table)
}

async function latestRunFinishedAtOrNull(db: D1Database): Promise<string | null> {
  try {
    return await getLatestCompletedDailyRunFinishedAt(db)
  } catch {
    return null
  }
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
  // Use the payload's own filtersResolved.endDate as the KV key date so that
  // snapshots built across Melbourne midnight don't land on the wrong day's key.
  // Also write under the current Melbourne date key so the middleware can find
  // the snapshot during early-morning hours (after Melbourne midnight but before
  // the day's data is ingested), when endDate is still the previous day.
  const payloadEndDate = (payload.data as { filtersResolved?: { endDate?: unknown } } | undefined)
    ?.filtersResolved?.endDate
  const dateOverride =
    typeof payloadEndDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payloadEndDate)
      ? payloadEndDate
      : undefined
  const melbourneNow = getMelbourneNowParts().date
  const datesToWrite = dateOverride ? Array.from(new Set([dateOverride, melbourneNow])) : [melbourneNow]
  const serialized = JSON.stringify(payload)
  const byteLength =
    typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(serialized).length : serialized.length
  if (byteLength > KV_VALUE_BYTE_LIMIT) {
    log.error('snapshot_cache', 'snapshot KV bundle exceeds 25 MiB limit', {
      code: 'snapshot_kv_value_too_large',
      context: `section=${section} scope=${scope} bytes=${byteLength} limit=${KV_VALUE_BYTE_LIMIT} chars=${serialized.length}`,
    })
    return
  }
  let trimmed: ReturnType<typeof trimSnapshotDataForHtmlInline> | undefined
  for (const date of datesToWrite) {
    const key = buildSnapshotKvKey(section, scope, date)
    try {
      await kv.put(key, serialized, { expirationTtl: CHART_CACHE_KV_TTL })
    } catch (error) {
      log.error('snapshot_cache', 'snapshot KV put failed', {
        code: 'snapshot_kv_put_failed',
        error,
        context: `key=${key} bytes=${byteLength}`,
      })
      continue
    }
    try {
      if (trimmed === undefined) {
        trimmed = trimSnapshotDataForHtmlInline(
          payload.section,
          String(payload.scope),
          payload.builtAt,
          payload.data as Record<string, unknown>,
        )
      }
      const inlineKey = buildSnapshotInlineKvKey(section, scope, date)
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
        context: `date=${date}`,
      })
    }
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

  try {
    const payloadText = row.payload_json.startsWith(GZIP_PREFIX)
      ? await gunzipFromBase64(row.payload_json.slice(GZIP_PREFIX.length))
      : row.payload_json
    const parsed = JSON.parse(payloadText) as {
      v?: number
      payload?: SnapshotPayload
      meta?: Partial<PublicCacheMetadata>
      builtAt?: string
      sourceRunFinishedAt?: string | null
    }
    if (!parsed || parsed.v !== SNAPSHOT_PAYLOAD_VERSION || !parsed.payload) return null
    const endDate = (parsed.payload.data as { filtersResolved?: { endDate?: unknown } } | undefined)
      ?.filtersResolved?.endDate
    const startDate = (parsed.payload.data as { filtersResolved?: { startDate?: unknown } } | undefined)
      ?.filtersResolved?.startDate
    const latestRunFinishedAt = await latestRunFinishedAtOrNull(db)
    if (
      !isPublicDailyCacheFresh({
        builtAt: String(parsed.meta?.builtAt || parsed.builtAt || row.built_at || parsed.payload.builtAt || ''),
        filtersResolved: { startDate, endDate },
        sourceRunFinishedAt: parsed.meta?.sourceRunFinishedAt ?? parsed.sourceRunFinishedAt ?? null,
        latestRunFinishedAt,
      })
    ) {
      return null
    }
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
  options?: { sourceRunFinishedAt?: string | null },
): Promise<{ rawBytes: number; storedBytes: number; compressed: boolean }> {
  const filtersResolved = (payload.data as { filtersResolved?: { startDate?: string; endDate?: string } } | undefined)
    ?.filtersResolved
  const rawJson = JSON.stringify({
    v: SNAPSHOT_PAYLOAD_VERSION,
    payloadVersion: SNAPSHOT_PAYLOAD_VERSION,
    builtAt: payload.builtAt,
    filtersResolved,
    sourceRunFinishedAt: options?.sourceRunFinishedAt ?? null,
    meta: publicCacheMetadata(SNAPSHOT_PAYLOAD_VERSION, payload.builtAt, {
      filtersResolved,
      sourceRunFinishedAt: options?.sourceRunFinishedAt ?? null,
    }),
    payload,
  })
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
        if (!isSnapshotPayloadFresh(payload)) throw new Error('snapshot_kv_stale')
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
  await writeSnapshotKvBundles(env.CHART_CACHE_KV, section, scope, payload)
  return { ...payload, fromCache: 'live' }
}
