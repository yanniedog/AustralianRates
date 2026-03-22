import { upsertRbaCashRate } from '../db/rba-cash-rate'
import type { EnvBindings } from '../types'
import { FetchWithTimeoutError, fetchWithTimeout, hostFromUrl } from '../utils/fetch-with-timeout'
import { log } from '../utils/logger'

const RBA_F1_DATA_URL = 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv'
const RBA_DECISIONS_URL = 'https://www.rba.gov.au/statistics/cash-rate/'

export type RbaPoint = {
  date: string
  cashRate: number
}

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
}

function toIsoDate(value: string): string | null {
  const m = value.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/)
  if (!m) return null
  const month = MONTHS[m[2].toLowerCase()]
  if (!month) return null
  return `${m[3]}-${month}-${m[1]}`
}

// Parses dates like "18 Mar 2026" or "8 Mar 2026" from the RBA decisions HTML table.
function htmlDateToIso(value: string): string | null {
  const m = value.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/)
  if (!m) return null
  const month = MONTHS[m[2].toLowerCase()]
  if (!month) return null
  return `${m[3]}-${month}-${m[1].padStart(2, '0')}`
}

/**
 * Parses the RBA cash rate decisions HTML page (https://www.rba.gov.au/statistics/cash-rate/).
 * Returns one RbaPoint per rate-decision row. This source updates immediately after each
 * board announcement, unlike the F1 CSV which can lag by several days.
 */
export function parseHtmlDecisions(html: string): RbaPoint[] {
  const points: RbaPoint[] = []
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/)
  if (!tbodyMatch) return points
  const rowRegex = /<tr[\s\S]*?<\/tr>/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRegex.exec(tbodyMatch[1])) !== null) {
    const row = rowMatch[0]
    const dateMatch = row.match(/<th[^>]*scope="row"[^>]*>([\s\S]*?)<\/th>/)
    if (!dateMatch) continue
    const dateText = dateMatch[1].replace(/<[^>]+>/g, '').trim()
    const isoDate = htmlDateToIso(dateText)
    if (!isoDate) continue
    // Table columns: [change, cash rate target, links] — rate is the second <td>
    const tdMatches = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
    if (tdMatches.length < 2) continue
    const rateText = tdMatches[1][1].replace(/<[^>]+>/g, '').trim()
    const cashRate = Number(rateText)
    if (!Number.isFinite(cashRate) || cashRate <= 0) continue
    points.push({ date: isoDate, cashRate })
  }
  return points
}

export function parseCsvLines(csv: string): RbaPoint[] {
  const lines = csv.split(/\r?\n/)
  const points: RbaPoint[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(',')
    if (parts.length < 2) continue
    const isoDate = toIsoDate(parts[0])
    if (!isoDate) continue
    const cashRate = Number(parts[1])
    if (!Number.isFinite(cashRate) || cashRate <= 0) continue
    points.push({
      date: isoDate,
      cashRate,
    })
  }
  return points
}

function latestPointOnOrBefore(points: RbaPoint[], collectionDate: string): RbaPoint | null {
  let best: RbaPoint | null = null
  for (const p of points) {
    if (p.date > collectionDate) continue
    if (!best || p.date > best.date) {
      best = p
    }
  }
  return best
}

export async function collectRbaCashRateForDate(
  db: D1Database,
  collectionDate: string,
  env?: Pick<EnvBindings, 'FETCH_TIMEOUT_MS' | 'FETCH_MAX_RETRIES' | 'FETCH_RETRY_BASE_MS' | 'FETCH_RETRY_CAP_MS'>,
): Promise<{ ok: boolean; cashRate: number | null; effectiveDate: string | null; sourceUrl: string }> {
  // Attempt 1: HTML decisions page — authoritative, updates immediately after each announcement.
  try {
    const fetched = await fetchWithTimeout(RBA_DECISIONS_URL, undefined, { env })
    const response = fetched.response
    log.info('pipeline', 'upstream_fetch', {
      context:
        `source=rba_html host=${hostFromUrl(RBA_DECISIONS_URL)}` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} upstream_ms=${fetched.meta.elapsed_ms}` +
        ` attempts=${fetched.meta.attempts} retry_count=${Math.max(0, fetched.meta.attempts - 1)}` +
        ` timed_out=${fetched.meta.timed_out ? 1 : 0} timeout=${fetched.meta.timed_out ? 1 : 0}` +
        ` status=${fetched.meta.status ?? response.status}`,
    })
    if (response.ok) {
      const html = await response.text()
      const points = parseHtmlDecisions(html)
      const nearest = latestPointOnOrBefore(points, collectionDate)
      if (nearest) {
        await upsertRbaCashRate(db, {
          collectionDate,
          cashRate: nearest.cashRate,
          effectiveDate: nearest.date,
          sourceUrl: RBA_DECISIONS_URL,
        })
        return { ok: true, cashRate: nearest.cashRate, effectiveDate: nearest.date, sourceUrl: RBA_DECISIONS_URL }
      }
    }
    log.warn('pipeline', 'rba_html_fallback', {
      context: `collectionDate=${collectionDate} status=${fetched.meta.status ?? 0} reason=no_points_or_non_ok`,
    })
  } catch (error) {
    const meta = error instanceof FetchWithTimeoutError ? error.meta : null
    log.warn('pipeline', 'rba_html_fallback', {
      context:
        `collectionDate=${collectionDate} reason=fetch_error` +
        ` elapsed_ms=${meta?.elapsed_ms ?? 0} status=${meta?.status ?? 0}`,
    })
  }

  // Attempt 2: F1 CSV fallback.
  try {
    const fetched = await fetchWithTimeout(RBA_F1_DATA_URL, undefined, { env })
    const response = fetched.response
    log.info('pipeline', 'upstream_fetch', {
      context:
        `source=rba_csv host=${hostFromUrl(RBA_F1_DATA_URL)}` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} upstream_ms=${fetched.meta.elapsed_ms}` +
        ` attempts=${fetched.meta.attempts} retry_count=${Math.max(0, fetched.meta.attempts - 1)}` +
        ` timed_out=${fetched.meta.timed_out ? 1 : 0} timeout=${fetched.meta.timed_out ? 1 : 0}` +
        ` status=${fetched.meta.status ?? response.status}`,
    })
    const csv = await response.text()
    if (!response.ok) {
      return { ok: false, cashRate: null, effectiveDate: null, sourceUrl: RBA_F1_DATA_URL }
    }
    const points = parseCsvLines(csv)
    const nearest = latestPointOnOrBefore(points, collectionDate)
    if (!nearest) {
      return { ok: false, cashRate: null, effectiveDate: null, sourceUrl: RBA_F1_DATA_URL }
    }
    await upsertRbaCashRate(db, {
      collectionDate,
      cashRate: nearest.cashRate,
      effectiveDate: nearest.date,
      sourceUrl: RBA_F1_DATA_URL,
    })
    return { ok: true, cashRate: nearest.cashRate, effectiveDate: nearest.date, sourceUrl: RBA_F1_DATA_URL }
  } catch (error) {
    const meta = error instanceof FetchWithTimeoutError ? error.meta : null
    log.warn('pipeline', 'upstream_fetch', {
      context:
        `source=rba_csv host=${hostFromUrl(RBA_F1_DATA_URL)}` +
        ` elapsed_ms=${meta?.elapsed_ms ?? 0} upstream_ms=${meta?.elapsed_ms ?? 0}` +
        ` attempts=${meta?.attempts ?? 1} retry_count=${Math.max(0, (meta?.attempts ?? 1) - 1)}` +
        ` timed_out=${meta?.timed_out ? 1 : 0} timeout=${meta?.timed_out ? 1 : 0}` +
        ` status=${meta?.status ?? 0}`,
    })
    return { ok: false, cashRate: null, effectiveDate: null, sourceUrl: RBA_F1_DATA_URL }
  }
}

function* dateRangeInclusive(startDate: string, endDate: string): Generator<string> {
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (start.getTime() > end.getTime()) return
  const cur = new Date(start)
  while (cur.getTime() <= end.getTime()) {
    yield cur.toISOString().slice(0, 10)
    cur.setDate(cur.getDate() + 1)
  }
}

export type BackfillRbaResult = {
  ok: boolean
  upserted: number
  skipped: number
  startDate: string
  endDate: string
  sourceUrl: string
  message?: string
}

/**
 * Fetches the RBA F1 CSV once and upserts rba_cash_rates for every date in [startDate, endDate].
 * Use to backfill missing RBA rows (e.g. days when the daily run skipped with already_fresh_for_date).
 */
export async function backfillRbaCashRatesForDateRange(
  db: D1Database,
  startDate: string,
  endDate: string,
  env?: Pick<EnvBindings, 'FETCH_TIMEOUT_MS' | 'FETCH_MAX_RETRIES' | 'FETCH_RETRY_BASE_MS' | 'FETCH_RETRY_CAP_MS'>,
): Promise<BackfillRbaResult> {
  // Try HTML decisions page first (most authoritative, full history to 1990).
  let points: RbaPoint[] = []
  let sourceUrl = RBA_DECISIONS_URL
  try {
    const fetched = await fetchWithTimeout(RBA_DECISIONS_URL, undefined, { env })
    const response = fetched.response
    log.info('pipeline', 'upstream_fetch', {
      context:
        `source=rba_html host=${hostFromUrl(RBA_DECISIONS_URL)} backfill=1` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} status=${fetched.meta.status ?? response.status}`,
    })
    if (response.ok) {
      points = parseHtmlDecisions(await response.text())
    }
  } catch {
    // fall through to CSV
  }

  // Fall back to F1 CSV if HTML yielded nothing.
  if (points.length === 0) {
    sourceUrl = RBA_F1_DATA_URL
    try {
      const fetched = await fetchWithTimeout(RBA_F1_DATA_URL, undefined, { env })
      const response = fetched.response
      log.info('pipeline', 'upstream_fetch', {
        context:
          `source=rba_csv host=${hostFromUrl(RBA_F1_DATA_URL)} backfill=1` +
          ` elapsed_ms=${fetched.meta.elapsed_ms} status=${fetched.meta.status ?? response.status}`,
      })
      if (!response.ok) {
        return { ok: false, upserted: 0, skipped: 0, startDate, endDate, sourceUrl, message: `RBA fetch failed: ${response.status}` }
      }
      points = parseCsvLines(await response.text())
    } catch (error) {
      log.warn('pipeline', 'rba_backfill_failed', {
        context: `startDate=${startDate} endDate=${endDate} error=${(error as Error)?.message ?? String(error)}`,
      })
      return { ok: false, upserted: 0, skipped: 0, startDate, endDate, sourceUrl, message: (error as Error)?.message ?? String(error) }
    }
  }

  if (points.length === 0) {
    return { ok: false, upserted: 0, skipped: 0, startDate, endDate, sourceUrl, message: 'RBA source returned no parseable points' }
  }

  let upserted = 0
  let skipped = 0
  for (const collectionDate of dateRangeInclusive(startDate, endDate)) {
    const nearest = latestPointOnOrBefore(points, collectionDate)
    if (!nearest) {
      skipped += 1
      continue
    }
    await upsertRbaCashRate(db, {
      collectionDate,
      cashRate: nearest.cashRate,
      effectiveDate: nearest.date,
      sourceUrl,
    })
    upserted += 1
  }
  return { ok: true, upserted, skipped, startDate, endDate, sourceUrl }
}
