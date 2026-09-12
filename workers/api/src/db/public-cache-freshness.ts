import { getMelbourneNowParts } from '../utils/time'

export const PUBLIC_DAILY_CACHE_TTL_SECONDS = 36 * 60 * 60
const PUBLIC_DAILY_CACHE_TTL_MS = PUBLIC_DAILY_CACHE_TTL_SECONDS * 1000
export const PUBLIC_DAILY_CACHE_MAX_STALENESS_DAYS = 14

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
  latestAvailableCollectionDate?: string | null
  now?: Date
  timeZone?: string
}

export type PublicCacheFreshnessRejectionReason =
  | 'invalid_built_at'
  | 'built_at_too_old'
  | 'invalid_end_date'
  | 'end_date_beyond_max_staleness'
  | 'end_date_after_latest_available'
  | 'end_date_behind_latest_available'
  | 'end_date_not_current_or_latest'
  | 'source_older_than_latest_run'

export type PublicCacheFreshnessStatus = {
  fresh: boolean
  reason: PublicCacheFreshnessRejectionReason | null
  endDate: string | null
  today: string
  yesterday: string
}

export type PublicCacheStaleServeStatus = PublicCacheFreshnessStatus & {
  canServe: boolean
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

function parseYmdMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(ms) ? ms : null
}

function calendarDaysBetween(startYmd: string, endYmd: string): number | null {
  const startMs = parseYmdMs(startYmd)
  const endMs = parseYmdMs(endYmd)
  if (startMs == null || endMs == null) return null
  return Math.round((endMs - startMs) / 86400000)
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

export function publicCacheFreshnessStatus(input: PublicCacheFreshnessInput): PublicCacheFreshnessStatus {
  const now = input.now ?? new Date()
  const today = melbourneDateFor(now, input.timeZone)
  const yesterday = previousMelbourneDate(now, input.timeZone)
  const reject = (
    reason: PublicCacheFreshnessRejectionReason,
    endDate: string | null = null,
  ): PublicCacheFreshnessStatus => ({
    fresh: false,
    reason,
    endDate,
    today,
    yesterday,
  })
  const builtMs = parseMs(input.builtAt)
  if (builtMs == null) return reject('invalid_built_at')
  if (now.getTime() - builtMs > PUBLIC_DAILY_CACHE_TTL_MS) return reject('built_at_too_old')

  const endDate = input.filtersResolved?.endDate
  if (typeof endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return reject('invalid_end_date')
  const daysBehindToday = calendarDaysBetween(endDate, today)
  if (daysBehindToday != null && daysBehindToday > PUBLIC_DAILY_CACHE_MAX_STALENESS_DAYS) {
    return reject('end_date_beyond_max_staleness', endDate)
  }

  const latestAvailable =
    typeof input.latestAvailableCollectionDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.latestAvailableCollectionDate)
      ? input.latestAvailableCollectionDate
      : null
  if (latestAvailable != null && endDate > latestAvailable) {
    return reject('end_date_after_latest_available', endDate)
  }
  if (latestAvailable != null && endDate < latestAvailable) {
    return reject('end_date_behind_latest_available', endDate)
  }
  if (endDate !== today && endDate !== yesterday && endDate !== latestAvailable) {
    return reject('end_date_not_current_or_latest', endDate)
  }

  const latestRunMs = parseMs(input.latestRunFinishedAt)
  if (latestRunMs == null) return { fresh: true, reason: null, endDate, today, yesterday }
  const sourceRunMs = parseMs(input.sourceRunFinishedAt)
  const sourceFresh = sourceRunMs != null ? sourceRunMs >= latestRunMs : builtMs >= latestRunMs
  return sourceFresh
    ? { fresh: true, reason: null, endDate, today, yesterday }
    : reject('source_older_than_latest_run', endDate)
}

export function isPublicDailyCacheFresh(input: PublicCacheFreshnessInput): boolean {
  return publicCacheFreshnessStatus(input).fresh
}

export function publicCacheStaleServeStatus(
  input: PublicCacheFreshnessInput,
  freshness: PublicCacheFreshnessStatus = publicCacheFreshnessStatus(input),
): PublicCacheStaleServeStatus {
  if (freshness.fresh) {
    return { ...freshness, canServe: true }
  }
  const { today, yesterday } = freshness
  const rawEndDate = freshness.endDate ?? input.filtersResolved?.endDate
  if (parseMs(input.builtAt) == null || typeof rawEndDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawEndDate)) {
    return { ...freshness, canServe: false }
  }
  const endDate = rawEndDate
  const daysBehindToday = calendarDaysBetween(endDate, today)
  if (daysBehindToday != null && daysBehindToday > PUBLIC_DAILY_CACHE_MAX_STALENESS_DAYS) {
    return { ...freshness, canServe: false, reason: 'end_date_beyond_max_staleness', endDate }
  }

  const latestAvailable =
    typeof input.latestAvailableCollectionDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.latestAvailableCollectionDate)
      ? input.latestAvailableCollectionDate
      : null
  if (latestAvailable != null && endDate > latestAvailable) {
    return { ...freshness, canServe: false, reason: 'end_date_after_latest_available', endDate }
  }
  if (latestAvailable == null && endDate !== today && endDate !== yesterday) {
    return { ...freshness, canServe: false, endDate }
  }
  // Same-day endDate can match latestAvailable while sourceRunFinishedAt predates the
  // latest completed ingest. Serving that bounded-stale package shows today's date
  // with pre-ingest rates (Pages middleware rejects; API must not serve it either).
  if (freshness.reason === 'source_older_than_latest_run') {
    return { ...freshness, canServe: false, endDate }
  }
  return { ...freshness, canServe: true, endDate }
}
