const OPERATIONAL_INTERNAL_PREFIXES = ['sqlite_', '_cf_']

export function isOperationalInternalTable(tableName: string): boolean {
  const normalized = String(tableName || '').trim().toLowerCase()
  if (!normalized) return true
  return OPERATIONAL_INTERNAL_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export function isProtectedOperationalTableError(error: unknown): boolean {
  const message = (error as Error)?.message || String(error || '')
  return message.includes('SQLITE_AUTH') && message.includes('access to')
}

export async function listOperationalTables(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
       ORDER BY name ASC`,
    )
    .all<{ name: string }>()

  return (result.results ?? [])
    .map((row) => String(row.name || '').trim())
    .filter((tableName) => tableName && !isOperationalInternalTable(tableName))
}
