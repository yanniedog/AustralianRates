import type { ChartCacheSection } from './chart-cache'
import { queryLatestHomeLoanMaxCollectionDate } from './home-loans/latest'
import { queryLatestSavingsMaxCollectionDate } from './savings/latest'
import { queryLatestTdMaxCollectionDate } from './term-deposits/latest'
import { log } from '../utils/logger'

export const KV_VALUE_SAFE_BYTE_LIMIT = 24 * 1024 * 1024
const OVERSIZE_KV_LOG_LIMIT_PER_ISOLATE = 20
const STALE_CACHE_LOG_LIMIT_PER_ISOLATE = 20
const LATEST_SECTION_MAX_CACHE_TTL_MS = 60_000

let oversizeKvLogCount = 0
let staleCacheLogCount = 0
const latestSectionMaxCache = new Map<ChartCacheSection, { expiresAt: number; value: string | null }>()

function jsonByteLength(value: string): number {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value).length : value.length
}

function shouldLogOversizeKv(): boolean {
  oversizeKvLogCount += 1
  return oversizeKvLogCount <= OVERSIZE_KV_LOG_LIMIT_PER_ISOLATE
}

function safeLogContext(context: Record<string, unknown>): Record<string, unknown> {
  try {
    JSON.stringify(context)
    return context
  } catch {
    return {
      source: context.source,
      key: context.key,
      bytes: context.bytes,
      limit: context.limit,
      context_serialization_failed: true,
    }
  }
}

export function serializeJsonForKv(
  key: string,
  payload: unknown,
  input: { source: string; context?: Record<string, unknown> },
): string | null {
  const serialized = JSON.stringify(payload)
  const bytes = jsonByteLength(serialized)
  if (bytes < KV_VALUE_SAFE_BYTE_LIMIT) return serialized
  if (shouldLogOversizeKv()) {
    log.warn('public_cache', 'kv_write_skipped_oversize', {
      code: 'kv_write_skipped_oversize',
      context: safeLogContext({
        source: input.source,
        key: key.slice(0, 160),
        bytes,
        limit: KV_VALUE_SAFE_BYTE_LIMIT,
        ...(input.context ?? {}),
      }),
    })
  }
  return null
}

export function logPublicCacheWedgedSection(input: {
  source: string
  section: ChartCacheSection
  scope: string
  builtAt: string
  endDate: string | null
  latestAvailableCollectionDate?: string | null
  cacheKind?: string
}): void {
  log.warn('public_cache', 'public_cache_wedged_section', {
    code: 'public_cache_wedged_section',
    context: JSON.stringify({
      source: input.source,
      section: input.section,
      scope: input.scope,
      cache_kind: input.cacheKind ?? null,
      built_at: input.builtAt,
      end_date: input.endDate,
      latest_available_collection_date: input.latestAvailableCollectionDate ?? null,
    }),
  })
}

export function logPublicCacheServedBoundedStale(input: {
  source: string
  section: ChartCacheSection
  scope: string
  builtAt: string
  endDate: string | null
  latestAvailableCollectionDate?: string | null
  cacheKind?: string
  reason?: string | null
}): void {
  staleCacheLogCount += 1
  if (staleCacheLogCount > STALE_CACHE_LOG_LIMIT_PER_ISOLATE) return
  log.warn('public_cache', 'public_cache_served_bounded_stale', {
    code: 'public_cache_served_bounded_stale',
    context: JSON.stringify({
      source: input.source,
      section: input.section,
      scope: input.scope,
      cache_kind: input.cacheKind ?? null,
      built_at: input.builtAt,
      end_date: input.endDate,
      latest_available_collection_date: input.latestAvailableCollectionDate ?? null,
      reason: input.reason ?? null,
    }),
  })
}

export type PublicCacheReadFreshnessOptions = {
  latestRunFinishedAt?: string | null
  latestAvailableCollectionDate?: string | null
  allowStaleWithinCanary?: boolean
  now?: Date
  timeZone?: string
}

export function buildPublicCacheReadFreshnessOptions(
  options?: PublicCacheReadFreshnessOptions,
): PublicCacheReadFreshnessOptions {
  const readOptions: PublicCacheReadFreshnessOptions = {
    latestAvailableCollectionDate: options?.latestAvailableCollectionDate ?? null,
    allowStaleWithinCanary: options?.allowStaleWithinCanary ?? false,
    now: options?.now,
    timeZone: options?.timeZone,
  }
  if (options && Object.prototype.hasOwnProperty.call(options, 'latestRunFinishedAt')) {
    readOptions.latestRunFinishedAt = options.latestRunFinishedAt ?? null
  }
  return readOptions
}

export async function queryLatestSectionMaxCollectionDate(
  db: D1Database,
  section: ChartCacheSection,
): Promise<string | null> {
  try {
    if (section === 'home_loans') return queryLatestHomeLoanMaxCollectionDate(db, {})
    if (section === 'savings') return queryLatestSavingsMaxCollectionDate(db, {})
    return queryLatestTdMaxCollectionDate(db, {})
  } catch {
    return null
  }
}

export async function queryCachedLatestSectionMaxCollectionDate(
  db: D1Database,
  section: ChartCacheSection,
): Promise<string | null> {
  const now = Date.now()
  const cached = latestSectionMaxCache.get(section)
  if (cached && cached.expiresAt > now) return cached.value
  const value = await queryLatestSectionMaxCollectionDate(db, section)
  latestSectionMaxCache.set(section, { value, expiresAt: now + LATEST_SECTION_MAX_CACHE_TTL_MS })
  return value
}
