/**
 * Slim precomputed cache for chart and pivot data. Served when request matches default filters.
 * Refreshed every 15 min by cron. KV caches any response for 5 min.
 */

import type { EnvBindings } from '../types'
import { parseOptionalPublicMinRate } from '../routes/public-query'
import { queryHomeLoanCollectionDateRange } from './home-loans/paginated'
import { querySavingsCollectionDateRange } from './savings/paginated'
import { queryTdCollectionDateRange } from './term-deposits/paginated'
import {
  buildChartWindowScope,
  parseChartWindow,
  PRECOMPUTED_CHART_WINDOWS,
  resolveChartWindowStart,
  type ChartWindow,
} from '../utils/chart-window'

export type ChartCacheSection = 'home_loans' | 'savings' | 'term_deposits'
type ChartCachePreset = 'consumer-default'

export type ChartCacheScope =
  | 'default'
  | `window:${ChartWindow}`
  | `preset:${ChartCachePreset}`
  | `preset:${ChartCachePreset}:window:${ChartWindow}`

const CACHE_TABLE = 'chart_request_cache'
const LEGACY_CACHE_TABLE = 'chart_pivot_cache'
/** Bump when chart row selection semantics change so legacy D1 payloads are ignored. */
const CHART_PIVOT_PAYLOAD_VERSION = 2
/** D1 cache row considered fresh if built within this many minutes. */
const D1_CACHE_FRESH_MINUTES = 20
/**
 * D1 has practical limits on row/value sizes; large JSON payloads can fail with SQLITE_TOOBIG.
 * We store JSON directly when small, otherwise store gzip(base64(JSON)) with a prefix.
 */
export const GZIP_PREFIX = 'gz:'
export const MAX_UNCOMPRESSED_CHARS = 500_000
/** KV TTL for computed responses (seconds). */
export const CHART_CACHE_KV_TTL = 300
export { PRECOMPUTED_CHART_WINDOWS }

const CONSUMER_DEFAULT_SCOPE = 'preset:consumer-default' as const

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function clampChartDateRange(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const today = toYmd(new Date())
  const cappedEndDate = endDate && endDate > today ? today : endDate || today
  const cappedStartDate = startDate && startDate <= cappedEndDate ? startDate : cappedEndDate
  return { startDate: cappedStartDate, endDate: cappedEndDate }
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

export async function gzipToBase64(input: string): Promise<string> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream not available in this runtime')
  }
  const cs = new CompressionStream('gzip')
  const bytes = new TextEncoder().encode(input)
  const stream = new Blob([bytes]).stream().pipeThrough(cs) as ReadableStream<Uint8Array>
  const gzBytes = await streamToUint8Array(stream)
  return bytesToBase64(gzBytes)
}

export async function gunzipFromBase64(b64: string): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream not available in this runtime')
  }
  const ds = new DecompressionStream('gzip')
  const gzBytes = base64ToBytes(b64)
  const ab = gzBytes.buffer.slice(gzBytes.byteOffset, gzBytes.byteOffset + gzBytes.byteLength) as ArrayBuffer
  const stream = new Blob([ab]).stream().pipeThrough(ds) as ReadableStream<Uint8Array>
  const bytes = await streamToUint8Array(stream)
  return new TextDecoder().decode(bytes)
}

/** When start or end is missing, resolves range from DB (first to last snapshot for the section/filters). Returns filters with dates set. */
export async function resolveChartDateRangeFromDb(
  db: D1Database,
  section: ChartCacheSection,
  filters: Record<string, unknown> & { startDate?: string; endDate?: string },
  options: { window?: ChartWindow | null } = {},
): Promise<Record<string, unknown> & { startDate: string; endDate: string }> {
  const start = filters.startDate?.trim()
  const end = filters.endDate?.trim()
  if (start && end) return { ...filters, startDate: start, endDate: end }
  let range: { startDate: string; endDate: string } | null = null
  if (section === 'home_loans') {
    range = await queryHomeLoanCollectionDateRange(db, filters as Parameters<typeof queryHomeLoanCollectionDateRange>[1])
  } else if (section === 'savings') {
    range = await querySavingsCollectionDateRange(db, filters as Parameters<typeof querySavingsCollectionDateRange>[1])
  } else if (section === 'term_deposits') {
    range = await queryTdCollectionDateRange(db, filters as Parameters<typeof queryTdCollectionDateRange>[1])
  }
  const fallback = toYmd(new Date())
  const baseRange = clampChartDateRange(range?.startDate || fallback, range?.endDate || fallback)
  const rangeStart = baseRange.startDate
  const rangeEnd = baseRange.endDate
  if (options.window && !start && !end) {
    const windowStart = resolveChartWindowStart(rangeStart, rangeEnd, options.window)
    const windowRange = clampChartDateRange(windowStart, rangeEnd)
    return {
      ...filters,
      startDate: windowRange.startDate,
      endDate: windowRange.endDate,
    }
  }
  const nextRange = clampChartDateRange(start || rangeStart, end || rangeEnd)
  return { ...filters, startDate: nextRange.startDate, endDate: nextRange.endDate }
}

type DefaultCheckInput = {
  startDate?: string
  endDate?: string
  bank?: string
  banks?: string[]
  includeRemoved?: boolean
  includeManual?: boolean
  excludeCompareEdgeCases?: boolean
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
  if (params.includeManual) return false
  if (params.excludeCompareEdgeCases === false) return false
  if (params.mode && params.mode !== 'all') return false
  if (params.startDate?.trim() || params.endDate?.trim()) return false
  if (section === 'home_loans') {
    const h = params as DefaultCheckInput & { securityPurpose?: string; repaymentType?: string; rateStructure?: string; lvrTier?: string; featureSet?: string; minRate?: number; maxRate?: number; minComparisonRate?: number; maxComparisonRate?: number }
    if (h.securityPurpose || h.repaymentType || h.rateStructure || h.lvrTier || h.featureSet) return false
    if (h.minRate != null || h.maxRate != null || h.minComparisonRate != null || h.maxComparisonRate != null) return false
  }
  if (section === 'savings') {
    const s = params as DefaultCheckInput & {
      accountType?: string
      rateType?: string
      depositTier?: string
      balanceMin?: number
      balanceMax?: number
      minRate?: number
      maxRate?: number
    }
    if (s.accountType || s.rateType || s.depositTier) return false
    if (s.balanceMin != null || s.balanceMax != null) return false
    if (s.minRate != null || s.maxRate != null) return false
  }
  if (section === 'term_deposits') {
    const t = params as DefaultCheckInput & {
      termMonths?: string
      depositTier?: string
      balanceMin?: number
      balanceMax?: number
      interestPayment?: string
      minRate?: number
      maxRate?: number
    }
    if (t.termMonths || t.depositTier || t.interestPayment) return false
    if (t.balanceMin != null || t.balanceMax != null) return false
    if (t.minRate != null || t.maxRate != null) return false
  }
  return true
}

function buildDefaultRequestInput(
  section: ChartCacheSection,
  params: Record<string, string | undefined>,
): DefaultCheckInput {
  const banks = params.banks
    ? String(params.banks)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined
  return {
    startDate: params.start_date,
    endDate: params.end_date,
    bank: params.bank,
    banks: banks?.length ? banks : undefined,
    includeRemoved: params.include_removed === 'true',
    includeManual: params.include_manual === 'true',
    excludeCompareEdgeCases:
      params.exclude_compare_edge_cases === '0' ||
      params.exclude_compare_edge_cases === 'false' ||
      params.exclude_compare_edge_cases === 'no' ||
      params.exclude_compare_edge_cases === 'off'
        ? false
        : undefined,
    mode: params.mode,
    securityPurpose: params.security_purpose,
    repaymentType: params.repayment_type,
    rateStructure: params.rate_structure,
    lvrTier: params.lvr_tier,
    featureSet: params.feature_set,
    minRate:
      section === 'savings' || section === 'term_deposits'
        ? parseOptionalPublicMinRate(params.min_rate, { treatPointZeroOneAsDefault: true })
        : (params.min_rate ? Number(params.min_rate) : undefined),
    maxRate: params.max_rate ? Number(params.max_rate) : undefined,
    minComparisonRate: params.min_comparison_rate ? Number(params.min_comparison_rate) : undefined,
    maxComparisonRate: params.max_comparison_rate ? Number(params.max_comparison_rate) : undefined,
    accountType: params.account_type,
    rateType: params.rate_type,
    depositTier: params.deposit_tier,
    balanceMin: params.balance_min ? Number(params.balance_min) : undefined,
    balanceMax: params.balance_max ? Number(params.balance_max) : undefined,
    termMonths: params.term_months,
    interestPayment: params.interest_payment,
  }
}

function resolveRawDefaultChartScope(params: Record<string, string | undefined>): ChartCacheScope {
  const chartWindow = parseChartWindow(params.chart_window)
  return chartWindow ? buildChartWindowScope(chartWindow) : 'default'
}

function resolveConsumerDefaultChartScope(params: Record<string, string | undefined>): ChartCacheScope {
  const chartWindow = parseChartWindow(params.chart_window)
  return chartWindow ? `${CONSUMER_DEFAULT_SCOPE}:window:${chartWindow}` : CONSUMER_DEFAULT_SCOPE
}

function hasNoSelectiveBaseFilters(params: DefaultCheckInput): boolean {
  if (params.bank || (params.banks && params.banks.length > 0)) return false
  if (params.includeRemoved) return false
  if (params.includeManual) return false
  if (params.excludeCompareEdgeCases === false) return false
  if (params.mode && params.mode !== 'all') return false
  if (params.startDate?.trim() || params.endDate?.trim()) return false
  return true
}

function isDefaultishMinRate(value: unknown): boolean {
  if (value == null) return true
  return Number(value) === 0.01
}

export function isConsumerDefaultChartRequest(
  section: ChartCacheSection,
  params: DefaultCheckInput,
): boolean {
  if (!hasNoSelectiveBaseFilters(params)) return false
  if (section === 'home_loans') {
    const h = params as DefaultCheckInput & {
      securityPurpose?: string
      repaymentType?: string
      rateStructure?: string
      lvrTier?: string
      featureSet?: string
      minRate?: number
      maxRate?: number
      minComparisonRate?: number
      maxComparisonRate?: number
    }
    return (
      h.securityPurpose === 'owner_occupied' &&
      h.repaymentType === 'principal_and_interest' &&
      h.rateStructure === 'variable' &&
      h.lvrTier === 'lvr_80-85%' &&
      !h.featureSet &&
      isDefaultishMinRate(h.minRate) &&
      h.maxRate == null &&
      h.minComparisonRate == null &&
      h.maxComparisonRate == null
    )
  }
  if (section === 'savings') {
    const s = params as DefaultCheckInput & {
      accountType?: string
      rateType?: string
      depositTier?: string
      balanceMin?: number
      balanceMax?: number
      minRate?: number
      maxRate?: number
    }
    return (
      s.accountType === 'savings' &&
      !s.rateType &&
      !s.depositTier &&
      s.balanceMin == null &&
      s.balanceMax == null &&
      isDefaultishMinRate(s.minRate) &&
      s.maxRate == null
    )
  }
  return false
}

export function resolveChartCacheScope(
  section: ChartCacheSection,
  params: Record<string, string | undefined>,
): ChartCacheScope | null {
  const requestInput = buildDefaultRequestInput(section, params)
  if (isDefaultChartRequest(section, requestInput)) {
    return resolveRawDefaultChartScope(params)
  }
  if (isConsumerDefaultChartRequest(section, requestInput)) {
    return resolveConsumerDefaultChartScope(params)
  }
  return null
}

export function resolveDefaultChartCacheScope(
  section: ChartCacheSection,
  params: Record<string, string | undefined>,
): ChartCacheScope | null {
  return resolveChartCacheScope(section, params)
}

export type ChartCacheRow = {
  payload_json: string
  row_count: number
  built_at: string
}

type ChartCacheRowWithScope = ChartCacheRow & {
  request_scope: ChartCacheScope
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
  scope: ChartCacheScope = 'default',
): Promise<{ rows: Array<Record<string, unknown>>; representation: 'day' | 'change'; fallbackReason: string | null; builtAt: string } | null> {
  let row: ChartCacheRow | null = null
  try {
    row = await db
      .prepare(
        `SELECT payload_json, row_count, built_at
         FROM ${CACHE_TABLE}
         WHERE section = ? AND representation = ? AND request_scope = ?`,
      )
      .bind(section, representation, scope)
      .first<ChartCacheRowWithScope>()
  } catch (e) {
    if (!isNoSuchTableError(e, CACHE_TABLE)) throw e
  }
  if (!row && scope === 'default') {
    try {
      row = await db
        .prepare(
          `SELECT payload_json, row_count, built_at
           FROM ${LEGACY_CACHE_TABLE}
           WHERE section = ? AND representation = ?`,
        )
        .bind(section, representation)
        .first<ChartCacheRow>()
    } catch (e) {
      if (isNoSuchTableError(e, LEGACY_CACHE_TABLE)) return null
      throw e
    }
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
    const parsed = JSON.parse(payload) as unknown
    if (Array.isArray(parsed)) return null
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { v?: unknown }).v === CHART_PIVOT_PAYLOAD_VERSION &&
      Array.isArray((parsed as { rows?: unknown }).rows)
    ) {
      rows = (parsed as { rows: Array<Record<string, unknown>> }).rows
    } else {
      return null
    }
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

async function writeLegacyD1ChartCache(
  db: D1Database,
  section: ChartCacheSection,
  representation: 'day' | 'change',
  payloadJson: string,
  rowCount: number,
  builtAt: string,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO ${LEGACY_CACHE_TABLE} (section, representation, payload_json, row_count, built_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (section, representation) DO UPDATE SET
           payload_json = excluded.payload_json,
           row_count = excluded.row_count,
           built_at = excluded.built_at`,
      )
      .bind(section, representation, payloadJson, rowCount, builtAt)
      .run()
  } catch (e) {
    if (isNoSuchTableError(e, LEGACY_CACHE_TABLE)) return
    throw e
  }
}

/** Write precomputed result to D1 (upsert). No-op if table does not exist (migration 0047 not applied). */
export async function writeD1ChartCache(
  db: D1Database,
  section: ChartCacheSection,
  representation: 'day' | 'change',
  scope: ChartCacheScope,
  result: { rows: Array<Record<string, unknown>> },
): Promise<void> {
  const rawJson = JSON.stringify({ v: CHART_PIVOT_PAYLOAD_VERSION, rows: result.rows })
  const payloadJson =
    rawJson.length <= MAX_UNCOMPRESSED_CHARS ? rawJson : `${GZIP_PREFIX}${await gzipToBase64(rawJson)}`
  const builtAt = new Date().toISOString()
  try {
    await db
      .prepare(
        `INSERT INTO ${CACHE_TABLE} (section, representation, request_scope, payload_json, row_count, built_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (section, representation, request_scope) DO UPDATE SET
           payload_json = excluded.payload_json,
           row_count = excluded.row_count,
           built_at = excluded.built_at`,
      )
      .bind(section, representation, scope, payloadJson, result.rows.length, builtAt)
      .run()
  } catch (e) {
    if (!isNoSuchTableError(e, CACHE_TABLE)) throw e
  }
  if (scope === 'default') {
    await writeLegacyD1ChartCache(db, section, representation, payloadJson, result.rows.length, builtAt)
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

export function buildPrecomputedChartScope(window: ChartWindow | null): ChartCacheScope {
  return buildPrecomputedChartScopeForPreset(window, null)
}

export function buildPrecomputedChartScopeForPreset(
  window: ChartWindow | null,
  preset: ChartCachePreset | null,
): ChartCacheScope {
  if (preset === 'consumer-default') {
    return window ? `${CONSUMER_DEFAULT_SCOPE}:window:${window}` : CONSUMER_DEFAULT_SCOPE
  }
  return window ? buildChartWindowScope(window) : 'default'
}

export function buildPrecomputedChartParams(
  scope: ChartCacheScope,
): Record<string, string | undefined> {
  if (scope === 'default' || scope === CONSUMER_DEFAULT_SCOPE) return {}
  if (scope.startsWith(`${CONSUMER_DEFAULT_SCOPE}:window:`)) {
    return { chart_window: scope.slice(`${CONSUMER_DEFAULT_SCOPE}:window:`.length) }
  }
  return { chart_window: scope.slice('window:'.length) }
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

  const cacheScope = resolveChartCacheScope(section, params)
  if (cacheScope) {
    const d1Cached = await readD1ChartCache(env.DB, section, representation, cacheScope)
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
  if (cacheScope) {
    try {
      await writeD1ChartCache(env.DB, section, representation, cacheScope, result)
    } catch {
      /* ignore D1 cache write failure on live requests */
    }
  }
  if (env.CHART_CACHE_KV) {
    try {
      await env.CHART_CACHE_KV.put(key, JSON.stringify(result), { expirationTtl: CHART_CACHE_KV_TTL })
    } catch {
      /* ignore KV write failure */
    }
  }
  return { ...result, fromCache: 'live' }
}
