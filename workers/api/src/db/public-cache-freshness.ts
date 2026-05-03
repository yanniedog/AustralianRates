import { getMelbourneNowParts } from '../utils/time'

export const PUBLIC_DAILY_CACHE_TTL_SECONDS = 36 * 60 * 60
const PUBLIC_DAILY_CACHE_TTL_MS = PUBLIC_DAILY_CACHE_TTL_SECONDS * 1000

export type PublicCacheMetadata = {
  payloadVersion: number
  builtAt: string
  cacheDate: string
  filtersResolved?: {
    startDate?: string
    endDate?: string
  }
  sourceRunFinishedAt?: string | null
}

export type PublicCacheFreshnessInput = {
  builtAt: string
  filtersResolved?: {
    startDate?: unknown
    endDate?: unknown
  }
  sourceRunFinishedAt?: string | null
  latestRunFinishedAt?: string | null
  now?: Date
  timeZone?: string
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function melbourneDateFor(date: Date, timeZone = 'Australia/Melbourne'): string {
  return getMelbourneNowParts(date, timeZone).date
}

function previousMelbourneDate(now: Date, timeZone = 'Australia/Melbourne'): string {
  return melbourneDateFor(new Date(now.getTime() - 86400000), timeZone)
}

export function inferFiltersResolvedFromRows(
  rows: Array<Record<string, unknown>>,
): PublicCacheMetadata['filtersResolved'] {
  let startDate: string | undefined
  let endDate: string | undefined
  for (const row of rows) {
    const value = String(row.collection_date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) continue
    if (startDate === undefined || value < startDate) startDate = value
    if (endDate === undefined || value > endDate) endDate = value
  }
  if (startDate === undefined) return undefined
  return {
    startDate,
    endDate,
  }
}

export function publicCacheMetadata(
  payloadVersion: number,
  builtAt: string,
  input?: {
    filtersResolved?: PublicCacheMetadata['filtersResolved']
    sourceRunFinishedAt?: string | null
    now?: Date
  },
): PublicCacheMetadata {
  return {
    payloadVersion,
    builtAt,
    cacheDate: melbourneDateFor(input?.now ?? new Date()),
    filtersResolved: input?.filtersResolved,
    sourceRunFinishedAt: input?.sourceRunFinishedAt ?? null,
  }
}

export function isPublicDailyCacheFresh(input: PublicCacheFreshnessInput): boolean {
  const now = input.now ?? new Date()
  const builtMs = parseMs(input.builtAt)
  if (builtMs == null) return false
  if (now.getTime() - builtMs > PUBLIC_DAILY_CACHE_TTL_MS) return false

  const endDate = input.filtersResolved?.endDate
  if (typeof endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false
  const today = melbourneDateFor(now, input.timeZone)
  const yesterday = previousMelbourneDate(now, input.timeZone)
  if (endDate !== today && endDate !== yesterday) return false

  const latestRunMs = parseMs(input.latestRunFinishedAt)
  if (latestRunMs == null) return true
  const sourceRunMs = parseMs(input.sourceRunFinishedAt)
  if (sourceRunMs != null) return sourceRunMs >= latestRunMs
  return builtMs >= latestRunMs
}
