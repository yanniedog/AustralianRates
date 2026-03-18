/**
 * Slim precomputed cache for chart and pivot data. Served when request matches default filters.
 * Refreshed every 15 min by cron. KV caches any response for 5 min.
 */

import type { EnvBindings } from '../types'

export type ChartCacheSection = 'home_loans' | 'savings' | 'term_deposits'

const CACHE_TABLE = 'chart_pivot_cache'
/** D1 cache row considered fresh if built within this many minutes. */
const D1_CACHE_FRESH_MINUTES = 20
/**
 * D1 has practical limits on row/value sizes; large JSON payloads can fail with SQLITE_TOOBIG.
 * We store JSON directly when small, otherwise store gzip(base64(JSON)) with a prefix.
 */
const GZIP_PREFIX = 'gz:'
const MAX_UNCOMPRESSED_CHARS = 500_000
/** KV TTL for computed responses (seconds). */
export const CHART_CACHE_KV_TTL = 300

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  // Chunk to avoid call stack / argument limits.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function gzipToBase64(input: string): Promise<string> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream not available in this runtime')
  }
  const cs = new CompressionStream('gzip')
  const bytes = new TextEncoder().encode(input)
  const stream = new Blob([bytes]).stream().pipeThrough(cs) as ReadableStream<Uint8Array>
  const gzBytes = await streamToUint8Array(stream)
  return bytesToBase64(gzBytes)
}

async function gunzipFromBase64(b64: string): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream not available in this runtime')
  }
  const ds = new DecompressionStream('gzip')
  const gzBytes = base64ToBytes(b64)
  const stream = new Blob([gzBytes]).stream().pipeThrough(ds) as ReadableStream<Uint8Array>
  const bytes = await streamToUint8Array(stream)
  return new TextDecoder().decode(bytes)
}

/** Default date range for precomputed cache: last 365 days inclusive (at least 20 consecutive daily snapshots for charts). */
export function getDefaultDateRange(): { startDate: string; endDate: string } {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 365)
  return { startDate: toYmd(start), endDate: toYmd(end) }
}

/** When start or end is missing, applies default range so chart requests always have at least 20 consecutive daily snapshots. */
export function applyDefaultChartDateRange<T extends { startDate?: string; endDate?: string }>(filters: T): T {
  const start = filters.startDate?.trim()
  const end = filters.endDate?.trim()
  if (start && end) return filters
  const def = getDefaultDateRange()
  return { ...filters, startDate: start || def.startDate, endDate: end || def.endDate }
}

type DefaultCheckInput = {
  startDate?: string
  endDate?: string
  bank?: string
  banks?: string[]
  includeRemoved?: boolean
  mode?: string
  [k: string]: unknown
}

/** True if request has no selective filters and uses default or no date range. */
export function isDefaultChartRequest(
  section: ChartCacheSection,
  params: DefaultCheckInput,
): boolean {
  if (params.bank || (params.banks && params.banks.length > 0)) return false
  if (params.includeRemoved) return false
  if (params.mode && params.mode !== 'all') return false
  const { startDate: defaultStart, endDate: defaultEnd } = getDefaultDateRange()
  const start = params.startDate?.trim()
  const end = params.endDate?.trim()
  if (start || end) {
    if (!start || !end) return false
    if (start !== defaultStart || end !== defaultEnd) return false
  }
  if (section === 'home_loans') {
    const h = params as DefaultCheckInput & { securityPurpose?: string; repaymentType?: string; rateStructure?: string; lvrTier?: string; featureSet?: string; minRate?: number; maxRate?: number; minComparisonRate?: number; maxComparisonRate?: number }
    if (h.securityPurpose || h.repaymentType || h.rateStructure || h.lvrTier || h.featureSet) return false
    if (h.minRate != null || h.maxRate != null || h.minComparisonRate != null || h.maxComparisonRate != null) return false
  }
  if (section === 'savings') {
    const s = params as DefaultCheckInput & { accountType?: string; rateType?: string; depositTier?: string; minRate?: number; maxRate?: number }
    if (s.accountType || s.rateType || s.depositTier) return false
    if (s.minRate != null || s.maxRate != null) return false
  }
  if (section === 'term_deposits') {
    const t = params as DefaultCheckInput & { termMonths?: string; depositTier?: string; interestPayment?: string; minRate?: number; maxRate?: number }
    if (t.termMonths || t.depositTier || t.interestPayment) return false
    if (t.minRate != null || t.maxRate != null) return false
  }
  return true
}

export type ChartCacheRow = {
  payload_json: string
  row_count: number
  built_at: string
}

function isNoSuchTableError(e: unknown, table: string): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /no such table/i.test(msg) && msg.includes(table)
}

/** Read precomputed payload from D1. Returns null if missing, stale, or table does not exist (migration 0030 not applied). */
export async function readD1ChartCache(
  db: D1Database,
  section: ChartCacheSection,
  representation: 'day' | 'change',
): Promise<{ rows: Array<Record<string, unknown>>; representation: 'day' | 'change'; fallbackReason: string | null; builtAt: string } | null> {
  let row: ChartCacheRow | null
  try {
    row = await db
      .prepare(
        `SELECT payload_json, row_count, built_at FROM ${CACHE_TABLE} WHERE section = ? AND representation = ?`,
      )
      .bind(section, representation)
      .first<ChartCacheRow>()
  } catch (e) {
    if (isNoSuchTableError(e, CACHE_TABLE)) return null
    throw e
  }
  if (!row?.payload_json) return null
  const builtAt = row.built_at
  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() - D1_CACHE_FRESH_MINUTES)
  if (new Date(builtAt) < cutoff) return null
  let rows: Array<Record<string, unknown>>
  try {
    const payload = row.payload_json.startsWith(GZIP_PREFIX)
      ? await gunzipFromBase64(row.payload_json.slice(GZIP_PREFIX.length))
      : row.payload_json
    rows = JSON.parse(payload) as Array<Record<string, unknown>>
  } catch {
    return null
  }
  return {
    rows,
    representation,
    fallbackReason: null,
    builtAt,
  }
}

/** Write precomputed result to D1 (upsert). No-op if table does not exist (migration 0030 not applied). */
export async function writeD1ChartCache(
  db: D1Database,
  section: ChartCacheSection,
  representation: 'day' | 'change',
  result: { rows: Array<Record<string, unknown>> },
): Promise<void> {
  const rawJson = JSON.stringify(result.rows)
  const payloadJson =
    rawJson.length <= MAX_UNCOMPRESSED_CHARS ? rawJson : `${GZIP_PREFIX}${await gzipToBase64(rawJson)}`
  const builtAt = new Date().toISOString()
  try {
    await db
      .prepare(
        `INSERT INTO ${CACHE_TABLE} (section, representation, payload_json, row_count, built_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (section, representation) DO UPDATE SET
           payload_json = excluded.payload_json,
           row_count = excluded.row_count,
           built_at = excluded.built_at`,
      )
      .bind(section, representation, payloadJson, result.rows.length, builtAt)
      .run()
  } catch (e) {
    if (isNoSuchTableError(e, CACHE_TABLE)) return
    throw e
  }
}

/** Stable cache key for KV from section, representation, and sorted params. */
export function buildChartCacheKey(
  section: ChartCacheSection,
  representation: string,
  params: Record<string, string | undefined>,
): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k] ?? '')}`)
    .join('&')
  return `chart:${section}:${representation}:${sorted}`
}

export type ChartAnalyticsPayload = {
  rows: Array<Record<string, unknown>>
  representation: 'day' | 'change'
  fallbackReason: string | null
}

/** Try KV cache, then D1 cache if default request, else compute. Returns payload and cache source. */
export async function getCachedOrCompute(
  env: { DB: D1Database; CHART_CACHE_KV?: KVNamespace },
  section: ChartCacheSection,
  representation: 'day' | 'change',
  params: Record<string, string | undefined>,
  compute: () => Promise<ChartAnalyticsPayload>,
): Promise<ChartAnalyticsPayload & { fromCache: 'kv' | 'd1' | 'live' }> {
  const key = buildChartCacheKey(section, representation, params)

  if (env.CHART_CACHE_KV) {
    const kvCached = await env.CHART_CACHE_KV.get(key)
    if (kvCached) {
      try {
        const parsed = JSON.parse(kvCached) as ChartAnalyticsPayload
        return { ...parsed, fromCache: 'kv' }
      } catch {
        /* invalid JSON, fall through to compute */
      }
    }
  }

  const banks = params.banks
    ? String(params.banks)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined
  const defaultParams = {
    startDate: params.start_date,
    endDate: params.end_date,
    bank: params.bank,
    banks: banks?.length ? banks : undefined,
    includeRemoved: params.include_removed === 'true',
    mode: params.mode,
    securityPurpose: params.security_purpose,
    repaymentType: params.repayment_type,
    rateStructure: params.rate_structure,
    lvrTier: params.lvr_tier,
    featureSet: params.feature_set,
    minRate: params.min_rate ? Number(params.min_rate) : undefined,
    maxRate: params.max_rate ? Number(params.max_rate) : undefined,
    minComparisonRate: params.min_comparison_rate ? Number(params.min_comparison_rate) : undefined,
    maxComparisonRate: params.max_comparison_rate ? Number(params.max_comparison_rate) : undefined,
    accountType: params.account_type,
    rateType: params.rate_type,
    depositTier: params.deposit_tier,
    termMonths: params.term_months,
    interestPayment: params.interest_payment,
  }
  if (isDefaultChartRequest(section, defaultParams)) {
    const d1Cached = await readD1ChartCache(env.DB, section, representation)
    if (d1Cached) {
      return {
        rows: d1Cached.rows,
        representation: d1Cached.representation,
        fallbackReason: d1Cached.fallbackReason,
        fromCache: 'd1',
      }
    }
  }

  const result = await compute()
  if (env.CHART_CACHE_KV) {
    try {
      await env.CHART_CACHE_KV.put(key, JSON.stringify(result), { expirationTtl: CHART_CACHE_KV_TTL })
    } catch {
      /* ignore KV write failure */
    }
  }
  return { ...result, fromCache: 'live' }
}
