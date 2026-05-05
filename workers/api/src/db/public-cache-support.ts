import type { ChartCacheSection } from './chart-cache'
import { queryLatestHomeLoanMaxCollectionDate } from './home-loans/latest'
import { queryLatestSavingsMaxCollectionDate } from './savings/latest'
import { queryLatestTdMaxCollectionDate } from './term-deposits/latest'
import { log } from '../utils/logger'

export const KV_VALUE_SAFE_BYTE_LIMIT = 24 * 1024 * 1024

const oversizeKvLogCounts = new Map<string, number>()

function jsonByteLength(value: string): number {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value).length : value.length
}

function shouldLogOversizeKv(source: string, key: string): boolean {
  const signature = `${source}:${key.slice(0, 96)}`
  const count = oversizeKvLogCounts.get(signature) ?? 0
  oversizeKvLogCounts.set(signature, count + 1)
  return count < 3
}

export function serializeJsonForKv(
  key: string,
  payload: unknown,
  input: { source: string; context?: Record<string, unknown> },
): string | null {
  const serialized = JSON.stringify(payload)
  const bytes = jsonByteLength(serialized)
  if (bytes < KV_VALUE_SAFE_BYTE_LIMIT) return serialized
  if (shouldLogOversizeKv(input.source, key)) {
    log.warn('public_cache', 'kv_write_skipped_oversize', {
      code: 'kv_write_skipped_oversize',
      context: JSON.stringify({
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
