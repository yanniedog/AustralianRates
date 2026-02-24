const APP_CONFIG_TABLE = 'app_config'

/** Get a single app_config value by key. Returns null if missing. */
export async function getAppConfig(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM ${APP_CONFIG_TABLE} WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>()
  return row?.value ?? null
}

/** Set (upsert) a single app_config value. */
export async function setAppConfig(db: D1Database, key: string, value: string): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO ${APP_CONFIG_TABLE} (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
    .run()
}
