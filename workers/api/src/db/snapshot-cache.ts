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
import {
  buildPublicCacheReadFreshnessOptions,
  logPublicCacheServedBoundedStale,
  logPublicCacheWedgedSection,
  serializeJsonForKv,
  type PublicCacheReadFreshnessOptions,
} from './public-cache-support'
import { getMelbourneNowParts } from '../utils/time'
import { getLatestCompletedDailyRunFinishedAt } from './run-reports'
import {
  publicCacheFreshnessStatus,
  publicCacheMetadata,
  publicCacheStaleServeStatus,
  type PublicCacheMetadata,
} from './public-cache-freshness'

const SNAPSHOT_CACHE_TABLE = 'snapshot_cache'
/** Bump when snapshot payload shape changes so stale rows are ignored. v13 preserves full latest-all coverage for public charts. */
const SNAPSHOT_PAYLOAD_VERSION = 13

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

function isSnapshotPayloadFresh(
  payload: SnapshotPayload,
  options?: PublicCacheReadFreshnessOptions,
): boolean {
  return publicCacheFreshnessStatus({
    builtAt: payload.builtAt,
    filtersResolved: snapshotFiltersResolved(payload),
    sourceRunFinishedAt: payload.sourceRunFinishedAt ?? null,
    latestRunFinishedAt: options?.latestRunFinishedAt ?? null,
    latestAvailableCollectionDate: options?.latestAvailableCollectionDate ?? null,
    now: options?.now,
    timeZone: options?.timeZone,
  }).fresh
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
  const serialized = serializeJsonForKv(buildSnapshotKvKey(section, scope), payload, {
    source: 'snapshot_cache',
    context: { section, scope, variant: 'full' },
  })
  let trimmed: ReturnType<typeof trimSnapshotDataForHtmlInline> | undefined
  let inlineSerialized: string | null | undefined
  for (const date of datesToWrite) {
    const key = buildSnapshotKvKey(section, scope, date)
    if (serialized) {
      try {
        await kv.put(key, serialized, { expirationTtl: CHART_CACHE_KV_TTL })
      } catch (error) {
        log.error('snapshot_cache', 'snapshot KV put failed', {
          code: 'snapshot_kv_put_failed',
          error,
          context: `key=${key}`,
        })
      }
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
        if (inlineSerialized === undefined) {
          const inlinePayload: SnapshotPayload = { ...payload, data: trimmed }
          inlineSerialized = serializeJsonForKv(inlineKey, inlinePayload, {
            source: 'snapshot_cache',
            context: { section, scope, variant: 'inline' },
          })
        }
        if (inlineSerialized) {
          await kv.put(inlineKey, inlineSerialized, { expirationTtl: CHART_CACHE_KV_TTL })
        }
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
  options?: PublicCacheReadFreshnessOptions,
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
    const latestRunFinishedAt =
      options && Object.prototype.hasOwnProperty.call(options, 'latestRunFinishedAt')
        ? options.latestRunFinishedAt ?? null
        : await latestRunFinishedAtOrNull(db)
    const builtAt = String(parsed.meta?.builtAt || parsed.builtAt || row.built_at || parsed.payload.builtAt || '')
    const filtersResolved = { startDate, endDate }
    const freshnessInput = {
      builtAt,
      filtersResolved,
      sourceRunFinishedAt: parsed.meta?.sourceRunFinishedAt ?? parsed.sourceRunFinishedAt ?? null,
      latestRunFinishedAt,
      latestAvailableCollectionDate: options?.latestAvailableCollectionDate ?? null,
      now: options?.now,
      timeZone: options?.timeZone,
    }
    const freshness = publicCacheFreshnessStatus(freshnessInput)
    if (!freshness.fresh) {
      const staleStatus = options?.allowStaleWithinCanary
        ? publicCacheStaleServeStatus(freshnessInput, freshness)
        : null
      if (freshness.reason === 'end_date_beyond_max_staleness') {
        logPublicCacheWedgedSection({
          source: 'snapshot_cache',
          section,
          scope,
          builtAt,
          endDate: freshness.endDate,
          latestAvailableCollectionDate: options?.latestAvailableCollectionDate ?? null,
          cacheKind: 'snapshot',
        })
      }
      if (staleStatus?.canServe) {
        logPublicCacheServedBoundedStale({
          source: 'snapshot_cache',
          section,
          scope,
          builtAt,
          endDate: staleStatus.endDate,
          latestAvailableCollectionDate: options?.latestAvailableCollectionDate ?? null,
          cacheKind: 'snapshot',
          reason: staleStatus.reason,
        })
      } else {
        return null
      }
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
  options?: {
    allowD1Fallback?: boolean
    allowLiveCompute?: boolean
  } & PublicCacheReadFreshnessOptions,
): Promise<SnapshotPayload & { fromCache: 'kv' | 'd1' | 'live' }> {
  const kvKey = buildSnapshotKvKey(section, scope)
  if (env.CHART_CACHE_KV) {
    const kvCached = await env.CHART_CACHE_KV.get(kvKey)
    if (kvCached) {
      try {
        const payload = JSON.parse(kvCached) as SnapshotPayload
        const latestRunFinishedAt =
          options && Object.prototype.hasOwnProperty.call(options, 'latestRunFinishedAt')
            ? options.latestRunFinishedAt ?? null
            : await latestRunFinishedAtOrNull(env.DB)
        if (
          !isSnapshotPayloadFresh(payload, {
            latestRunFinishedAt,
            latestAvailableCollectionDate: options?.latestAvailableCollectionDate ?? null,
            now: options?.now,
            timeZone: options?.timeZone,
          })
        ) throw new Error('snapshot_kv_stale')
        return { ...payload, fromCache: 'kv' }
      } catch {
        /* ignore invalid KV entry */
      }
    }
  }

  if (options?.allowD1Fallback !== false) {
    const readOptions = buildPublicCacheReadFreshnessOptions({
      ...options,
      allowStaleWithinCanary: true,
    })
    const d1Cached = await readD1SnapshotCache(env.DB, section, scope, readOptions)
    if (d1Cached) {
      await writeSnapshotKvBundles(env.CHART_CACHE_KV, section, scope, d1Cached)
      return { ...d1Cached, fromCache: 'd1' }
    }
  }

  if (options?.allowLiveCompute === false) {
    throw new Error(`snapshot_cache_miss:${section}:${scope}`)
  }

  const payload = await compute()
  const kvWrite = writeSnapshotKvBundles(env.CHART_CACHE_KV, section, scope, payload)
  if (scope && options?.allowD1Fallback !== false) {
    const d1Write = writeD1SnapshotCache(env.DB, section, scope, payload, {
      sourceRunFinishedAt: options?.latestRunFinishedAt,
    }).catch((error) => {
      // Live responses should not fail just because durable cache write-through failed.
      log.warn('snapshot_cache', 'snapshot D1 write-through failed', {
        code: 'snapshot_d1_write_failed',
        error,
        context: { section, scope },
      })
    })
    await Promise.all([kvWrite, d1Write])
  } else {
    await kvWrite
  }
  return { ...payload, fromCache: 'live' }
}
