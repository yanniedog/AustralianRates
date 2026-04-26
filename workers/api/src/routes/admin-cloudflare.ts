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
  billable_usage?: Record<string, BillableUsageCell>
}

type CloudflareD1UsageResult = {
  days: D1UsageDay[] | null
  error: string | null
  storage_error?: string | null
}

type BillableUsageColumn = {
  key: string
  label: string
  unit: string
  quota_label: string
  rate_label: string
}

type BillableUsageCell = {
  quantity: number
  pricing_quantity: number
  unit: string
  cost_usd: number
  cumulative_cost_usd: number
  source: 'cloudflare_paygo' | 'd1_graphql_fallback'
}

type PaygoUsageRecord = {
  ServiceName?: string
  ChargePeriodStart?: string
  ConsumedQuantity?: number
  ConsumedUnit?: string
  PricingQuantity?: number
  ContractedCost?: number
  CumulatedContractedCost?: number
}

type PaygoUsageResult = {
  days: Map<string, Record<string, BillableUsageCell>>
  source: 'cloudflare_paygo' | 'unavailable'
  error: string | null
  dynamicColumns: BillableUsageColumn[]
}

const BILLABLE_USAGE_COLUMNS: BillableUsageColumn[] = [
  { key: 'durable_objects_sql_storage', label: 'Durable Objects SQL Storage', unit: 'GB-mo', quota_label: 'First 5 GB-month included', rate_label: '$0.20 / GB-mo' },
  { key: 'durable_objects_storage_rows_written', label: 'Durable Objects Storage Rows Written', unit: 'rows', quota_label: 'First 50M included', rate_label: '$1.00 / 1M' },
  { key: 'durable_objects_storage_rows_read', label: 'Durable Objects Storage Rows Read', unit: 'rows', quota_label: 'First 25B included', rate_label: '$0.001 / 1M' },
  { key: 'browser_run_average_concurrent_browsers', label: 'Browser Run - Average Concurrent Browsers', unit: 'browsers', quota_label: 'First 10 browsers included', rate_label: '$0.00 first 10' },
  { key: 'browser_run_browser_hours', label: 'Browser Run - Browser Hours', unit: 'hours', quota_label: 'First 10 hours included', rate_label: '$0.00 first 10' },
  { key: 'container_egress_everywhere_else_gb', label: 'Container Egress, Everywhere Else, per GB', unit: 'GB', quota_label: 'First 500 GB included', rate_label: '$0.00 first 500' },
  { key: 'container_egress_oceania_taiwan_korea_gb', label: 'Container Egress, Oceania, Taiwan, and Korea, per GB', unit: 'GB', quota_label: 'First 500 GB included', rate_label: '$0.00 first 500' },
  { key: 'container_egress_na_europe_gb', label: 'Container Egress, North America + Europe, per GB', unit: 'GB', quota_label: 'First 1 TB included', rate_label: '$0.00 first 1,000' },
  { key: 'container_disk_gb_second', label: 'Container Disk, per GB second', unit: 'GB-seconds', quota_label: 'First 200 GB hours included', rate_label: '$0.00 first 720,000' },
  { key: 'container_vcpu', label: 'Container vCPU', unit: 'vCPU-minutes', quota_label: 'First 375 vCPU-minutes included', rate_label: '$0.00 first 22,500' },
  { key: 'container_memory_gib_second', label: 'Container Memory, per GiB-Second', unit: 'GB-seconds', quota_label: 'First 25 GiB-hours included', rate_label: '$0.00 first 90,000' },
  { key: 'observability_logs', label: 'Observability - Logs', unit: 'logs', quota_label: 'First 20M included', rate_label: '$0.60 / 1M' },
  { key: 'worker_build_minutes', label: 'Worker Build Minutes', unit: 'minutes', quota_label: '6000 minutes included per month', rate_label: '$0.005 / minute' },
  { key: 'vectorize_stored_dimensions', label: 'Vectorize - Stored Dimensions', unit: 'dimensions', quota_label: 'First 10M dimension-month included', rate_label: '$0.05 / 100M' },
  { key: 'vectorize_queried_dimensions', label: 'Vectorize - Queried Dimensions', unit: 'dimensions', quota_label: 'First 50M included', rate_label: '$0.01 / 1M' },
  { key: 'd1_storage_gb_month', label: 'D1 - Storage GB-mo', unit: 'GB-mo', quota_label: 'First 5GB included', rate_label: '$0.75 / GB-mo' },
  { key: 'd1_rows_written', label: 'D1 - Rows Written', unit: 'rows', quota_label: 'First 50M included', rate_label: '$1.00 / 1M' },
  { key: 'd1_rows_read', label: 'D1 - Rows Read', unit: 'rows', quota_label: 'First 25B included', rate_label: '$0.001 / 1M' },
  { key: 'fast_twitch_neurons', label: 'Fast Twitch Neurons (FTN)', unit: 'neurons', quota_label: 'n/a', rate_label: '$0.125 / 1,000' },
  { key: 'regular_twitch_neurons', label: 'Regular Twitch Neurons (RTN)', unit: 'neurons', quota_label: 'n/a', rate_label: '$0.011 / 1,000' },
  { key: 'workers_cpu_ms', label: 'Workers CPU ms', unit: 'ms', quota_label: 'First 30M included', rate_label: '$0.02 / 1M' },
  { key: 'workers_standard_requests', label: 'Workers Standard Requests', unit: 'requests', quota_label: 'First 10M included', rate_label: '$0.30 / 1M' },
  { key: 'zaraz_loads', label: 'Zaraz Loads', unit: 'loads', quota_label: 'n/a', rate_label: '$0.50 / 1,000' },
  { key: 'queues_standard_operations', label: 'Queues - Standard operations', unit: 'operations', quota_label: 'First 1M included', rate_label: '$0.40 / 1M' },
  { key: 'durable_objects_compute_duration', label: 'Durable Objects Compute Duration', unit: 'GB-s', quota_label: 'First 400,000 GB-s included', rate_label: '$12.50 / 1M' },
  { key: 'durable_objects_compute_requests', label: 'Durable Objects Compute Requests', unit: 'requests', quota_label: 'First 1M included', rate_label: '$0.15 / 1M' },
  { key: 'durable_objects_storage_writes', label: 'Durable Objects Storage Writes', unit: 'writes', quota_label: 'First 1M included', rate_label: '$1.00 / 1M' },
  { key: 'durable_objects_storage_deletes', label: 'Durable Objects Storage Deletes', unit: 'deletes', quota_label: 'First 1M included', rate_label: '$1.00 / 1M' },
  { key: 'durable_objects_storage', label: 'Durable Objects Storage', unit: 'GB-mo', quota_label: 'First 1 GB-month included', rate_label: '$0.20 / GB-mo' },
  { key: 'durable_objects_storage_reads', label: 'Durable Objects Storage Reads', unit: 'reads', quota_label: 'First 1M included', rate_label: '$0.20 / 1M' },
  { key: 'logpush_enabled_workers_requests', label: 'Logpush Enabled Workers Requests', unit: 'requests', quota_label: 'First 10M included', rate_label: '$0.05 / 1M' },
  { key: 'kv_read_operations', label: 'KV Read Operations', unit: 'operations', quota_label: 'First 10M included', rate_label: '$0.50 / 1M' },
  { key: 'kv_list_operations', label: 'KV List Operations', unit: 'operations', quota_label: 'First 1M included', rate_label: '$5.00 / 1M' },
  { key: 'kv_storage', label: 'KV Storage', unit: 'GB', quota_label: 'First GB included', rate_label: '$0.50 / GB' },
  { key: 'kv_write_operations', label: 'KV Write Operations', unit: 'operations', quota_label: 'First 1M included', rate_label: '$5.00 / 1M' },
  { key: 'kv_delete_operations', label: 'KV Delete Operations', unit: 'operations', quota_label: 'First 1M included', rate_label: '$5.00 / 1M' },
  { key: 'workers_bundled_requests', label: 'Workers Bundled Requests', unit: 'requests', quota_label: 'First 10M included', rate_label: '$0.50 / 1M' },
  { key: 'workers_unbound_duration', label: 'Workers Unbound Duration', unit: 'GB-s', quota_label: 'First 400,000 GB-s included', rate_label: '$12.50 / 1M' },
  { key: 'workers_unbound_requests', label: 'Workers Unbound Requests', unit: 'requests', quota_label: 'First 1M included', rate_label: '$0.15 / 1M' },
  { key: 'r2_infrequent_access_data_retrieval', label: 'R2 Infrequent Access - Data Retrieval', unit: 'GB', quota_label: 'n/a', rate_label: '$0.01 / GB' },
  { key: 'r2_infrequent_access_class_b_operations', label: 'R2 Infrequent Access - Class B Operations', unit: 'operations', quota_label: 'n/a', rate_label: '$0.90 / 1M' },
  { key: 'r2_infrequent_access_class_a_operations', label: 'R2 Infrequent Access - Class A Operations', unit: 'operations', quota_label: 'n/a', rate_label: '$9.00 / 1M' },
  { key: 'r2_infrequent_access_storage', label: 'R2 Infrequent Access - Storage', unit: 'GB-mo', quota_label: 'n/a', rate_label: '$0.01 / GB-mo' },
  { key: 'r2_storage_class_b_operations', label: 'R2 Storage Class B Operations', unit: 'operations', quota_label: 'First 10M included', rate_label: '$0.36 / 1M' },
  { key: 'r2_storage_class_a_operations', label: 'R2 Storage Class A Operations', unit: 'operations', quota_label: 'First 1M included', rate_label: '$4.50 / 1M' },
  { key: 'r2_data_storage', label: 'R2 Data Storage', unit: 'GB-mo', quota_label: 'First 10GB-month included', rate_label: '$0.015 / GB-mo' },
  { key: 'vectorize_enabled', label: 'Vectorize - Enabled', unit: 'count', quota_label: 'n/a', rate_label: '$0.00' },
  { key: 'zaraz_enabled', label: 'Zaraz - Enabled', unit: 'count', quota_label: 'n/a', rate_label: '$0.00' },
  { key: 'queues_enabled', label: 'Queues - Enabled', unit: 'count', quota_label: 'n/a', rate_label: '$0.00' },
  { key: 'workers_paid', label: 'Workers Paid', unit: 'count', quota_label: 'n/a', rate_label: '$5.00 / month' },
  { key: 'r2_infrequent_access', label: 'R2 Infrequent Access', unit: 'count', quota_label: 'n/a', rate_label: '$0.00' },
  { key: 'r2_paid', label: 'R2 Paid', unit: 'count', quota_label: 'n/a', rate_label: '$0.00' },
]

const BILLABLE_COLUMN_BY_KEY = new Map(BILLABLE_USAGE_COLUMNS.map((column) => [column.key, column]))

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

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function columnForServiceName(serviceName: string): BillableUsageColumn {
  const normalized = slug(serviceName)
  const exact = BILLABLE_COLUMN_BY_KEY.get(normalized)
  if (exact) return exact
  const compact = normalized.replace(/_/g, '')
  const known = BILLABLE_USAGE_COLUMNS.find((column) => {
    const key = column.key.replace(/_/g, '')
    return compact.includes(key) || key.includes(compact)
  })
  if (known) return known
  return {
    key: normalized || 'unknown_billable_usage',
    label: serviceName || 'Unknown billable usage',
    unit: 'units',
    quota_label: 'n/a',
    rate_label: 'Cloudflare PayGo',
  }
}

function upsertBillableCell(
  target: Map<string, Record<string, BillableUsageCell>>,
  date: string,
  key: string,
  cell: BillableUsageCell,
): void {
  const row = target.get(date) ?? {}
  const prev = row[key]
  row[key] = prev
    ? {
      ...cell,
      quantity: prev.quantity + cell.quantity,
      pricing_quantity: prev.pricing_quantity + cell.pricing_quantity,
      cost_usd: prev.cost_usd + cell.cost_usd,
      cumulative_cost_usd: Math.max(prev.cumulative_cost_usd, cell.cumulative_cost_usd),
    }
    : cell
  target.set(date, row)
}

function addD1FallbackBillableUsage(days: D1UsageDay[], target: Map<string, Record<string, BillableUsageCell>>): void {
  for (const day of days) {
    const row = target.get(day.date) ?? {}
    if (!row.d1_rows_read) row.d1_rows_read = {
      quantity: Math.max(0, day.reads),
      pricing_quantity: Math.max(0, day.reads),
      unit: 'rows',
      cost_usd: 0,
      cumulative_cost_usd: 0,
      source: 'd1_graphql_fallback',
    }
    if (!row.d1_rows_written) row.d1_rows_written = {
      quantity: Math.max(0, day.writes),
      pricing_quantity: Math.max(0, day.writes),
      unit: 'rows',
      cost_usd: 0,
      cumulative_cost_usd: 0,
      source: 'd1_graphql_fallback',
    }
    if (!row.d1_storage_gb_month) row.d1_storage_gb_month = {
      quantity: Math.max(0, day.storage_bytes) / 1_000_000_000,
      pricing_quantity: Math.max(0, day.storage_bytes) / 1_000_000_000,
      unit: 'GB',
      cost_usd: 0,
      cumulative_cost_usd: 0,
      source: 'd1_graphql_fallback',
    }
    target.set(day.date, row)
  }
}

function attachBillableUsage(days: D1UsageDay[], billableDays: Map<string, Record<string, BillableUsageCell>>): D1UsageDay[] {
  return days.map((day) => ({
    ...day,
    billable_usage: billableDays.get(day.date) ?? {},
  }) as D1UsageDay & { billable_usage: Record<string, BillableUsageCell> })
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

async function fetchCloudflarePaygoUsage(env: EnvBindings, start: string, end: string): Promise<PaygoUsageResult> {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim()
  const token = String(env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_GRAPHQL_API_TOKEN || '').trim()
  if (!accountId || !token) {
    return {
      days: new Map(),
      source: 'unavailable',
      error: !accountId ? 'missing_cloudflare_account_id' : 'missing_cloudflare_api_token',
      dynamicColumns: [],
    }
  }
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/billing/usage/paygo`)
  url.searchParams.set('from', start)
  url.searchParams.set('to', end)
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await response.json<{
    success?: boolean
    result?: PaygoUsageRecord[]
    errors?: Array<{ message?: string; code?: number }>
  }>().catch(() => null)
  if (!response.ok || !body?.success || !Array.isArray(body.result)) {
    const err = body?.errors?.[0]
    return {
      days: new Map(),
      source: 'unavailable',
      error: err?.message || `paygo_usage_failed:${response.status}`,
      dynamicColumns: [],
    }
  }

  const days = new Map<string, Record<string, BillableUsageCell>>()
  const dynamic = new Map<string, BillableUsageColumn>()
  for (const record of body.result) {
    const date = String(record.ChargePeriodStart || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const column = columnForServiceName(String(record.ServiceName || ''))
    if (!BILLABLE_COLUMN_BY_KEY.has(column.key)) dynamic.set(column.key, column)
    upsertBillableCell(days, date, column.key, {
      quantity: Math.max(0, Number(record.ConsumedQuantity || 0)),
      pricing_quantity: Math.max(0, Number(record.PricingQuantity || 0)),
      unit: String(record.ConsumedUnit || column.unit || 'units'),
      cost_usd: Math.max(0, Number(record.ContractedCost || 0)),
      cumulative_cost_usd: Math.max(0, Number(record.CumulatedContractedCost || 0)),
      source: 'cloudflare_paygo',
    })
  }
  return { days, source: 'cloudflare_paygo', error: null, dynamicColumns: [...dynamic.values()] }
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
    const paygoStart = sorted[0]?.date ?? ymd(dateDaysAgo(days))
    const paygoEnd = ymd(addUtcDays(new Date(`${sorted[sorted.length - 1]?.date ?? ymd(now)}T00:00:00.000Z`), 1))
    const paygo = await fetchCloudflarePaygoUsage(c.env, paygoStart, paygoEnd)
    const billableDays = new Map(paygo.days)
    addD1FallbackBillableUsage(sorted, billableDays)
    const daysWithBillableUsage = attachBillableUsage(sorted, billableDays)
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
      billable_source: paygo.source,
      billable_source_error: paygo.error,
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
      billable_columns: [...BILLABLE_USAGE_COLUMNS, ...paygo.dynamicColumns],
      days: daysWithBillableUsage,
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
