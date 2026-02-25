/**
 * Shared validation helpers for ingest. Used by normalize.ts and normalize-savings.ts
 * so all rate data passes a consistent battery of checks before DB write.
 */

const COLLECTION_DATE_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/
const MIN_COLLECTION_DATE = '1990-01-01'
const MAX_COLLECTION_DATE_OFFSET_DAYS = 1
const MAX_BANK_NAME_LENGTH = 200
const MAX_SOURCE_URL_LENGTH = 2048
const MAX_PRODUCT_ID_LENGTH = 256
const MAX_PRODUCT_NAME_LENGTH = 500
const MAX_DEPOSIT_TIER_LENGTH = 200
const MAX_RUN_ID_LENGTH = 64

const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/

function toDate(s: string): Date | null {
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

export function isValidCollectionDate(date: string): boolean {
  if (!date || typeof date !== 'string') return false
  const trimmed = date.trim()
  if (!COLLECTION_DATE_REGEX.test(trimmed)) return false
  const d = toDate(trimmed)
  if (!d) return false
  const min = new Date(MIN_COLLECTION_DATE)
  const max = new Date()
  max.setDate(max.getDate() + MAX_COLLECTION_DATE_OFFSET_DAYS)
  return d >= min && d <= max
}

export function isValidUrl(url: string, maxLength = MAX_SOURCE_URL_LENGTH): boolean {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim()
  if (trimmed.length > maxLength) return false
  if (CONTROL_CHAR_REGEX.test(trimmed)) return false
  return trimmed.startsWith('http://') || trimmed.startsWith('https://')
}

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export function allowedEnum<T extends string>(value: unknown, allowlist: readonly T[]): value is T {
  if (value == null || typeof value !== 'string') return false
  return (allowlist as readonly string[]).includes(value.trim())
}

export function isAllowedDataQualityFlag(flag: string, allowlist: readonly string[]): boolean {
  if (!flag || typeof flag !== 'string') return false
  const normalized = flag.trim().toLowerCase()
  return allowlist.some((a) => a.toLowerCase() === normalized)
}

export function reasonableStringLength(
  s: string | null | undefined,
  max: number,
  min = 1,
): boolean {
  if (s == null || typeof s !== 'string') return false
  const trimmed = s.trim()
  return trimmed.length >= min && trimmed.length <= max && !CONTROL_CHAR_REGEX.test(trimmed)
}

export function nonEmptyTrimmed(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.trim().length > 0
}

export const VALIDATE_COMMON = {
  MAX_BANK_NAME_LENGTH,
  MAX_SOURCE_URL_LENGTH,
  MAX_PRODUCT_ID_LENGTH,
  MAX_PRODUCT_NAME_LENGTH,
  MAX_DEPOSIT_TIER_LENGTH,
  MAX_RUN_ID_LENGTH,
  isValidCollectionDate,
  isValidUrl,
  isFiniteNumber,
  allowedEnum,
  isAllowedDataQualityFlag,
  reasonableStringLength,
  nonEmptyTrimmed,
} as const
