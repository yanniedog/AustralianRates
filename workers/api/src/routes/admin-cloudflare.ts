import { Hono } from 'hono'
import type { AppContext, EnvBindings } from '../types'
import {
  D1_INCLUDED_MONTHLY_READS,
  D1_INCLUDED_MONTHLY_WRITES,
  D1_INCLUDED_STORAGE_BYTES,
  D1_OVERAGE_ALLOWANCE_USD,
  D1_READ_OVERAGE_PER_MILLION_USD,
  D1_STORAGE_OVERAGE_PER_GB_MONTH_USD,
  D1_WRITE_OVERAGE_PER_MILLION_USD,
  computeD1OverageCostUsd,
  readLocalD1BudgetState,
} from '../utils/d1-budget'
import {
  aggregateD1UsageByBillingPeriod,
  normalizeBillingCycleStartDay,
  resolveBillingPeriod,
} from '../utils/d1-billing-period'
import { aggregateD1UsageByMonth, buildD1UsageSeries } from '../utils/d1-usage-analytics'
import { jsonError } from '../utils/http'

const DEFAULT_D1_DATABASE_ID = 'de6d4315-686b-4022-b080-956ca3819976'
const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'
const GRAPHQL_MAX_HISTORY_DAYS = 31
const GRAPHQL_MAX_DAYS_PER_QUERY = 28

type D1UsageDay = {
  date: string
  reads: number
  writes: number
  read_queries: number
  write_queries: number
  response_bytes: number
  query_time_ms: number
  storage_bytes: number
  estimated_cost_usd: number
  period_reads_to_date?: number
  period_writes_to_date?: number
  reads_pct_included_to_date?: number
  writes_pct_included_to_date?: number
  storage_pct_included?: number
  read_rows_over_included_to_date?: number
  write_rows_over_included_to_date?: number
  storage_bytes_over_included?: number
  billable_read_rows?: number
  billable_write_rows?: number
  billable_storage_bytes?: number
  read_rows_included_period?: number
  write_rows_included_period?: number
  storage_bytes_included?: number
}

type CloudflareD1UsageResult = {
  days: D1UsageDay[] | null
  error: string | null
  storage_error?: string | null
}

function clampDays(value: string | undefined): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return 370
  return Math.max(1, Math.min(731, parsed))
}

function dateDaysAgo(days: number): Date {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - Math.max(0, days - 1))
  return date
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function sortDaysByDate(days: D1UsageDay[]): D1UsageDay[] {
  return [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function emptyUsageDay(date: string): D1UsageDay {
  return {
    date,
    reads: 0,
    writes: 0,
    read_queries: 0,
    write_queries: 0,
    response_bytes: 0,
    query_time_ms: 0,
    storage_bytes: 0,
    estimated_cost_usd: 0,
  }
}

function mergeUsageDays(days: D1UsageDay[]): Map<string, D1UsageDay> {
  const map = new Map<string, D1UsageDay>()
  for (const day of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue
    const prev = map.get(day.date) ?? emptyUsageDay(day.date)
    map.set(day.date, {
      ...prev,
      reads: prev.reads + Math.max(0, day.reads),
      writes: prev.writes + Math.max(0, day.writes),
      read_queries: prev.read_queries + Math.max(0, day.read_queries),
      write_queries: prev.write_queries + Math.max(0, day.write_queries),
      response_bytes: prev.response_bytes + Math.max(0, day.response_bytes),
      query_time_ms: prev.query_time_ms + Math.max(0, day.query_time_ms),
      storage_bytes: Math.max(prev.storage_bytes, Math.max(0, day.storage_bytes)),
      estimated_cost_usd: prev.estimated_cost_usd + Math.max(0, day.estimated_cost_usd),
    })
  }
  return map
}

function fillUsageDateRange(days: D1UsageDay[], start: Date, end: Date): D1UsageDay[] {
  const map = mergeUsageDays(days)
  const rows: D1UsageDay[] = []
  for (let cursor = new Date(start); cursor <= end; cursor = addUtcDays(cursor, 1)) {
    const date = ymd(cursor)
    rows.push(map.get(date) ?? emptyUsageDay(date))
  }
  return rows
}

function addQuotaFields(days: D1UsageDay[], cycleStartDay: number): D1UsageDay[] {
  const periodTotals = new Map<string, { reads: number; writes: number }>()
  return days.map((day) => {
    const period = resolveBillingPeriod(new Date(`${day.date}T12:00:00.000Z`), cycleStartDay)
    const totals = periodTotals.get(period.start_date) ?? { reads: 0, writes: 0 }
    totals.reads += Math.max(0, day.reads)
    totals.writes += Math.max(0, day.writes)
    periodTotals.set(period.start_date, totals)
    return {
      ...day,
      period_reads_to_date: totals.reads,
      period_writes_to_date: totals.writes,
      reads_pct_included_to_date: totals.reads / D1_INCLUDED_MONTHLY_READS,
      writes_pct_included_to_date: totals.writes / D1_INCLUDED_MONTHLY_WRITES,
      storage_pct_included: day.storage_bytes / D1_INCLUDED_STORAGE_BYTES,
      read_rows_over_included_to_date: Math.max(0, totals.reads - D1_INCLUDED_MONTHLY_READS),
      write_rows_over_included_to_date: Math.max(0, totals.writes - D1_INCLUDED_MONTHLY_WRITES),
      storage_bytes_over_included: Math.max(0, day.storage_bytes - D1_INCLUDED_STORAGE_BYTES),
      billable_read_rows: Math.max(0, day.reads),
      billable_write_rows: Math.max(0, day.writes),
      billable_storage_bytes: Math.max(0, day.storage_bytes - D1_INCLUDED_STORAGE_BYTES),
      read_rows_included_period: D1_INCLUDED_MONTHLY_READS,
      write_rows_included_period: D1_INCLUDED_MONTHLY_WRITES,
      storage_bytes_included: D1_INCLUDED_STORAGE_BYTES,
    }
  })
}

function summarizeBillingPeriod(days: D1UsageDay[], now: Date, cycleStartDay: number) {
  const period = resolveBillingPeriod(now, cycleStartDay)
  const periodDays = days.filter((day) => day.date >= period.start_date && day.date <= period.end_date)
  const reads = periodDays.reduce((sum, day) => sum + day.reads, 0)
  const writes = periodDays.reduce((sum, day) => sum + day.writes, 0)
  const projectedReads = Math.round((reads / period.elapsed_days) * period.days_in_period)
  const projectedWrites = Math.round((writes / period.elapsed_days) * period.days_in_period)
  const readQuotaFraction = projectedReads / D1_INCLUDED_MONTHLY_READS
  const writeQuotaFraction = projectedWrites / D1_INCLUDED_MONTHLY_WRITES
  const maxFraction = Math.max(readQuotaFraction, writeQuotaFraction)
  const readsPctIncludedMtd = reads / D1_INCLUDED_MONTHLY_READS
  const writesPctIncludedMtd = writes / D1_INCLUDED_MONTHLY_WRITES
  const projectedReadRowsOverage = Math.max(0, projectedReads - D1_INCLUDED_MONTHLY_READS)
  const projectedWriteRowsOverage = Math.max(0, projectedWrites - D1_INCLUDED_MONTHLY_WRITES)
  const mtdReadRowsOverage = Math.max(0, reads - D1_INCLUDED_MONTHLY_READS)
  const mtdWriteRowsOverage = Math.max(0, writes - D1_INCLUDED_MONTHLY_WRITES)

  return {
    month: period.start_date.slice(0, 7),
    period: period.label,
    period_basis: 'cloudflare_account_billing_cycle' as const,
    period_start_date: period.start_date,
    period_end_date: period.end_date,
    billing_cycle_start_day: period.cycle_start_day,
    elapsed_days: period.elapsed_days,
    days_in_period: period.days_in_period,
    reads,
    writes,
    projected_reads: projectedReads,
    projected_writes: projectedWrites,
    read_quota_fraction: readQuotaFraction,
    write_quota_fraction: writeQuotaFraction,
    reads_pct_included_mtd: readsPctIncludedMtd,
    writes_pct_included_mtd: writesPctIncludedMtd,
    projected_read_rows_overage: projectedReadRowsOverage,
    projected_write_rows_overage: projectedWriteRowsOverage,
    mtd_read_rows_overage: mtdReadRowsOverage,
    mtd_write_rows_overage: mtdWriteRowsOverage,
    estimated_overage_usd: computeD1OverageCostUsd(reads, writes),
    projected_overage_usd: computeD1OverageCostUsd(projectedReads, projectedWrites),
    guardrails: {
      warn: maxFraction >= 0.6,
      restrict_nonessential: maxFraction >= 0.8,
      disable_public_live_d1_fallback: maxFraction >= 0.9,
      daily_cdr_protected: true,
      overage_allowance_usd: D1_OVERAGE_ALLOWANCE_USD,
    },
  }
}

function graphqlQuery() {
  return `
    query D1Usage($accountTag: string!, $databaseId: string!, $since: Date!, $until: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          d1AnalyticsAdaptiveGroups(
            limit: 1000
            filter: { databaseId: $databaseId, date_geq: $since, date_leq: $until }
            orderBy: [date_ASC]
          ) {
            dimensions { date databaseId }
            sum {
              readQueries
              writeQueries
              rowsRead
              rowsWritten
              queryBatchResponseBytes
            }
          }
        }
      }
    }
  `
}

function storageGraphqlQuery() {
  return `
    query D1Storage($accountTag: string!, $databaseId: string!, $since: Date!, $until: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          d1StorageAdaptiveGroups(
            limit: 1000
            filter: { databaseId: $databaseId, date_geq: $since, date_leq: $until }
            orderBy: [date_ASC]
          ) {
            dimensions { date databaseId }
            max {
              databaseSizeBytes
            }
          }
        }
      }
    }
  `
}

async function fetchCloudflareD1UsageChunk(
  token: string,
  accountId: string,
  databaseId: string,
  since: string,
  until: string,
): Promise<D1UsageDay[] | null> {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: graphqlQuery(),
      variables: {
        accountTag: accountId,
        databaseId,
        since,
        until,
      },
    }),
  })
  const body = await response.json<Record<string, unknown>>().catch(() => null)
  if (!response.ok || !body || Array.isArray(body.errors)) return null
  const accounts = (((body.data as Record<string, unknown> | undefined)?.viewer as Record<string, unknown> | undefined)
    ?.accounts ?? []) as Array<Record<string, unknown>>
  const groups = (accounts[0]?.d1AnalyticsAdaptiveGroups ?? []) as Array<{
    dimensions?: { date?: string }
    sum?: Record<string, number>
  }>
  return groups.map((group) => {
    const sum = group.sum ?? {}
    return {
      date: String(group.dimensions?.date || ''),
      reads: Math.max(0, Number(sum.rowsRead || 0)),
      writes: Math.max(0, Number(sum.rowsWritten || 0)),
      read_queries: Math.max(0, Number(sum.readQueries || 0)),
      write_queries: Math.max(0, Number(sum.writeQueries || 0)),
      response_bytes: Math.max(0, Number(sum.queryBatchResponseBytes || 0)),
      query_time_ms: 0,
      storage_bytes: 0,
      estimated_cost_usd: 0,
    }
  }).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))
}

async function fetchCloudflareD1StorageChunk(
  token: string,
  accountId: string,
  databaseId: string,
  since: string,
  until: string,
): Promise<Array<{ date: string; storage_bytes: number }> | null> {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: storageGraphqlQuery(),
      variables: {
        accountTag: accountId,
        databaseId,
        since,
        until,
      },
    }),
  })
  const body = await response.json<Record<string, unknown>>().catch(() => null)
  if (!response.ok || !body || Array.isArray(body.errors)) return null
  const accounts = (((body.data as Record<string, unknown> | undefined)?.viewer as Record<string, unknown> | undefined)
    ?.accounts ?? []) as Array<Record<string, unknown>>
  const groups = (accounts[0]?.d1StorageAdaptiveGroups ?? []) as Array<{
    dimensions?: { date?: string }
    max?: Record<string, number>
  }>
  return groups.map((group) => ({
    date: String(group.dimensions?.date || ''),
    storage_bytes: Math.max(0, Number(group.max?.databaseSizeBytes || 0)),
  })).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))
}

async function fetchCloudflareD1Usage(env: EnvBindings, days: number): Promise<CloudflareD1UsageResult> {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim()
  const token = String(env.CLOUDFLARE_GRAPHQL_API_TOKEN || env.CLOUDFLARE_API_TOKEN || '').trim()
  if (!accountId || !token) {
    return { days: null, error: !accountId ? 'missing_cloudflare_account_id' : 'missing_cloudflare_graphql_token' }
  }
  const databaseId = String(env.CLOUDFLARE_D1_DATABASE_ID || DEFAULT_D1_DATABASE_ID).trim()
  const effectiveDays = Math.min(days, GRAPHQL_MAX_HISTORY_DAYS)
  const end = new Date()
  let cursor = dateDaysAgo(effectiveDays)
  const rows: D1UsageDay[] = []
  let storageError: string | null = null
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(addUtcDays(cursor, GRAPHQL_MAX_DAYS_PER_QUERY - 1).getTime(), end.getTime()))
    const chunk = await fetchCloudflareD1UsageChunk(token, accountId, databaseId, ymd(cursor), ymd(chunkEnd))
    if (!chunk) return { days: null, error: `graphql_chunk_failed:${ymd(cursor)}:${ymd(chunkEnd)}` }
    rows.push(...chunk)
    const storage = await fetchCloudflareD1StorageChunk(token, accountId, databaseId, ymd(cursor), ymd(chunkEnd))
    if (!storage) {
      storageError = storageError || `graphql_storage_chunk_failed:${ymd(cursor)}:${ymd(chunkEnd)}`
    } else {
      const byDate = new Map(rows.map((day) => [day.date, day]))
      for (const storageDay of storage) {
        const row = byDate.get(storageDay.date) ?? emptyUsageDay(storageDay.date)
        row.storage_bytes = Math.max(row.storage_bytes, storageDay.storage_bytes)
        if (!byDate.has(storageDay.date)) rows.push(row)
        byDate.set(storageDay.date, row)
      }
    }
    cursor = addUtcDays(chunkEnd, 1)
  }
  return { days: fillUsageDateRange(rows, dateDaysAgo(effectiveDays), end), error: null, storage_error: storageError }
}

async function fallbackLocalUsage(env: EnvBindings, days: number): Promise<D1UsageDay[]> {
  const state = await readLocalD1BudgetState(env, days)
  return state.days.map((day) => ({
    date: day.date,
    reads: day.reads,
    writes: day.writes,
    read_queries: 0,
    write_queries: 0,
    response_bytes: 0,
    query_time_ms: 0,
    storage_bytes: 0,
    estimated_cost_usd: day.estimated_cost_usd,
  }))
}

export const adminCloudflareRoutes = new Hono<AppContext>()

adminCloudflareRoutes.get('/cloudflare/d1-usage', async (c) => {
  const days = clampDays(c.req.query('days'))
  try {
    const cloudflareResult = await fetchCloudflareD1Usage(c.env, days)
    const source = cloudflareResult.days ? 'cloudflare_graphql' : 'local_advisory'
    const usageDays = cloudflareResult.days ?? await fallbackLocalUsage(c.env, days)
    const now = new Date()
    const cycleStartDay = normalizeBillingCycleStartDay(c.env.CLOUDFLARE_BILLING_CYCLE_START_DAY)
    const sorted = addQuotaFields(sortDaysByDate(usageDays), cycleStartDay)
    const month = summarizeBillingPeriod(sorted, now, cycleStartDay)
    const dayRows = sorted.map((d) => ({ date: d.date, reads: d.reads, writes: d.writes }))
    const history_billing_periods = aggregateD1UsageByBillingPeriod(dayRows, cycleStartDay)
    const history_months = aggregateD1UsageByMonth(dayRows)
    const series = buildD1UsageSeries(dayRows)
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode ?? null,
      source,
      source_error: cloudflareResult.error,
      storage_source_error: cloudflareResult.storage_error ?? null,
      generated_at: new Date().toISOString(),
      quotas: {
        allowance_label: 'Cloudflare D1 included monthly (published list pricing)',
        allowance_source: 'cloudflare_d1_published_included_tier',
        billing_cycle_note:
          'This page rolls up by the configured Cloudflare account billing period. Daily rows are UTC analytics dates.',
        billing_cycle_start_day: cycleStartDay,
        billing_period: month.period,
        billing_period_start_date: month.period_start_date,
        billing_period_end_date: month.period_end_date,
        d1_reads_included_monthly: D1_INCLUDED_MONTHLY_READS,
        d1_writes_included_monthly: D1_INCLUDED_MONTHLY_WRITES,
        d1_storage_included_bytes: D1_INCLUDED_STORAGE_BYTES,
        d1_read_overage_per_million_usd: D1_READ_OVERAGE_PER_MILLION_USD,
        d1_write_overage_per_million_usd: D1_WRITE_OVERAGE_PER_MILLION_USD,
        d1_storage_overage_per_gb_month_usd: D1_STORAGE_OVERAGE_PER_GB_MONTH_USD,
        accepted_coverage_overage_usd: D1_OVERAGE_ALLOWANCE_USD,
      },
      month,
      history_billing_periods,
      history_months,
      series,
      days: sorted,
    })
  } catch (error) {
    return jsonError(
      c,
      500,
      'D1_USAGE_FAILED',
      error instanceof Error ? error.message : 'Failed to load D1 usage.',
    )
  }
})
