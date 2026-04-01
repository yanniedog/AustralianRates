const SAFE_TABLE_NAME_RE = /^[a-zA-Z0-9_]+$/
const SAFE_COLUMN_NAME_RE = /^[a-zA-Z0-9_]+$/
const SAMPLE_SIZE = 2000

export type DbTableStat = {
  name: string
  row_count: number
  estimated_bytes: number | null
}

export async function getApproximateDatabaseSizeBytes(db: D1Database): Promise<number | null> {
  try {
    const run = await db.prepare('SELECT 1').run()
    const sizeAfter = (run.meta as { size_after?: number } | undefined)?.size_after
    return typeof sizeAfter === 'number' && sizeAfter > 0 ? sizeAfter : null
  } catch {
    return null
  }
}

export async function estimateTableBytes(
  db: D1Database,
  tableName: string,
  rowCount: number,
): Promise<number | null> {
  if (rowCount <= 0 || !SAFE_TABLE_NAME_RE.test(tableName)) return 0
  try {
    const pragma = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>()
    const columns = (pragma.results ?? [])
      .map((row) => String(row.name ?? '').trim())
      .filter((name) => SAFE_COLUMN_NAME_RE.test(name))
    if (columns.length === 0) return null
    const lengthExpr = columns.map((column) => `LENGTH(COALESCE("${column}", ''))`).join(' + ')
    const limit = Math.min(SAMPLE_SIZE, rowCount)
    const row = await db
      .prepare(`SELECT SUM(s) AS total FROM (SELECT (${lengthExpr}) AS s FROM "${tableName}" LIMIT ?1)`)
      .bind(limit)
      .first<{ total: number | null }>()
    const total = row?.total
    if (total == null || total === 0) return limit === rowCount ? 0 : null
    return Math.round((total / limit) * rowCount)
  } catch {
    return null
  }
}

export async function listDbTableStats(db: D1Database): Promise<DbTableStat[]> {
  const list = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
       ORDER BY name ASC`,
    )
    .all<{ name: string }>()
  const names = (list.results ?? []).map((row) => String(row.name || '').trim()).filter(Boolean)
  const tables: DbTableStat[] = []
  for (const name of names) {
    if (!SAFE_TABLE_NAME_RE.test(name)) continue
    let rowCount = -1
    try {
      const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first<{ n: number }>()
      rowCount = row?.n ?? 0
    } catch {
      rowCount = -1
    }
    const estimatedBytes = rowCount >= 0 ? await estimateTableBytes(db, name, rowCount) : null
    tables.push({ name, row_count: rowCount, estimated_bytes: estimatedBytes })
  }
  return tables.sort((left, right) => (right.estimated_bytes ?? 0) - (left.estimated_bytes ?? 0))
}
