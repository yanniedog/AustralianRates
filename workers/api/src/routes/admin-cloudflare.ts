import { Hono } from 'hono'
import type { AppContext, EnvBindings } from '../types'
import {
  D1_INCLUDED_MONTHLY_READS,
  D1_INCLUDED_MONTHLY_WRITES,
  D1_OVERAGE_ALLOWANCE_USD,
  D1_READ_OVERAGE_PER_MILLION_USD,
  D1_WRITE_OVERAGE_PER_MILLION_USD,
  readLocalD1BudgetState,
} from '../utils/d1-budget'
import { jsonError } from '../utils/http'

const DEFAULT_D1_DATABASE_ID = 'de6d4315-686b-4022-b080-956ca3819976'
const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'

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
}

function clampDays(value: string | undefined): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return 31
  return Math.max(1, Math.min(31, parsed))
}

function dateDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - Math.max(0, days - 1))
  return date.toISOString().slice(0, 10)
}

function costUsd(reads: number, writes: number): number {
  const readOverage = Math.max(0, reads - D1_INCLUDED_MONTHLY_READS)
  const writeOverage = Math.max(0, writes - D1_INCLUDED_MONTHLY_WRITES)
  return (readOverage / 1_000_000) * D1_READ_OVERAGE_PER_MILLION_USD
    + (writeOverage / 1_000_000) * D1_WRITE_OVERAGE_PER_MILLION_USD
}

function summarizeMonth(days: D1UsageDay[]) {
  const now = new Date()
  const month = now.toISOString().slice(0, 7)
  const monthDays = days.filter((day) => day.date.startsWith(`${month}-`))
  const reads = monthDays.reduce((sum, day) => sum + day.reads, 0)
  const writes = monthDays.reduce((sum, day) => sum + day.writes, 0)
  const elapsedDays = Math.max(1, Number(now.toISOString().slice(8, 10)))
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const projectedReads = Math.round((reads / elapsedDays) * daysInMonth)
  const projectedWrites = Math.round((writes / elapsedDays) * daysInMonth)
  const readQuotaFraction = projectedReads / D1_INCLUDED_MONTHLY_READS
  const writeQuotaFraction = projectedWrites / D1_INCLUDED_MONTHLY_WRITES
  const maxFraction = Math.max(readQuotaFraction, writeQuotaFraction)

  return {
    month,
    elapsed_days: elapsedDays,
    reads,
    writes,
    projected_reads: projectedReads,
    projected_writes: projectedWrites,
    read_quota_fraction: readQuotaFraction,
    write_quota_fraction: writeQuotaFraction,
    estimated_overage_usd: costUsd(reads, writes),
    projected_overage_usd: costUsd(projectedReads, projectedWrites),
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
    query D1Usage($accountTag: string!, $databaseId: string!, $since: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          d1AnalyticsAdaptiveGroups(
            limit: 100
            filter: { databaseId: $databaseId, date_geq: $since }
            orderBy: [date_ASC]
          ) {
            dimensions { date databaseId }
            sum {
              readQueries
              writeQueries
              rowsRead
              rowsWritten
              queryBatchResponseBytes
              queryBatchTimeMs
            }
            max { databaseSizeBytes }
          }
        }
      }
    }
  `
}

async function fetchCloudflareD1Usage(env: EnvBindings, days: number): Promise<D1UsageDay[] | null> {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim()
  const token = String(env.CLOUDFLARE_API_TOKEN || '').trim()
  if (!accountId || !token) return null
  const databaseId = String(env.CLOUDFLARE_D1_DATABASE_ID || DEFAULT_D1_DATABASE_ID).trim()
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
        since: dateDaysAgo(days),
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
    max?: Record<string, number>
  }>
  return groups.map((group) => {
    const sum = group.sum ?? {}
    const max = group.max ?? {}
    return {
      date: String(group.dimensions?.date || ''),
      reads: Math.max(0, Number(sum.rowsRead || 0)),
      writes: Math.max(0, Number(sum.rowsWritten || 0)),
      read_queries: Math.max(0, Number(sum.readQueries || 0)),
      write_queries: Math.max(0, Number(sum.writeQueries || 0)),
      response_bytes: Math.max(0, Number(sum.queryBatchResponseBytes || 0)),
      query_time_ms: Math.max(0, Number(sum.queryBatchTimeMs || 0)),
      storage_bytes: Math.max(0, Number(max.databaseSizeBytes || 0)),
      estimated_cost_usd: 0,
    }
  }).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))
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
    const cloudflareDays = await fetchCloudflareD1Usage(c.env, days)
    const source = cloudflareDays ? 'cloudflare_graphql' : 'local_advisory'
    const usageDays = cloudflareDays ?? await fallbackLocalUsage(c.env, days)
    const month = summarizeMonth(usageDays)
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode ?? null,
      source,
      generated_at: new Date().toISOString(),
      quotas: {
        d1_reads_included_monthly: D1_INCLUDED_MONTHLY_READS,
        d1_writes_included_monthly: D1_INCLUDED_MONTHLY_WRITES,
        d1_read_overage_per_million_usd: D1_READ_OVERAGE_PER_MILLION_USD,
        d1_write_overage_per_million_usd: D1_WRITE_OVERAGE_PER_MILLION_USD,
        accepted_coverage_overage_usd: D1_OVERAGE_ALLOWANCE_USD,
      },
      month,
      days: usageDays,
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
