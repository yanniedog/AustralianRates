import type { Context } from 'hono'
import type { AppContext, EnvBindings } from '../types'

type D1WithSession = D1Database & {
  withSession?: (constraint?: string) => D1Database
}

/**
 * D1 read path for public/query handlers.
 * - Optional READ_DB binding (explicit replica) when configured.
 * - Otherwise uses D1 Sessions API (`withSession()`) so read replication can route to regional replicas.
 * - Falls back to primary `DB` when Sessions API is unavailable (e.g. older local tooling).
 */
function d1ForReads(env: Pick<EnvBindings, 'DB' | 'READ_DB'>): D1Database {
  if (env.READ_DB) return env.READ_DB
  const db = env.DB as D1WithSession
  if (typeof db.withSession === 'function') {
    return db.withSession() as D1Database
  }
  return env.DB
}

/** One logical read session per HTTP request (sequential consistency across queries in the handler). */
export function getReadDb(c: Context<AppContext>): D1Database {
  const cached = c.get('readD1')
  if (cached) return cached
  const db = d1ForReads(c.env)
  c.set('readD1', db)
  return db
}

/** Cron, queue consumers, and helpers that only have `env` (no Hono context). */
export function getReadDbFromEnv(env: Pick<EnvBindings, 'DB' | 'READ_DB'>): D1Database {
  return d1ForReads(env)
}
