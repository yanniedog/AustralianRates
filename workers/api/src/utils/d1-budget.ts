import type { EnvBindings } from '../types'

export type D1WorkloadClass = 'critical_coverage' | 'essential_serving' | 'deferable' | 'nonessential'

type D1Usage = {
  date: string
  reads: number
  writes: number
  updated_at: string
  by_class?: Partial<Record<D1WorkloadClass, { reads: number; writes: number }>>
}

type Tracker = {
  env: EnvBindings
  usage: D1Usage
  flush: () => Promise<void>
}

const DEFAULT_DAILY_READ_LIMIT = 166_666_666
const DEFAULT_DAILY_WRITE_LIMIT = 1_000_000
const DEFAULT_DISABLE_FRACTION = 0.75
export const D1_INCLUDED_MONTHLY_READS = 25_000_000_000
export const D1_INCLUDED_MONTHLY_WRITES = 50_000_000
export const D1_READ_OVERAGE_PER_MILLION_USD = 0.001
export const D1_WRITE_OVERAGE_PER_MILLION_USD = 1
export const D1_OVERAGE_ALLOWANCE_USD = 20
const LOCAL_USAGE_RETENTION_SECONDS = 35 * 24 * 60 * 60

/** Cloudflare D1 published included tier vs overage pricing (USD). */
export function computeD1OverageCostUsd(reads: number, writes: number): number {
  const readOverage = Math.max(0, reads - D1_INCLUDED_MONTHLY_READS)
  const writeOverage = Math.max(0, writes - D1_INCLUDED_MONTHLY_WRITES)
  return (readOverage / 1_000_000) * D1_READ_OVERAGE_PER_MILLION_USD
    + (writeOverage / 1_000_000) * D1_WRITE_OVERAGE_PER_MILLION_USD
}

function ymd(): string {
  return new Date().toISOString().slice(0, 10)
}

function budgetKey(date = ymd()): string {
  return `d1-budget:${date}`
}

function budgetKv(env: EnvBindings): KVNamespace | undefined {
  return env.IDEMPOTENCY_KV || env.CHART_CACHE_KV
}

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseFraction(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return DEFAULT_DISABLE_FRACTION
  return parsed
}

function emptyClassUsage(): Record<D1WorkloadClass, { reads: number; writes: number }> {
  return {
    critical_coverage: { reads: 0, writes: 0 },
    essential_serving: { reads: 0, writes: 0 },
    deferable: { reads: 0, writes: 0 },
    nonessential: { reads: 0, writes: 0 },
  }
}

function normalizeWorkloadClass(value: string | undefined): D1WorkloadClass {
  if (
    value === 'critical_coverage' ||
    value === 'essential_serving' ||
    value === 'deferable' ||
    value === 'nonessential'
  ) {
    return value
  }
  return 'essential_serving'
}

function addClassUsage(usage: D1Usage, workload: D1WorkloadClass, reads: number, writes: number): void {
  if (!usage.by_class) usage.by_class = {}
  const current = usage.by_class[workload] || { reads: 0, writes: 0 }
  usage.by_class[workload] = {
    reads: current.reads + Math.max(0, reads),
    writes: current.writes + Math.max(0, writes),
  }
}

function metaCount(meta: unknown, key: 'rows_read' | 'rows_written'): number {
  if (!meta || typeof meta !== 'object') return 0
  const raw = (meta as Record<string, unknown>)[key]
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function resultReads(value: unknown): number {
  if (value && typeof value === 'object') {
    const metaReads = metaCount((value as { meta?: unknown }).meta, 'rows_read')
    if (metaReads > 0) return metaReads
    const results = (value as { results?: unknown }).results
    if (Array.isArray(results)) return Math.max(1, results.length)
  }
  return 1
}

function resultWrites(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const meta = (value as { meta?: unknown }).meta
  const metaWrites = metaCount(meta, 'rows_written')
  if (metaWrites > 0) return metaWrites
  const changes = Number((meta as Record<string, unknown> | undefined)?.changes)
  return Number.isFinite(changes) && changes > 0 ? changes : 0
}

async function readStoredUsage(env: EnvBindings): Promise<D1Usage> {
  const date = ymd()
  const kv = budgetKv(env)
  if (!kv) return { date, reads: 0, writes: 0, updated_at: new Date().toISOString() }
  try {
    const raw = await kv.get(budgetKey(date))
    const parsed = raw ? (JSON.parse(raw) as Partial<D1Usage>) : null
    return {
      date,
      reads: Math.max(0, Number(parsed?.reads || 0)),
      writes: Math.max(0, Number(parsed?.writes || 0)),
      updated_at: String(parsed?.updated_at || new Date().toISOString()),
      by_class: parsed?.by_class,
    }
  } catch {
    return { date, reads: 0, writes: 0, updated_at: new Date().toISOString() }
  }
}

function recordUsage(usage: D1Usage, workload: D1WorkloadClass, reads: number, writes: number): void {
  usage.reads += Math.max(0, reads)
  usage.writes += Math.max(0, writes)
  usage.updated_at = new Date().toISOString()
  addClassUsage(usage, workload, reads, writes)
}

function wrapStatement(statement: D1PreparedStatement, usage: D1Usage, workload: D1WorkloadClass): D1PreparedStatement {
  return new Proxy(statement as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      if (prop === 'run') {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args)
          recordUsage(usage, workload, metaCount(result?.meta, 'rows_read'), resultWrites(result))
          return result
        }
      }
      if (prop === 'all') {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args)
          recordUsage(usage, workload, resultReads(result), resultWrites(result))
          return result
        }
      }
      if (prop === 'first' || prop === 'raw') {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args)
          recordUsage(usage, workload, 1, 0)
          return result
        }
      }
      return value.bind(target)
    },
  }) as unknown as D1PreparedStatement
}

function wrapDb(db: D1Database, usage: D1Usage, workload: D1WorkloadClass): D1Database {
  return new Proxy(db as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === 'prepare' && typeof value === 'function') {
        return (...args: unknown[]) => wrapStatement(value.apply(target, args), usage, workload)
      }
      if (prop === 'batch' && typeof value === 'function') {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args)
          const rows = Array.isArray(result) ? result : []
          recordUsage(
            usage,
            workload,
            rows.reduce((sum, row) => sum + metaCount(row?.meta, 'rows_read'), 0),
            rows.reduce((sum, row) => sum + resultWrites(row), 0),
          )
          return result
        }
      }
      if (prop === 'exec' && typeof value === 'function') {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args)
          recordUsage(usage, workload, resultReads(result), resultWrites(result))
          return result
        }
      }
      if (prop === 'withSession' && typeof value === 'function') {
        return (...args: unknown[]) => wrapDb(value.apply(target, args), usage, workload)
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as unknown as D1Database
}

export async function createD1BudgetTracker(
  env: EnvBindings,
  options?: { workload?: D1WorkloadClass },
): Promise<Tracker> {
  const stored = await readStoredUsage(env)
  const usage = { ...stored }
  const workload = normalizeWorkloadClass(options?.workload)
  const trackedDb = wrapDb(env.DB, usage, workload)
  const trackedReadDb = env.READ_DB ? wrapDb(env.READ_DB, usage, workload) : undefined
  return {
    env: { ...env, DB: trackedDb, ...(trackedReadDb ? { READ_DB: trackedReadDb } : {}) },
    usage,
    flush: async () => {
      const kv = budgetKv(env)
      if (!kv) return
      try {
        await kv.put(budgetKey(usage.date), JSON.stringify(usage), { expirationTtl: LOCAL_USAGE_RETENTION_SECONDS })
      } catch {
        // Cost tracking is advisory; do not fail ingest because the budget counter could not persist.
      }
    },
  }
}

export async function withD1BudgetTracking<T>(
  env: EnvBindings,
  task: (trackedEnv: EnvBindings) => Promise<T>,
  options?: { workload?: D1WorkloadClass },
): Promise<T> {
  const tracker = await createD1BudgetTracker(env, options)
  try {
    return await task(tracker.env)
  } finally {
    await tracker.flush()
  }
}

export async function isD1NonEssentialWorkDisabled(env: EnvBindings): Promise<boolean> {
  const usage = await readStoredUsage(env)
  const readLimit = parseLimit(env.D1_DAILY_READ_LIMIT, DEFAULT_DAILY_READ_LIMIT)
  const writeLimit = parseLimit(env.D1_DAILY_WRITE_LIMIT, DEFAULT_DAILY_WRITE_LIMIT)
  const disableFraction = parseFraction(env.D1_NONESSENTIAL_DISABLE_FRACTION)
  return usage.reads >= readLimit * disableFraction || usage.writes >= writeLimit * disableFraction
}

export type D1BudgetDay = D1Usage & {
  estimated_cost_usd: number
}

export type D1BudgetState = {
  source: 'local'
  generated_at: string
  days: D1BudgetDay[]
  month: {
    month: string
    elapsed_days: number
    reads: number
    writes: number
    projected_reads: number
    projected_writes: number
    read_quota_fraction: number
    write_quota_fraction: number
    estimated_overage_usd: number
    projected_overage_usd: number
  }
  guardrails: {
    warn: boolean
    restrict_nonessential: boolean
    disable_public_live_d1_fallback: boolean
    daily_cdr_protected: true
    overage_allowance_usd: number
  }
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

async function readUsageForDate(env: EnvBindings, date: string): Promise<D1Usage | null> {
  const kv = budgetKv(env)
  if (!kv) return null
  try {
    const raw = await kv.get(budgetKey(date))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<D1Usage>
    return {
      date,
      reads: Math.max(0, Number(parsed.reads || 0)),
      writes: Math.max(0, Number(parsed.writes || 0)),
      updated_at: String(parsed.updated_at || ''),
      by_class: parsed.by_class,
    }
  } catch {
    return null
  }
}

export async function readLocalD1BudgetState(env: EnvBindings, days = 31): Promise<D1BudgetState> {
  const now = new Date()
  const count = Math.max(1, Math.min(35, Math.floor(days)))
  const rows: D1BudgetDay[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = addDays(now, -i).toISOString().slice(0, 10)
    const usage = await readUsageForDate(env, date)
    rows.push({
      date,
      reads: usage?.reads ?? 0,
      writes: usage?.writes ?? 0,
      updated_at: usage?.updated_at || '',
      by_class: usage?.by_class || emptyClassUsage(),
      estimated_cost_usd: computeD1OverageCostUsd(usage?.reads ?? 0, usage?.writes ?? 0),
    })
  }

  const month = now.toISOString().slice(0, 7)
  const monthRows = rows.filter((row) => row.date.startsWith(`${month}-`))
  const reads = monthRows.reduce((sum, row) => sum + row.reads, 0)
  const writes = monthRows.reduce((sum, row) => sum + row.writes, 0)
  const elapsedDays = Math.max(1, Number(now.toISOString().slice(8, 10)))
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const projectedReads = Math.round((reads / elapsedDays) * daysInMonth)
  const projectedWrites = Math.round((writes / elapsedDays) * daysInMonth)
  const readFraction = projectedReads / D1_INCLUDED_MONTHLY_READS
  const writeFraction = projectedWrites / D1_INCLUDED_MONTHLY_WRITES
  const maxFraction = Math.max(readFraction, writeFraction)

  return {
    source: 'local',
    generated_at: now.toISOString(),
    days: rows,
    month: {
      month,
      elapsed_days: elapsedDays,
      reads,
      writes,
      projected_reads: projectedReads,
      projected_writes: projectedWrites,
      read_quota_fraction: readFraction,
      write_quota_fraction: writeFraction,
      estimated_overage_usd: computeD1OverageCostUsd(reads, writes),
      projected_overage_usd: computeD1OverageCostUsd(projectedReads, projectedWrites),
    },
    guardrails: {
      warn: maxFraction >= 0.6,
      restrict_nonessential: maxFraction >= 0.8,
      disable_public_live_d1_fallback: maxFraction >= 0.9,
      daily_cdr_protected: true,
      overage_allowance_usd: D1_OVERAGE_ALLOWANCE_USD,
    },
  }
}

export async function isPublicLiveD1FallbackDisabled(env: EnvBindings): Promise<boolean> {
  const state = await readLocalD1BudgetState(env, 31)
  return state.guardrails.disable_public_live_d1_fallback
}
