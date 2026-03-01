import { API_BASE_PATH, SAVINGS_API_BASE_PATH, TD_API_BASE_PATH } from '../constants'
import type { EnvBindings } from '../types'
import { getMelbourneNowParts } from '../utils/time'

export type E2EReasonCode =
  | 'e2e_ok'
  | 'scheduler_stale'
  | 'run_stuck'
  | 'api_no_recent_data'
  | 'api_unreachable'
  | 'e2e_check_error'

export type E2EResult = {
  aligned: boolean
  reasonCode: E2EReasonCode
  reasonDetail?: string
  checkedAt: string
  targetCollectionDate: string | null
  criteria: {
    scheduler: boolean
    runsProgress: boolean
    apiServesLatest: boolean
  }
}

type DateRow = { latest: string | null }
type RunningRow = { n: number }
type RowShape = { rows: Array<Record<string, unknown>>; total: number }

const SCHEDULER_MAX_AGE_HOURS = 25
const RUN_STUCK_MAX_AGE_HOURS = 2

function parseRowsAndTotal(payload: unknown): RowShape {
  if (!payload || typeof payload !== 'object') return { rows: [], total: 0 }
  const raw = payload as Record<string, unknown>
  const rows = Array.isArray(raw.rows)
    ? (raw.rows as Array<Record<string, unknown>>)
    : Array.isArray(raw.data)
      ? (raw.data as Array<Record<string, unknown>>)
      : []
  const totalRaw = raw.total ?? raw.count ?? rows.length
  const total = Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : rows.length
  return { rows, total }
}

async function getTargetCollectionDate(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MAX(collection_date) AS latest
       FROM (
         SELECT collection_date FROM historical_loan_rates
         UNION ALL
         SELECT collection_date FROM historical_savings_rates
         UNION ALL
         SELECT collection_date FROM historical_term_deposit_rates
       )`,
    )
    .first<DateRow>()
  return row?.latest ?? null
}

async function hasRecentDailyRun(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT started_at AS latest
       FROM run_reports
       WHERE run_type = 'daily'
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .first<DateRow>()
  const latest = row?.latest
  if (!latest) return false
  const latestMs = Date.parse(latest)
  if (!Number.isFinite(latestMs)) return false
  const maxAgeMs = SCHEDULER_MAX_AGE_HOURS * 60 * 60 * 1000
  return Date.now() - latestMs <= maxAgeMs
}

async function hasStuckRun(db: D1Database): Promise<boolean> {
  const cutoffIso = new Date(Date.now() - RUN_STUCK_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString()
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM run_reports
       WHERE status = 'running'
         AND started_at < ?1`,
    )
    .bind(cutoffIso)
    .first<RunningRow>()
  return Number(row?.n ?? 0) > 0
}

function normalizeOrigin(input: string): string {
  return String(input || '').replace(/\/+$/, '')
}

async function apiHasTargetDate(origin: string, path: string, targetCollectionDate: string): Promise<boolean> {
  const url = `${normalizeOrigin(origin)}${path}/latest-all?limit=5&source_mode=scheduled`
  const res = await fetch(url)
  if (!res.ok) return false
  const data = (await res.json().catch(() => null)) as unknown
  const shape = parseRowsAndTotal(data)
  if (shape.total <= 0 || shape.rows.length === 0) return false
  return shape.rows.some((row) => String(row.collection_date || '') === targetCollectionDate)
}

async function evaluateApiCriterion(origin: string | undefined, targetCollectionDate: string | null): Promise<{
  ok: boolean
  detail?: string
}> {
  if (!targetCollectionDate) {
    return { ok: false, detail: 'No target collection date available in database.' }
  }
  if (!origin) {
    return { ok: false, detail: 'No origin configured for E2E API validation.' }
  }

  try {
    const [home, savings, td] = await Promise.all([
      apiHasTargetDate(origin, API_BASE_PATH, targetCollectionDate),
      apiHasTargetDate(origin, SAVINGS_API_BASE_PATH, targetCollectionDate),
      apiHasTargetDate(origin, TD_API_BASE_PATH, targetCollectionDate),
    ])
    const ok = home && savings && td
    return {
      ok,
      detail: ok
        ? undefined
        : `Target date ${targetCollectionDate} missing in one or more dataset latest-all responses.`,
    }
  } catch (error) {
    return { ok: false, detail: (error as Error)?.message || String(error) }
  }
}

export async function runE2ECheck(
  env: EnvBindings,
  options?: { origin?: string },
): Promise<E2EResult> {
  const checkedAt = new Date().toISOString()
  const melbourneDate = getMelbourneNowParts(new Date(), env.MELBOURNE_TIMEZONE || 'Australia/Melbourne').date

  try {
    const targetCollectionDate = (await getTargetCollectionDate(env.DB)) || melbourneDate
    const [scheduler, hasStuck, apiEval] = await Promise.all([
      hasRecentDailyRun(env.DB),
      hasStuckRun(env.DB),
      evaluateApiCriterion(options?.origin, targetCollectionDate),
    ])
    const runsProgress = !hasStuck
    const apiServesLatest = apiEval.ok
    const aligned = scheduler && runsProgress && apiServesLatest

    let reasonCode: E2EReasonCode = 'e2e_ok'
    let reasonDetail: string | undefined
    if (!scheduler) {
      reasonCode = 'scheduler_stale'
      reasonDetail = `No daily run detected within ${SCHEDULER_MAX_AGE_HOURS} hours.`
    } else if (!runsProgress) {
      reasonCode = 'run_stuck'
      reasonDetail = `At least one running run is older than ${RUN_STUCK_MAX_AGE_HOURS} hours.`
    } else if (!apiServesLatest) {
      reasonCode = options?.origin ? 'api_no_recent_data' : 'api_unreachable'
      reasonDetail = apiEval.detail
    }

    return {
      aligned,
      reasonCode,
      reasonDetail,
      checkedAt,
      targetCollectionDate,
      criteria: {
        scheduler,
        runsProgress,
        apiServesLatest,
      },
    }
  } catch (error) {
    return {
      aligned: false,
      reasonCode: 'e2e_check_error',
      reasonDetail: (error as Error)?.message || String(error),
      checkedAt,
      targetCollectionDate: melbourneDate,
      criteria: {
        scheduler: false,
        runsProgress: false,
        apiServesLatest: false,
      },
    }
  }
}
