import { upsertCpiData } from '../db/cpi-data'
import { parseDelimitedText, parseFlexibleDate } from '../economic/parser-utils'
import type { EnvBindings } from '../types'
import {
  FetchWithTimeoutError,
  RBA_GOV_AU_FETCH_INIT,
  fetchWithTimeout,
  hostFromUrl,
} from '../utils/fetch-with-timeout'
import { log } from '../utils/logger'

const RBA_G1_DATA_URL = 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv'
const RBA_MEASURES_CPI_URL = 'https://www.rba.gov.au/inflation/measures-cpi.html'
const G1_ALL_GROUPS_YEAR_ENDED_SERIES_ID = 'GCPIAGYP'

/** Maps a quarter label to the quarter-start month used in our DB. */
const QUARTER_MONTH: Record<string, string> = {
  mar: '01',
  jun: '04',
  sep: '07',
  dec: '10',
}

/** Parse a G1 date label like "Mar-2021" or "30/06/2025" to a quarter-start date. */
function parseG1QuarterDate(label: string): string | null {
  const raw = label.trim()
  const quarterLabel = raw.match(/^([A-Za-z]{3})-(\d{4})$/)
  if (quarterLabel) {
    const month = QUARTER_MONTH[quarterLabel[1].toLowerCase()]
    if (!month) return null
    return `${quarterLabel[2]}-${month}-01`
  }

  const parsed = parseFlexibleDate(raw)
  if (!parsed) return null
  const [yearText, monthText] = parsed.split('-')
  const year = Number(yearText)
  const monthNumber = Number(monthText)
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return null
  if (monthNumber <= 3) return `${year}-01-01`
  if (monthNumber <= 6) return `${year}-04-01`
  if (monthNumber <= 9) return `${year}-07-01`
  return `${year}-10-01`
}

export type CpiPoint = { quarterDate: string; annualChange: number }

function normalizeHeaderCell(value: string): string {
  return value.trim().toLowerCase()
}

function findYearEndedInflationColumn(rows: string[][]): number {
  for (const row of rows.slice(0, 20)) {
    if (normalizeHeaderCell(String(row[0] || '')) !== 'series id') continue
    const seriesIndex = row.findIndex(
      (value, index) => index > 0 && String(value).trim() === G1_ALL_GROUPS_YEAR_ENDED_SERIES_ID,
    )
    if (seriesIndex > 0) return seriesIndex
  }

  for (const row of rows.slice(0, 20)) {
    if (normalizeHeaderCell(String(row[0] || '')) !== 'title') continue
    const titleIndex = row.findIndex((value, index) => {
      if (index === 0) return false
      const title = normalizeHeaderCell(String(value))
      return title === 'year-ended inflation' || title === 'all groups cpi' || title === 'all groups'
    })
    if (titleIndex > 0) return titleIndex
  }

  return 1
}

/**
 * Parse the RBA G1 CSV and extract the All Groups CPI year-ended inflation series.
 * Prefer the GCPIAGYP series id so the parser keeps working if column titles drift.
 */
export function parseCpiCsv(csv: string): CpiPoint[] {
  const rows = parseDelimitedText(csv)
  const yearEndedColIndex = findYearEndedInflationColumn(rows)
  const points: CpiPoint[] = []

  for (const row of rows) {
    if (row.length < 2) continue
    const quarterDate = parseG1QuarterDate(String(row[0] || ''))
    if (!quarterDate) continue
    const annualChange = Number(String(row[yearEndedColIndex] || '').trim())
    if (!Number.isFinite(annualChange)) continue
    points.push({ quarterDate, annualChange })
  }

  return points
}

/**
 * Parses the RBA "Measures of Consumer Price Inflation" HTML page and extracts the
 * "All groups CPI, year-ended percentage change" quarterly series.
 *
 * The page table uses fiscal-year group headers like "2025/2026" with abbreviated quarter
 * month labels (Sep, Dec, Mar, Jun). Sep/Dec belong to the first year; Mar/Jun to the second.
 */
export function parseMeasuresCpiHtml(html: string): CpiPoint[] {
  const points: CpiPoint[] = []
  const captionIdx = html.indexOf('CPI, Year-ended percentage change')
  if (captionIdx === -1) return points
  const tbodyStart = html.indexOf('<tbody>', captionIdx)
  if (tbodyStart === -1) return points
  const tbodyEnd = html.indexOf('</tbody>', tbodyStart)
  if (tbodyEnd === -1) return points
  const tbody = html.slice(tbodyStart + 7, tbodyEnd)

  let fiscalYear = ''
  const rowRegex = /<tr[\s\S]*?<\/tr>/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRegex.exec(tbody)) !== null) {
    const row = rowMatch[0]
    const fiscalMatch = row.match(/(\d{4})\/(\d{4})/)
    if (fiscalMatch) {
      fiscalYear = fiscalMatch[0]
      continue
    }
    if (!fiscalYear) continue
    const dateMatch = row.match(/<th>([\s\S]*?)<\/th>/)
    if (!dateMatch) continue
    const quarterAbbr = dateMatch[1].replace(/<[^>]+>/g, '').trim().toLowerCase()
    const startMonth = QUARTER_MONTH[quarterAbbr]
    if (!startMonth) continue
    const tdMatch = row.match(/<td[^>]*>([\s\S]*?)<\/td>/)
    if (!tdMatch) continue
    const annualChange = Number(tdMatch[1].replace(/<[^>]+>/g, '').trim())
    if (!Number.isFinite(annualChange)) continue
    const [firstYear, secondYear] = fiscalYear.split('/')
    const calYear = quarterAbbr === 'mar' || quarterAbbr === 'jun' ? secondYear : firstYear
    points.push({ quarterDate: `${calYear}-${startMonth}-01`, annualChange })
  }
  return points
}

export type CollectCpiResult = {
  ok: boolean
  upserted: number
  sourceUrl: string
  message?: string
}

/**
 * Fetches CPI quarterly data and upserts the All Groups CPI year-ended series into cpi_data.
 * Tries the RBA Measures of CPI HTML page first (updates within hours of each ABS release),
 * falling back to the RBA G1 CSV if the HTML fetch fails or yields no points.
 * Safe to call daily - ON CONFLICT DO UPDATE keeps the latest values.
 */
export async function collectCpiFromRbaG1(
  db: D1Database,
  env?: Pick<EnvBindings, 'FETCH_TIMEOUT_MS' | 'FETCH_MAX_RETRIES' | 'FETCH_RETRY_BASE_MS' | 'FETCH_RETRY_CAP_MS'>,
): Promise<CollectCpiResult> {
  let htmlFailure: string | null = null

  // Attempt 1: HTML measures page - authoritative, updates immediately after ABS releases.
  try {
    const fetched = await fetchWithTimeout(RBA_MEASURES_CPI_URL, RBA_GOV_AU_FETCH_INIT, { env })
    const response = fetched.response
    log.info('pipeline', 'upstream_fetch', {
      context:
        `source=rba_cpi_html host=${hostFromUrl(RBA_MEASURES_CPI_URL)}` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} status=${fetched.meta.status ?? response.status}`,
    })
    if (response.ok) {
      const points = parseMeasuresCpiHtml(await response.text())
      if (points.length > 0) {
        for (const p of points) {
          await upsertCpiData(db, {
            quarterDate: p.quarterDate,
            annualChange: p.annualChange,
            sourceUrl: RBA_MEASURES_CPI_URL,
          })
        }
        return { ok: true, upserted: points.length, sourceUrl: RBA_MEASURES_CPI_URL }
      }
    }
    htmlFailure = `html status=${fetched.meta.status ?? 0} reason=no_points_or_non_ok`
  } catch (error) {
    const meta = error instanceof FetchWithTimeoutError ? error.meta : null
    htmlFailure = `html reason=fetch_error elapsed_ms=${meta?.elapsed_ms ?? 0} status=${meta?.status ?? 0}`
  }

  // Attempt 2: G1 CSV fallback.
  let csvFailure: string | null = null
  try {
    const fetched = await fetchWithTimeout(RBA_G1_DATA_URL, RBA_GOV_AU_FETCH_INIT, { env })
    const response = fetched.response
    log.info('pipeline', 'upstream_fetch', {
      context:
        `source=rba_g1 host=${hostFromUrl(RBA_G1_DATA_URL)}` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} status=${fetched.meta.status ?? response.status}`,
    })
    const csv = await response.text()
    if (!response.ok) {
      csvFailure = `g1 status=${response.status} reason=non_ok`
    } else {
      const points = parseCpiCsv(csv)
      if (points.length > 0) {
        for (const p of points) {
          await upsertCpiData(db, {
            quarterDate: p.quarterDate,
            annualChange: p.annualChange,
            sourceUrl: RBA_G1_DATA_URL,
          })
        }
        return { ok: true, upserted: points.length, sourceUrl: RBA_G1_DATA_URL }
      }
      csvFailure = 'g1 reason=no_parseable_points'
    }
  } catch (error) {
    const meta = error instanceof FetchWithTimeoutError ? error.meta : null
    log.warn('pipeline', 'upstream_fetch', {
      context:
        `source=rba_g1 host=${hostFromUrl(RBA_G1_DATA_URL)}` +
        ` elapsed_ms=${meta?.elapsed_ms ?? 0} status=${meta?.status ?? 0}`,
    })
    csvFailure = `g1 reason=fetch_error elapsed_ms=${meta?.elapsed_ms ?? 0} status=${meta?.status ?? 0}`
  }

  const summary = `${htmlFailure || 'html=unknown'} ${csvFailure || 'g1=unknown'}`
  const htmlSaw403 = String(htmlFailure ?? '').includes('403')
  const csvSaw403 = String(csvFailure ?? '').includes('403')
  if (htmlSaw403 && csvSaw403) {
    log.info('pipeline', 'cpi_collection_rba_blocked', {
      code: 'cpi_rba_fetch_blocked',
      context: summary,
    })
  } else {
    log.warn('pipeline', 'cpi_collection_unavailable', {
      code: 'cpi_collection_unavailable',
      context: summary,
    })
  }
  return {
    ok: false,
    upserted: 0,
    sourceUrl: RBA_G1_DATA_URL,
    message: `${htmlFailure || 'html=unknown'}; ${csvFailure || 'g1=unknown'}`,
  }
}
