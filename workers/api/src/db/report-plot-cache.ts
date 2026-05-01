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
import type { ReportPlotMode, ReportPlotPayload, ReportPlotSection } from './report-plot-types'
import { getMelbourneNowParts } from '../utils/time'

const REPORT_PLOT_CACHE_TABLE = 'report_plot_request_cache'
const REPORT_PLOT_PAYLOAD_VERSION = 4
const D1_CACHE_FRESH_MINUTES = 90

type ReportPlotCacheRow = {
  payload_json: string
  item_count: number
  built_at: string
}

function isNoSuchTableError(error: unknown, table: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no such table/i.test(message) && message.includes(table)
}

function normalizeScopeParams(
  params: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized = { ...params }
  const datasetMode = normalized.dataset_mode
  delete normalized.dataset_mode
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
  try {
    await kv.put(key, JSON.stringify(payload), { expirationTtl: CHART_CACHE_KV_TTL })
  } catch {
    /* ignore KV write failure */
  }
}

export async function readD1ReportPlotCache(
  db: D1Database,
  section: ReportPlotSection,
  mode: ReportPlotMode,
  scope: ChartCacheScope,
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

  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() - D1_CACHE_FRESH_MINUTES)
  if (new Date(row.built_at) < cutoff) return null

  try {
    const payloadText = row.payload_json.startsWith(GZIP_PREFIX)
      ? await gunzipFromBase64(row.payload_json.slice(GZIP_PREFIX.length))
      : row.payload_json
    const parsed = JSON.parse(payloadText) as { v?: number; payload?: ReportPlotPayload }
    if (!parsed || parsed.v !== REPORT_PLOT_PAYLOAD_VERSION || !parsed.payload) return null
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
): Promise<void> {
  const rawJson = JSON.stringify({ v: REPORT_PLOT_PAYLOAD_VERSION, payload })
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
        new Date().toISOString(),
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
  options?: { allowLiveCompute?: boolean },
): Promise<ReportPlotPayload & { fromCache: 'kv' | 'd1' | 'live' }> {
  // Include Melbourne date in KV key so entries don't serve across day boundaries.
  // D1 cache uses scope (date-agnostic) with a 90-min TTL — no change needed there.
  const kvKey = buildReportPlotCacheKey(section, mode, { ...params, _d: getMelbourneNowParts().date })
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
    const d1Cached = await readD1ReportPlotCache(env.DB, section, mode, scope)
    if (d1Cached) {
      await writeReportPlotPayloadToKv(env.CHART_CACHE_KV, kvKey, d1Cached)
      return { ...d1Cached, fromCache: 'd1' }
    }
  }

  if (options?.allowLiveCompute === false) {
    throw new Error(`report_plot_live_compute_disabled:${section}:${mode}`)
  }

  const payload = await compute()
  if (scope) {
    try {
      await writeD1ReportPlotCache(env.DB, section, mode, scope, payload)
    } catch {
      /* ignore D1 cache write failure */
    }
  }
  await writeReportPlotPayloadToKv(env.CHART_CACHE_KV, kvKey, payload)
  return { ...payload, fromCache: 'live' }
}
