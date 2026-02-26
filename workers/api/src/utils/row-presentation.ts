import type { RetrievalType } from '../types'

type RowRecord = Record<string, unknown>

const WAYBACK_PREFIX = 'web.archive.org/web/'
const WAYBACK_TS_RE = /\/web\/(\d{14})(?:id_)?\//i

function asText(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toTitleWords(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function humanizeCode(value: unknown): string {
  const raw = asText(value)
  if (!raw) return ''
  const spaced = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  return toTitleWords(spaced)
}

function trimTrailingZeros(input: string): string {
  if (!input.includes('.')) return input
  return input.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
}

function formatCompactAmount(value: number): string {
  if (value >= 1_000_000) {
    return `$${trimTrailingZeros((value / 1_000_000).toFixed(1))}m`
  }
  if (value >= 1_000) {
    return `$${trimTrailingZeros((value / 1_000).toFixed(1))}k`
  }
  return `$${trimTrailingZeros(value.toFixed(value % 1 === 0 ? 0 : 2))}`
}

function normalizeAmountToken(token: string): string {
  const raw = asText(token).replace(/\s+/g, '')
  if (!raw) return ''

  const numericMatch = raw.match(/^\$?(\d+(?:\.\d+)?)([kKmM]?)$/)
  if (numericMatch) {
    const amount = Number(numericMatch[1])
    const suffix = numericMatch[2].toLowerCase()
    if (!Number.isFinite(amount)) return raw
    if (!suffix) return formatCompactAmount(amount)
    return `$${trimTrailingZeros(amount.toFixed(1))}${suffix}`.replace(/\.0([km])$/, '$1')
  }

  return raw.replace(/\.0(?=[kKmM]\b)/g, '').replace(/[kKmM]\b/g, (m) => m.toLowerCase())
}

function normalizeRawDepositTier(value: unknown): string {
  const raw = asText(value)
  if (!raw) return ''
  if (raw.toLowerCase() === 'all') return 'All balances'

  const range = raw.split('-')
  if (range.length === 2) {
    const start = normalizeAmountToken(range[0])
    const end = normalizeAmountToken(range[1])
    if (start && end) return `${start} to ${end}`
  }

  if (/\+$/.test(raw)) {
    return `${normalizeAmountToken(raw.slice(0, -1))}+`
  }

  const upTo = raw.match(/^up\s*to\s+(.+)$/i)
  if (upTo) {
    return `Up to ${normalizeAmountToken(upTo[1])}`
  }

  return normalizeAmountToken(raw)
}

function formatDepositTierDisplay(rawTier: unknown, minValue: unknown, maxValue: unknown): string {
  const min = asNumber(minValue)
  const max = asNumber(maxValue)
  if (min != null || max != null) {
    if (min != null && max != null) return `${formatCompactAmount(min)} to ${formatCompactAmount(max)}`
    if (min != null) return `${formatCompactAmount(min)}+`
    if (max != null) return `Up to ${formatCompactAmount(max)}`
  }

  const raw = asText(rawTier)
  if (!raw) return ''
  return normalizeRawDepositTier(raw)
}

export function cleanConditionsText(value: unknown): string {
  const raw = asText(value)
  if (!raw) return ''

  const parts = raw.split(/[\n|]+/)
  const seen = new Set<string>()
  const cleaned: string[] = []

  for (const part of parts) {
    const normalized = part.replace(/\s+/g, ' ').trim()
    if (!normalized) continue
    if (/^P(?:\d+[YMWD])*(?:T\d+[HMS])*$/i.test(normalized)) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push(normalized)
  }

  return cleaned.join(' | ')
}

function isWaybackUrl(url: unknown): boolean {
  return asText(url).toLowerCase().includes(WAYBACK_PREFIX)
}

function normalizeTimestamp(value: unknown): string {
  const raw = asText(value)
  if (!raw) return ''

  let normalized = raw
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    normalized = `${raw}T00:00:00Z`
  } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    normalized = raw.replace(' ', 'T') + 'Z'
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    normalized = `${raw}Z`
  }

  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toISOString()
}

function waybackPublishedAt(sourceUrl: unknown): string {
  const raw = asText(sourceUrl)
  const match = raw.match(WAYBACK_TS_RE)
  if (!match) return ''
  const ts = match[1]
  if (ts.length !== 14) return ''
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`
}

export function presentCoreRowFields<T extends RowRecord>(row: T): T & Record<string, unknown> {
  const sourceUrl = asText(row.source_url)
  const productUrl = asText(row.product_url)
  const publishedAt = normalizeTimestamp(row.published_at) || waybackPublishedAt(sourceUrl)
  const retrievedAt = asText(row.retrieved_at) || asText(row.parsed_at)
  const firstRetrievedAt = asText(row.first_retrieved_at)

  return {
    ...row,
    product_url: productUrl,
    published_at: publishedAt,
    retrieved_at: retrievedAt,
    first_retrieved_at: firstRetrievedAt,
  }
}

function canonicalRetrievalType(row: RowRecord): RetrievalType {
  const retrievalType = asText(row.retrieval_type).toLowerCase()
  const qualityFlag = asText(row.data_quality_flag).toLowerCase()
  if (
    retrievalType === 'historical_scrape' ||
    qualityFlag.startsWith('parsed_from_wayback') ||
    isWaybackUrl(row.source_url)
  ) {
    return 'historical_scrape'
  }
  return 'present_scrape_same_date'
}

function retrievalTypeDisplay(value: RetrievalType): string {
  return value === 'historical_scrape' ? 'Historical scrape' : 'Present scrape (same date)'
}

function dataQualityDisplay(value: unknown): string {
  const flag = asText(value).toLowerCase()
  if (!flag) return ''
  if (flag.startsWith('parsed_from_wayback')) return 'Historical (Wayback)'
  if (flag.startsWith('cdr_live')) return 'CDR live'
  if (flag.startsWith('scraped_fallback')) return 'Web fallback'
  if (flag === 'ok') return 'Legacy verified'
  return humanizeCode(flag)
}

function securityPurposeDisplay(value: unknown): string {
  const v = asText(value).toLowerCase()
  if (v === 'owner_occupied') return 'Owner occupied'
  if (v === 'investment') return 'Investment'
  return humanizeCode(v)
}

function repaymentTypeDisplay(value: unknown): string {
  const v = asText(value).toLowerCase()
  if (v === 'principal_and_interest') return 'Principal & Interest'
  if (v === 'interest_only') return 'Interest only'
  return humanizeCode(v)
}

function rateStructureDisplay(value: unknown): string {
  const v = asText(value).toLowerCase()
  if (v === 'variable') return 'Variable'
  const fixed = v.match(/^fixed_(\d+)yr$/)
  if (fixed) {
    const years = Number(fixed[1])
    const suffix = years === 1 ? 'year' : 'years'
    return `Fixed ${years} ${suffix}`
  }
  return humanizeCode(v)
}

function lvrTierDisplay(value: unknown): string {
  const v = asText(value).toLowerCase()
  if (v === 'lvr_=60%') return '<=60%'
  const range = v.match(/^lvr_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%$/)
  if (range) return `${range[1]}-${range[2]}%`
  return humanizeCode(v)
}

function featureSetDisplay(value: unknown): string {
  const v = asText(value).toLowerCase()
  if (v === 'basic') return 'Basic'
  if (v === 'premium') return 'Premium'
  return humanizeCode(v)
}

function accountTypeDisplay(value: unknown): string {
  const v = asText(value).toLowerCase()
  if (v === 'at_call') return 'At call'
  return humanizeCode(v)
}

function rateTypeDisplay(value: unknown): string {
  return humanizeCode(value)
}

function interestPaymentDisplay(value: unknown): string {
  const v = asText(value).toLowerCase()
  if (v === 'at_maturity') return 'At maturity'
  return humanizeCode(v)
}

function termMonthsDisplay(value: unknown): string {
  const n = asNumber(value)
  if (n == null) return asText(value)
  const months = Math.round(n)
  return `${months} month${months === 1 ? '' : 's'}`
}

function withBaseDisplayFields<T extends RowRecord>(row: T): T & Record<string, unknown> {
  const core = presentCoreRowFields(row)
  const canonical = canonicalRetrievalType(core)
  return {
    ...core,
    retrieval_type_canonical: canonical,
    retrieval_type_display: retrievalTypeDisplay(canonical),
    data_quality_display: dataQualityDisplay(core.data_quality_flag),
  }
}

export function presentHomeLoanRow<T extends RowRecord>(row: T): T & Record<string, unknown> {
  const base = withBaseDisplayFields(row)
  return {
    ...base,
    security_purpose_display: securityPurposeDisplay(base.security_purpose),
    repayment_type_display: repaymentTypeDisplay(base.repayment_type),
    rate_structure_display: rateStructureDisplay(base.rate_structure),
    lvr_tier_display: lvrTierDisplay(base.lvr_tier),
    feature_set_display: featureSetDisplay(base.feature_set),
  }
}

export function presentSavingsRow<T extends RowRecord>(row: T): T & Record<string, unknown> {
  const base = withBaseDisplayFields(row)
  return {
    ...base,
    account_type_display: accountTypeDisplay(base.account_type),
    rate_type_display: rateTypeDisplay(base.rate_type),
    deposit_tier_display: formatDepositTierDisplay(base.deposit_tier, base.min_balance, base.max_balance),
    conditions_display: cleanConditionsText(base.conditions),
  }
}

export function presentTdRow<T extends RowRecord>(row: T): T & Record<string, unknown> {
  const base = withBaseDisplayFields(row)
  return {
    ...base,
    interest_payment_display: interestPaymentDisplay(base.interest_payment),
    deposit_tier_display: formatDepositTierDisplay(base.deposit_tier, base.min_deposit, base.max_deposit),
    term_months_display: termMonthsDisplay(base.term_months),
  }
}
