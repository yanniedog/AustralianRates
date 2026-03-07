import { INGEST_PAUSE_MODE_KEY, INGEST_PAUSE_REASON_KEY } from '../constants'
import type { IngestPauseMode } from '../types'

const APP_CONFIG_TABLE = 'app_config'

export async function ensureAppConfigTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${APP_CONFIG_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
    )
    .run()
}

/** Get a single app_config value by key. Returns null if missing. */
export async function getAppConfig(db: D1Database, key: string): Promise<string | null> {
  await ensureAppConfigTable(db)
  const row = await db
    .prepare(`SELECT value FROM ${APP_CONFIG_TABLE} WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>()
  return row?.value ?? null
}

/** Set (upsert) a single app_config value. */
export async function setAppConfig(db: D1Database, key: string, value: string): Promise<void> {
  await ensureAppConfigTable(db)
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO ${APP_CONFIG_TABLE} (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
    .run()
}

export async function getIngestPauseConfig(
  db: D1Database,
): Promise<{ mode: IngestPauseMode; reason: string | null }> {
  await ensureAppConfigTable(db)
  const result = await db
    .prepare(
      `SELECT key, value
       FROM ${APP_CONFIG_TABLE}
       WHERE key IN (?1, ?2)`,
    )
    .bind(INGEST_PAUSE_MODE_KEY, INGEST_PAUSE_REASON_KEY)
    .all<{ key: string; value: string }>()

  let mode: IngestPauseMode = 'active'
  let reason: string | null = null
  for (const row of result.results ?? []) {
    if (row.key === INGEST_PAUSE_MODE_KEY) {
      mode = row.value === 'repair_pause' ? 'repair_pause' : 'active'
    } else if (row.key === INGEST_PAUSE_REASON_KEY) {
      const value = String(row.value ?? '').trim()
      reason = value || null
    }
  }

  return { mode, reason }
}
