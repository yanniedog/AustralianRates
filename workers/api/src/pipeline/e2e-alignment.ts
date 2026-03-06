import { API_BASE_PATH, SAVINGS_API_BASE_PATH, TD_API_BASE_PATH } from '../constants'
import type { EnvBindings } from '../types'
import { FetchWithTimeoutError, fetchWithTimeout, hostFromUrl } from '../utils/fetch-with-timeout'
import { log } from '../utils/logger'
import { getMelbourneNowParts } from '../utils/time'
import { captureProbePayload } from './probe-capture'
import { extractCollectionDates, normalizeIsoDateLike, parseJsonText, parseRowsPayload } from './probe-payloads'
import { detectUpstreamBlock } from '../utils/upstream-block'

export type E2EReasonCode =
  | 'e2e_ok'
  | 'scheduler_stale'
  | 'run_stuck'
  | 'api_no_recent_data'
  | 'api_unreachable'
  | 'api_invalid_payload'
  | 'e2e_check_error'

type ApiFailureCode = 'api_no_recent_data' | 'api_unreachable' | 'api_invalid_payload'

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

type PathProbeResult = {
  code: 'ok' | ApiFailureCode
  status: number
  detail?: string
  fetchEventId: number | null
}

type DatasetApiProbeResult = {
  dataset: 'home_loans' | 'savings' | 'term_deposits'
  ok: boolean
  failureCode: ApiFailureCode | null
  detail?: string
  fetchEventIds: number[]
}

const SCHEDULER_MAX_AGE_HOURS = 25
const RUN_STUCK_MAX_AGE_HOURS = 2

function formatFetchEventIds(ids: number[]): string {
  if (ids.length === 0) return 'none'
  return ids.join('|')
}

function strongestApiFailureCode(codes: ApiFailureCode[]): ApiFailureCode {
  if (codes.includes('api_invalid_payload')) return 'api_invalid_payload'
  if (codes.includes('api_no_recent_data')) return 'api_no_recent_data'
  return 'api_unreachable'
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

async function fetchLatestAllProbe(
  env: EnvBindings,
  input: {
    url: string
    targetCollectionDate: string
    sourceType: 'probe_e2e_alignment_latest_all' | 'probe_e2e_alignment_latest_all_retry'
    init?: RequestInit
  },
): Promise<PathProbeResult> {
  const startedAt = Date.now()
  try {
    const fetched = await fetchWithTimeout(input.url, input.init, { env })
    const res = fetched.response
    const bodyText = await res.text()

    log.info('pipeline', 'upstream_fetch', {
      context:
        `source=${input.sourceType} host=${hostFromUrl(input.url)}` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} upstream_ms=${fetched.meta.elapsed_ms}` +
        ` attempts=${fetched.meta.attempts} retry_count=${Math.max(0, fetched.meta.attempts - 1)}` +
        ` timed_out=${fetched.meta.timed_out ? 1 : 0} timeout=${fetched.meta.timed_out ? 1 : 0}` +
        ` status=${fetched.meta.status ?? res.status}`,
    })

    if (!res.ok) {
      const captured = await captureProbePayload(env, {
        sourceType: input.sourceType,
        sourceUrl: input.url,
        reason: 'api_unreachable',
        payload: bodyText,
        status: res.status,
        headers: res.headers,
        durationMs: fetched.meta.elapsed_ms,
        note: 'e2e_latest_all non_2xx',
      })
      return {
        code: 'api_unreachable',
        status: res.status,
        detail: `HTTP ${res.status}`,
        fetchEventId: captured.fetchEventId,
      }
    }

    const parsed = parseJsonText(bodyText)
    if (!parsed.ok) {
      const block = detectUpstreamBlock({
        status: res.status,
        body: bodyText,
        headers: res.headers,
      })
      const captured = await captureProbePayload(env, {
        sourceType: input.sourceType,
        sourceUrl: input.url,
        reason: 'api_invalid_payload',
        payload: bodyText,
        status: res.status,
        headers: res.headers,
        durationMs: fetched.meta.elapsed_ms,
        note: `e2e_latest_all ${parsed.reason}`,
      })
      return {
        code: 'api_invalid_payload',
        status: res.status,
        detail: `invalid_payload:${parsed.reason}${block.reasonCode ? `:${block.reasonCode}` : ''}`,
        fetchEventId: captured.fetchEventId,
      }
    }

    const rowsResult = parseRowsPayload(parsed.value)
    if (!rowsResult.ok) {
      const block = detectUpstreamBlock({
        status: res.status,
        body: bodyText,
        headers: res.headers,
      })
      const captured = await captureProbePayload(env, {
        sourceType: input.sourceType,
        sourceUrl: input.url,
        reason: 'api_invalid_payload',
        payload: bodyText,
        status: res.status,
        headers: res.headers,
        durationMs: fetched.meta.elapsed_ms,
        note: `e2e_latest_all ${rowsResult.reason}`,
      })
      return {
        code: 'api_invalid_payload',
        status: res.status,
        detail: `invalid_payload:${rowsResult.reason}${block.reasonCode ? `:${block.reasonCode}` : ''}`,
        fetchEventId: captured.fetchEventId,
      }
    }

    const targetDate = normalizeIsoDateLike(input.targetCollectionDate)
    const dates = extractCollectionDates(rowsResult.rows)
    if (dates.includes(targetDate)) {
      const captured = await captureProbePayload(env, {
        sourceType: input.sourceType,
        sourceUrl: input.url,
        reason: 'success',
        payload: bodyText,
        status: res.status,
        headers: res.headers,
        durationMs: fetched.meta.elapsed_ms,
        note: 'e2e_latest_all target_found',
      })
      return { code: 'ok', status: res.status, fetchEventId: captured.fetchEventId }
    }

    const captured = await captureProbePayload(env, {
      sourceType: input.sourceType,
      sourceUrl: input.url,
      reason: 'api_no_recent_data',
      payload: bodyText,
      status: res.status,
      headers: res.headers,
      durationMs: fetched.meta.elapsed_ms,
      note: `e2e_latest_all target_missing=${targetDate}`,
    })
    return {
      code: 'api_no_recent_data',
      status: res.status,
      detail: `target_missing:${targetDate}`,
      fetchEventId: captured.fetchEventId,
    }
  } catch (error) {
    const meta = error instanceof FetchWithTimeoutError ? error.meta : null
    const errorMessage = (error as Error)?.message || String(error)
    log.warn('pipeline', 'upstream_fetch', {
      error,
      context:
        `source=${input.sourceType} host=${hostFromUrl(input.url)}` +
        ` elapsed_ms=${meta?.elapsed_ms ?? 0} upstream_ms=${meta?.elapsed_ms ?? 0}` +
        ` attempts=${meta?.attempts ?? 1} retry_count=${Math.max(0, (meta?.attempts ?? 1) - 1)}` +
        ` timed_out=${meta?.timed_out ? 1 : 0} timeout=${meta?.timed_out ? 1 : 0}` +
        ` status=${meta?.status ?? 0}`,
    })

    const captured = await captureProbePayload(env, {
      sourceType: input.sourceType,
      sourceUrl: input.url,
      reason: 'api_unreachable',
      payload: {
        error: errorMessage,
        source: input.sourceType,
        url: input.url,
      },
      status: meta?.status ?? null,
      durationMs: meta?.elapsed_ms ?? Date.now() - startedAt,
      note: 'e2e_latest_all fetch_error',
    })
    return {
      code: 'api_unreachable',
      status: meta?.status ?? 0,
      detail: errorMessage,
      fetchEventId: captured.fetchEventId,
    }
  }
}

async function apiHasTargetDate(
  env: EnvBindings,
  origin: string,
  dataset: 'home_loans' | 'savings' | 'term_deposits',
  path: string,
  targetCollectionDate: string,
): Promise<DatasetApiProbeResult> {
  const baseUrl = `${normalizeOrigin(origin)}${path}/latest-all?limit=25&source_mode=scheduled`
  const first = await fetchLatestAllProbe(env, {
    url: baseUrl,
    targetCollectionDate,
    sourceType: 'probe_e2e_alignment_latest_all',
  })
  if (first.code === 'ok') {
    return {
      dataset,
      ok: true,
      failureCode: null,
      fetchEventIds: first.fetchEventId == null ? [] : [first.fetchEventId],
    }
  }

  const retry = await fetchLatestAllProbe(env, {
    url: `${baseUrl}&cache_bust=${Date.now()}`,
    targetCollectionDate,
    sourceType: 'probe_e2e_alignment_latest_all_retry',
    init: {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    },
  })
  if (retry.code === 'ok') {
    const ids = [first.fetchEventId, retry.fetchEventId].filter((id): id is number => id != null)
    return {
      dataset,
      ok: true,
      failureCode: null,
      fetchEventIds: Array.from(new Set(ids)),
    }
  }

  const ids = [first.fetchEventId, retry.fetchEventId].filter((id): id is number => id != null)
  const failureCode = strongestApiFailureCode([first.code, retry.code])
  return {
    dataset,
    ok: false,
    failureCode,
    fetchEventIds: Array.from(new Set(ids)),
    detail:
      `attempts(first=${first.code}:${first.status},retry=${retry.code}:${retry.status})` +
      ` fetch_event_ids=${formatFetchEventIds(Array.from(new Set(ids)))}` +
      ` detail(first=${first.detail || 'none'},retry=${retry.detail || 'none'})`,
  }
}

async function evaluateApiCriterion(
  env: EnvBindings,
  origin: string | undefined,
  targetCollectionDate: string | null,
): Promise<{
  ok: boolean
  failureCode: ApiFailureCode | null
  detail?: string
}> {
  if (!targetCollectionDate) {
    return { ok: false, failureCode: 'api_unreachable', detail: 'No target collection date available in database.' }
  }
  if (!origin) {
    return { ok: false, failureCode: 'api_unreachable', detail: 'No origin configured for E2E API validation.' }
  }

  try {
    const [home, savings, td] = await Promise.all([
      apiHasTargetDate(env, origin, 'home_loans', API_BASE_PATH, targetCollectionDate),
      apiHasTargetDate(env, origin, 'savings', SAVINGS_API_BASE_PATH, targetCollectionDate),
      apiHasTargetDate(env, origin, 'term_deposits', TD_API_BASE_PATH, targetCollectionDate),
    ])
    const results = [home, savings, td]
    if (results.every((result) => result.ok)) {
      return {
        ok: true,
        failureCode: null,
      }
    }

    const failed = results.filter((result) => !result.ok)
    const failureCode = strongestApiFailureCode(
      failed.map((item) => item.failureCode).filter((code): code is ApiFailureCode => Boolean(code)),
    )
    const detail = failed
      .map((item) => `${item.dataset}=${item.failureCode}:${item.detail || 'no_detail'}`)
      .join('; ')
    return {
      ok: false,
      failureCode,
      detail: `target=${targetCollectionDate} ${detail}`,
    }
  } catch (error) {
    return {
      ok: false,
      failureCode: 'api_unreachable',
      detail: (error as Error)?.message || String(error),
    }
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
      evaluateApiCriterion(env, options?.origin, targetCollectionDate),
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
      reasonCode = apiEval.failureCode ?? (options?.origin ? 'api_no_recent_data' : 'api_unreachable')
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
