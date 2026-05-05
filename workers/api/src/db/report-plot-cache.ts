import {
  CHART_CACHE_KV_TTL,
  GZIP_PREFIX,
  MAX_UNCOMPRESSED_CHARS,
  buildChartCacheKey,
  gunzipFromBase64,
  gzipToBase64,
  resolveDefaultChartCacheScope,
  type ChartCacheScope,
} from './chart-cache'
import {
  buildPublicCacheReadFreshnessOptions,
  logPublicCacheServedBoundedStale,
  logPublicCacheWedgedSection,
  serializeJsonForKv,
  type PublicCacheReadFreshnessOptions,
} from './public-cache-support'
import type { ReportPlotMode, ReportPlotPayload, ReportPlotSection } from './report-plot-types'
import { getMelbourneNowParts } from '../utils/time'
import { getLatestCompletedDailyRunFinishedAt } from './run-reports'
import {
  publicCacheFreshnessStatus,
  publicCacheMetadata,
  publicCacheStaleServeStatus,
  type PublicCacheMetadata,
} from './public-cache-freshness'
import { log } from '../utils/logger'

const REPORT_PLOT_CACHE_TABLE = 'report_plot_request_cache'
const REPORT_PLOT_PAYLOAD_VERSION = 7

type ReportPlotCacheRow = {
  payload_json: string
  item_count: number
  built_at: string
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

function normalizeScopeParams(
  params: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized = { ...params }
  const datasetMode = normalized.dataset_mode
  delete normalized.dataset_mode
  delete normalized.__implicit_end_date
  normalized.mode = datasetMode
  return normalized
}

export function resolveDefaultReportPlotCacheScope(
  section: ReportPlotSection,
  params: Record<string, string | undefined>,
): ChartCacheScope | null {
  return resolveDefaultChartCacheScope(section, normalizeScopeParams(params))
}

export function buildReportPlotCacheKey(
  section: ReportPlotSection,
  mode: ReportPlotMode,
  params: Record<string, string | undefined>,
): string {
  return buildChartCacheKey(section, `report-plot:v${REPORT_PLOT_PAYLOAD_VERSION}:${mode}`, params)
}

function payloadItemCount(payload: ReportPlotPayload): number {
  return payload.mode === 'moves' ? payload.points.length : payload.series.length
}

async function writeReportPlotPayloadToKv(
  kv: KVNamespace | undefined,
  key: string,
  payload: ReportPlotPayload,
): Promise<void> {
  if (!kv) return
  const serialized = serializeJsonForKv(key, payload, {
    source: 'report_plot_cache',
    context: { mode: payload.mode },
  })
  if (!serialized) return
  try {
    await kv.put(key, serialized, { expirationTtl: CHART_CACHE_KV_TTL })
  } catch {
    /* ignore KV write failure */
  }
}

export async function readD1ReportPlotCache(
  db: D1Database,
  section: ReportPlotSection,
  mode: ReportPlotMode,
  scope: ChartCacheScope,
  options?: PublicCacheReadFreshnessOptions,
): Promise<ReportPlotPayload | null> {
  let row: ReportPlotCacheRow | null = null
  try {
    row = await db
      .prepare(
        `SELECT payload_json, item_count, built_at
         FROM ${REPORT_PLOT_CACHE_TABLE}
         WHERE section = ? AND mode = ? AND request_scope = ?`,
      )
      .bind(section, mode, scope)
      .first<ReportPlotCacheRow>()
  } catch (error) {
    if (isNoSuchTableError(error, REPORT_PLOT_CACHE_TABLE)) return null
    throw error
  }
  if (!row?.payload_json) return null

  try {
    const payloadText = row.payload_json.startsWith(GZIP_PREFIX)
      ? await gunzipFromBase64(row.payload_json.slice(GZIP_PREFIX.length))
      : row.payload_json
    const parsed = JSON.parse(payloadText) as {
      v?: number
      payload?: ReportPlotPayload
      meta?: Partial<PublicCacheMetadata>
      builtAt?: string
      sourceRunFinishedAt?: string | null
    }
    if (!parsed || parsed.v !== REPORT_PLOT_PAYLOAD_VERSION || !parsed.payload) return null
    const filtersResolved = {
      startDate: parsed.payload.meta.start_date,
      endDate: parsed.payload.meta.end_date,
    }
    const latestRunFinishedAt =
      options && Object.prototype.hasOwnProperty.call(options, 'latestRunFinishedAt')
        ? options.latestRunFinishedAt ?? null
        : await latestRunFinishedAtOrNull(db)
    const builtAt = String(parsed.meta?.builtAt || parsed.builtAt || row.built_at || '')
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
          source: 'report_plot_cache',
          section,
          scope,
          builtAt,
          endDate: freshness.endDate,
          latestAvailableCollectionDate: options?.latestAvailableCollectionDate ?? null,
          cacheKind: mode,
        })
      }
      if (staleStatus?.canServe) {
        logPublicCacheServedBoundedStale({
          source: 'report_plot_cache',
          section,
          scope,
          builtAt,
          endDate: staleStatus.endDate,
          latestAvailableCollectionDate: options?.latestAvailableCollectionDate ?? null,
          cacheKind: mode,
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

export async function writeD1ReportPlotCache(
  db: D1Database,
  section: ReportPlotSection,
  mode: ReportPlotMode,
  scope: ChartCacheScope,
  payload: ReportPlotPayload,
  options?: { sourceRunFinishedAt?: string | null },
): Promise<void> {
  const builtAt = new Date().toISOString()
  const filtersResolved = {
    startDate: payload.meta.start_date,
    endDate: payload.meta.end_date,
  }
  const rawJson = JSON.stringify({
    v: REPORT_PLOT_PAYLOAD_VERSION,
    payloadVersion: REPORT_PLOT_PAYLOAD_VERSION,
    builtAt,
    filtersResolved,
    sourceRunFinishedAt: options?.sourceRunFinishedAt ?? null,
    meta: publicCacheMetadata(REPORT_PLOT_PAYLOAD_VERSION, builtAt, {
      filtersResolved,
      sourceRunFinishedAt: options?.sourceRunFinishedAt ?? null,
    }),
    payload,
  })
  const payloadJson =
    rawJson.length <= MAX_UNCOMPRESSED_CHARS ? rawJson : `${GZIP_PREFIX}${await gzipToBase64(rawJson)}`
  try {
    await db
      .prepare(
        `INSERT INTO ${REPORT_PLOT_CACHE_TABLE} (section, mode, request_scope, payload_json, item_count, built_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (section, mode, request_scope) DO UPDATE SET
           payload_json = excluded.payload_json,
           item_count = excluded.item_count,
           built_at = excluded.built_at`,
      )
      .bind(
        section,
        mode,
        scope,
        payloadJson,
        payloadItemCount(payload),
        builtAt,
      )
      .run()
  } catch (error) {
    if (isNoSuchTableError(error, REPORT_PLOT_CACHE_TABLE)) return
    throw error
  }
}

export async function getCachedOrComputeReportPlot(
  env: { DB: D1Database; CHART_CACHE_KV?: KVNamespace },
  section: ReportPlotSection,
  mode: ReportPlotMode,
  params: Record<string, string | undefined>,
  compute: () => Promise<ReportPlotPayload>,
  options?: {
    allowLiveCompute?: boolean
  } & PublicCacheReadFreshnessOptions,
): Promise<ReportPlotPayload & { fromCache: 'kv' | 'd1' | 'live' }> {
  // Include Melbourne date in KV key so entries don't serve across day boundaries.
  // D1 cache uses scope (date-agnostic) with a 90-min TTL — no change needed there.
  const kvKey = buildReportPlotCacheKey(section, mode, { ...params, __kvDay: getMelbourneNowParts().date })
  if (env.CHART_CACHE_KV) {
    const kvCached = await env.CHART_CACHE_KV.get(kvKey)
    if (kvCached) {
      try {
        return { ...(JSON.parse(kvCached) as ReportPlotPayload), fromCache: 'kv' }
      } catch {
        /* ignore invalid KV entry */
      }
    }
  }

  const scope = resolveDefaultReportPlotCacheScope(section, params)
  if (scope) {
    const readOptions = buildPublicCacheReadFreshnessOptions({
      ...options,
      allowStaleWithinCanary: true,
    })
    const d1Cached = await readD1ReportPlotCache(env.DB, section, mode, scope, readOptions)
    if (d1Cached) {
      await writeReportPlotPayloadToKv(env.CHART_CACHE_KV, kvKey, d1Cached)
      return { ...d1Cached, fromCache: 'd1' }
    }
  }

  if (options?.allowLiveCompute === false) {
    throw new Error(`report_plot_live_compute_disabled:${section}:${mode}`)
  }

  const payload = await compute()
  const kvWrite = writeReportPlotPayloadToKv(env.CHART_CACHE_KV, kvKey, payload)
  if (scope) {
    const d1Write = writeD1ReportPlotCache(env.DB, section, mode, scope, payload, {
      sourceRunFinishedAt: options?.latestRunFinishedAt,
    }).catch((error) => {
      // Live responses should not fail just because durable cache write-through failed.
      log.warn('report_plot_cache', 'report-plot D1 write-through failed', {
        code: 'report_plot_d1_write_failed',
        error,
        context: { section, mode, scope },
      })
    })
    await Promise.all([kvWrite, d1Write])
  } else {
    await kvWrite
  }
  return { ...payload, fromCache: 'live' }
}
