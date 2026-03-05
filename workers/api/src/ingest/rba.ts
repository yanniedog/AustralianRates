import { upsertRbaCashRate } from '../db/rba-cash-rate'
import type { EnvBindings } from '../types'
import { FetchWithTimeoutError, fetchWithTimeout, hostFromUrl } from '../utils/fetch-with-timeout'
import { log } from '../utils/logger'

const RBA_F1_DATA_URL = 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv'

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
  try {
    const fetched = await fetchWithTimeout(RBA_F1_DATA_URL, undefined, { env })
    const response = fetched.response
    log.info('pipeline', 'upstream_fetch', {
      context:
        `source=rba host=${hostFromUrl(RBA_F1_DATA_URL)}` +
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

    return {
      ok: true,
      cashRate: nearest.cashRate,
      effectiveDate: nearest.date,
      sourceUrl: RBA_F1_DATA_URL,
    }
  } catch (error) {
    const meta = error instanceof FetchWithTimeoutError ? error.meta : null
    log.warn('pipeline', 'upstream_fetch', {
      context:
        `source=rba host=${hostFromUrl(RBA_F1_DATA_URL)}` +
        ` elapsed_ms=${meta?.elapsed_ms ?? 0} upstream_ms=${meta?.elapsed_ms ?? 0}` +
        ` attempts=${meta?.attempts ?? 1} retry_count=${Math.max(0, (meta?.attempts ?? 1) - 1)}` +
        ` timed_out=${meta?.timed_out ? 1 : 0} timeout=${meta?.timed_out ? 1 : 0}` +
        ` status=${meta?.status ?? 0}`,
    })
    return { ok: false, cashRate: null, effectiveDate: null, sourceUrl: RBA_F1_DATA_URL }
  }
}
