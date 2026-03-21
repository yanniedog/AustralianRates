import { upsertCpiData } from '../db/cpi-data'
import type { EnvBindings } from '../types'
import { FetchWithTimeoutError, fetchWithTimeout, hostFromUrl } from '../utils/fetch-with-timeout'
import { log } from '../utils/logger'

const RBA_G1_DATA_URL = 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv'

/** Maps RBA G1 quarter label to YYYY-MM-DD quarter-start date used in our DB.
 *  Mar quarter (Jan–Mar) → YYYY-01-01
 *  Jun quarter (Apr–Jun) → YYYY-04-01
 *  Sep quarter (Jul–Sep) → YYYY-07-01
 *  Dec quarter (Oct–Dec) → YYYY-10-01
 */
const QUARTER_MONTH: Record<string, string> = {
  mar: '01',
  jun: '04',
  sep: '07',
  dec: '10',
}

/** Parse a G1 date label like "Mar-2021" → "2021-01-01". Returns null if unrecognised. */
function parseG1QuarterDate(label: string): string | null {
  const m = label.trim().match(/^([A-Za-z]{3})-(\d{4})$/)
  if (!m) return null
  const month = QUARTER_MONTH[m[1].toLowerCase()]
  if (!month) return null
  return `${m[2]}-${month}-01`
}

export type CpiPoint = { quarterDate: string; annualChange: number }

/**
 * Parse the RBA G1 CSV and extract All Groups CPI (annual % change) quarterly series.
 *
 * G1 header structure (simplified):
 *   Row 0: Series IDs  — GCPIAG, GCPIAGSSTE, …
 *   Row 1: Title       — "All groups CPI", "All groups CPI (seasonally adjusted)", …
 *   Row 2+: other metadata rows (Description, Frequency, Type, Units, Source, Publication date)
 *   Then blank line, then data rows: Mar-1922,2.80,…
 *
 * We look for the Title row to find the "All groups CPI" column (falling back to column index 1).
 */
export function parseCpiCsv(csv: string): CpiPoint[] {
  const lines = csv.split(/\r?\n/)
  let allGroupsColIndex = 1 // default: first data column

  // Scan header rows for "All groups CPI" title
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const parts = lines[i].split(',')
    if (parts[0].trim().toLowerCase() === 'title') {
      for (let j = 1; j < parts.length; j++) {
        const title = parts[j].trim().toLowerCase()
        // Match "All groups CPI" but not "All groups CPI (seasonally adjusted)" etc.
        if (title === 'all groups cpi' || title === 'all groups') {
          allGroupsColIndex = j
          break
        }
      }
      break
    }
  }

  const points: CpiPoint[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(',')
    if (parts.length < 2) continue
    const quarterDate = parseG1QuarterDate(parts[0])
    if (!quarterDate) continue
    const rawValue = parts[allGroupsColIndex] ? parts[allGroupsColIndex].trim() : ''
    const annualChange = Number(rawValue)
    if (!Number.isFinite(annualChange)) continue
    points.push({ quarterDate, annualChange })
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
 * Fetches the RBA G1 CSV and upserts the All Groups CPI quarterly series into cpi_data.
 * Safe to call daily — ON CONFLICT DO UPDATE keeps the latest values.
 */
export async function collectCpiFromRbaG1(
  db: D1Database,
  env?: Pick<EnvBindings, 'FETCH_TIMEOUT_MS' | 'FETCH_MAX_RETRIES' | 'FETCH_RETRY_BASE_MS' | 'FETCH_RETRY_CAP_MS'>,
): Promise<CollectCpiResult> {
  try {
    const fetched = await fetchWithTimeout(RBA_G1_DATA_URL, undefined, { env })
    const response = fetched.response
    log.info('pipeline', 'upstream_fetch', {
      context:
        `source=rba_g1 host=${hostFromUrl(RBA_G1_DATA_URL)}` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} status=${fetched.meta.status ?? response.status}`,
    })
    const csv = await response.text()
    if (!response.ok) {
      return { ok: false, upserted: 0, sourceUrl: RBA_G1_DATA_URL, message: `G1 fetch failed: ${response.status}` }
    }
    const points = parseCpiCsv(csv)
    if (points.length === 0) {
      return { ok: false, upserted: 0, sourceUrl: RBA_G1_DATA_URL, message: 'G1 CSV returned no parseable CPI points' }
    }
    for (const p of points) {
      await upsertCpiData(db, { quarterDate: p.quarterDate, annualChange: p.annualChange })
    }
    return { ok: true, upserted: points.length, sourceUrl: RBA_G1_DATA_URL }
  } catch (error) {
    const meta = error instanceof FetchWithTimeoutError ? error.meta : null
    log.warn('pipeline', 'upstream_fetch', {
      context:
        `source=rba_g1 host=${hostFromUrl(RBA_G1_DATA_URL)}` +
        ` elapsed_ms=${meta?.elapsed_ms ?? 0} status=${meta?.status ?? 0}`,
    })
    return {
      ok: false,
      upserted: 0,
      sourceUrl: RBA_G1_DATA_URL,
      message: (error as Error)?.message ?? String(error),
    }
  }
}
