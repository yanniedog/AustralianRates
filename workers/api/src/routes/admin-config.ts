import { Hono } from 'hono'
import { ensureAppConfigTable } from '../db/app-config'
import { MIN_RATE_CHECK_INTERVAL_MINUTES, RATE_CHECK_INTERVAL_MINUTES_KEY } from '../constants'
import type { AppContext, EnvBindings } from '../types'
import { jsonError } from '../utils/http'

const APP_CONFIG_TABLE = 'app_config'

/** Safe env keys to expose read-only in admin (no secrets). */
const SAFE_ENV_KEYS = [
  'WORKER_VERSION',
  'PUBLIC_API_BASE_PATH',
  'MELBOURNE_TIMEZONE',
  'MELBOURNE_TARGET_HOUR',
  'MANUAL_RUN_COOLDOWN_SECONDS',
  'LOCK_TTL_SECONDS',
  'MAX_QUEUE_ATTEMPTS',
  'MAX_PRODUCTS_PER_LENDER',
  'PERSIST_SUCCESSFUL_PRODUCT_DETAILS',
  'FEATURE_PROSPECTIVE_ENABLED',
  'FEATURE_BACKFILL_ENABLED',
  'AUTO_BACKFILL_DAILY_QUEUE_CAP',
  'CF_ACCESS_TEAM_DOMAIN',
  'CF_ACCESS_AUD',
] as const

export const adminConfigRoutes = new Hono<AppContext>()

function normalizeRateCheckMinutes(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const text = String(raw ?? '').trim()
  if (!/^-?\d+$/.test(text)) {
    return { ok: false, error: 'rate_check_interval_minutes must be an integer.' }
  }
  const parsed = Number.parseInt(text, 10)
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: 'rate_check_interval_minutes must be a valid integer.' }
  }
  return { ok: true, value: String(Math.max(MIN_RATE_CHECK_INTERVAL_MINUTES, parsed)) }
}

/** GET /admin/config - return all app_config rows */
adminConfigRoutes.get('/config', async (c) => {
  const db = c.env.DB
  await ensureAppConfigTable(db)
  const stmt = db.prepare(`SELECT key, value, updated_at FROM ${APP_CONFIG_TABLE} ORDER BY key`)
  const result = await stmt.all<{ key: string; value: string; updated_at: string }>()
  const rows = result.results || []
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode ?? null,
    config: rows,
  })
})

/** PUT /admin/config - upsert one key */
adminConfigRoutes.put('/config', async (c) => {
  const body = await c.req.json<{ key: string; value: string }>().catch(() => null)
  if (!body || typeof body.key !== 'string' || body.key.trim() === '') {
    return jsonError(c, 400, 'BAD_REQUEST', 'Missing or invalid key')
  }
  const key = String(body.key).trim()
  let value = typeof body.value === 'string' ? body.value : String(body.value ?? '')

  if (key === RATE_CHECK_INTERVAL_MINUTES_KEY) {
    const normalized = normalizeRateCheckMinutes(value)
    if (!normalized.ok) {
      return jsonError(c, 400, 'BAD_REQUEST', normalized.error)
    }
    value = normalized.value
  }

  const db = c.env.DB
  await ensureAppConfigTable(db)
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO ${APP_CONFIG_TABLE} (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
    .run()

  const row = await db
    .prepare(`SELECT key, value, updated_at FROM ${APP_CONFIG_TABLE} WHERE key = ?`)
    .bind(key)
    .first<{ key: string; value: string; updated_at: string }>()

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode ?? null,
    row: row ?? { key, value, updated_at: now },
  })
})

/** DELETE /admin/config - remove one key (reset to env default) */
adminConfigRoutes.delete('/config', async (c) => {
  const body = await c.req.json<{ key: string }>().catch(() => null)
  if (!body || typeof body.key !== 'string' || body.key.trim() === '') {
    return jsonError(c, 400, 'BAD_REQUEST', 'Missing or invalid key')
  }
  const key = String(body.key).trim()
  const db = c.env.DB
  await ensureAppConfigTable(db)
  const result = await db.prepare(`DELETE FROM ${APP_CONFIG_TABLE} WHERE key = ?`).bind(key).run()
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode ?? null,
    deleted: (result.meta.changes ?? 0) > 0,
  })
})

/** GET /admin/env - read-only safe env vars (no secrets) */
adminConfigRoutes.get('/env', async (c) => {
  const env = c.env as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of SAFE_ENV_KEYS) {
    const v = env[k]
    if (v !== undefined && v !== null) out[k] = String(v)
  }
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode ?? null,
    env: out,
  })
})
