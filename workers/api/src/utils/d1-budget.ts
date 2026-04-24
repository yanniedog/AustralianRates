import type { EnvBindings } from '../types'

type D1Usage = {
  date: string
  reads: number
  writes: number
  updated_at: string
}

type Tracker = {
  env: EnvBindings
  usage: D1Usage
  flush: () => Promise<void>
}

const DEFAULT_DAILY_READ_LIMIT = 166_666_666
const DEFAULT_DAILY_WRITE_LIMIT = 1_000_000
const DEFAULT_DISABLE_FRACTION = 0.75

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
    }
  } catch {
    return { date, reads: 0, writes: 0, updated_at: new Date().toISOString() }
  }
}

function wrapStatement(statement: D1PreparedStatement, usage: D1Usage): D1PreparedStatement {
  return new Proxy(statement as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      if (prop === 'run') {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args)
          usage.reads += metaCount(result?.meta, 'rows_read')
          usage.writes += resultWrites(result)
          usage.updated_at = new Date().toISOString()
          return result
        }
      }
      if (prop === 'all') {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args)
          usage.reads += resultReads(result)
          usage.writes += resultWrites(result)
          usage.updated_at = new Date().toISOString()
          return result
        }
      }
      if (prop === 'first' || prop === 'raw') {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args)
          usage.reads += 1
          usage.updated_at = new Date().toISOString()
          return result
        }
      }
      return value.bind(target)
    },
  }) as unknown as D1PreparedStatement
}

function wrapDb(db: D1Database, usage: D1Usage): D1Database {
  return new Proxy(db as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === 'prepare' && typeof value === 'function') {
        return (...args: unknown[]) => wrapStatement(value.apply(target, args), usage)
      }
      if (prop === 'batch' && typeof value === 'function') {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args)
          const rows = Array.isArray(result) ? result : []
          usage.reads += rows.reduce((sum, row) => sum + metaCount(row?.meta, 'rows_read'), 0)
          usage.writes += rows.reduce((sum, row) => sum + resultWrites(row), 0)
          usage.updated_at = new Date().toISOString()
          return result
        }
      }
      if (prop === 'exec' && typeof value === 'function') {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args)
          usage.reads += resultReads(result)
          usage.writes += resultWrites(result)
          usage.updated_at = new Date().toISOString()
          return result
        }
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as unknown as D1Database
}

export async function createD1BudgetTracker(env: EnvBindings): Promise<Tracker> {
  const stored = await readStoredUsage(env)
  const usage = { ...stored }
  return {
    env: { ...env, DB: wrapDb(env.DB, usage) },
    usage,
    flush: async () => {
      const kv = budgetKv(env)
      if (!kv) return
      try {
        await kv.put(budgetKey(usage.date), JSON.stringify(usage), { expirationTtl: 3 * 24 * 60 * 60 })
      } catch {
        // Cost tracking is advisory; do not fail ingest because the budget counter could not persist.
      }
    },
  }
}

export async function withD1BudgetTracking<T>(
  env: EnvBindings,
  task: (trackedEnv: EnvBindings) => Promise<T>,
): Promise<T> {
  const tracker = await createD1BudgetTracker(env)
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
