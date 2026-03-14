import { isDatabaseDumpInternalTable, isProtectedDatabaseDumpTableError } from './admin-download-dump'

export type SchemaObjectType = 'table' | 'index' | 'trigger' | 'view'

export type SchemaObject = {
  type: SchemaObjectType
  name: string
  tbl_name: string
  sql: string
}

export type TableSchema = {
  name: string
  sql: string
}

export type DatabaseSchema = {
  tables: TableSchema[]
  indexes: SchemaObject[]
  triggers: SchemaObject[]
  views: SchemaObject[]
}

export type DatabaseObjectSnapshot = {
  tables: string[]
  views: string[]
  triggers: string[]
}

type TableColumnRow = {
  cid: number
  name: string
}

export function quoteSqlIdentifier(value: string): string {
  return `"${String(value || '').replace(/"/g, '""')}"`
}

export async function readDatabaseSchema(db: D1Database): Promise<DatabaseSchema> {
  const result = await db
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_master
       WHERE sql IS NOT NULL
         AND type IN ('table', 'index', 'trigger', 'view')
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
       ORDER BY type ASC, name ASC`,
    )
    .all<SchemaObject>()

  const rows = (result.results ?? []).filter((row) => !isDatabaseDumpInternalTable(row.name))
  return {
    tables: rows
      .filter((row) => row.type === 'table')
      .map((row) => ({ name: row.name, sql: row.sql })),
    indexes: rows.filter((row) => row.type === 'index'),
    triggers: rows.filter((row) => row.type === 'trigger'),
    views: rows.filter((row) => row.type === 'view'),
  }
}

export async function listDatabaseObjectSnapshot(db: D1Database): Promise<DatabaseObjectSnapshot> {
  const result = await db
    .prepare(
      `SELECT type, name
       FROM sqlite_master
       WHERE type IN ('table', 'trigger', 'view')
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
       ORDER BY type ASC, name ASC`,
    )
    .all<{ type: 'table' | 'trigger' | 'view'; name: string }>()

  const rows = (result.results ?? []).filter((row) => !isDatabaseDumpInternalTable(row.name))
  return {
    tables: rows.filter((row) => row.type === 'table').map((row) => row.name),
    triggers: rows.filter((row) => row.type === 'trigger').map((row) => row.name),
    views: rows.filter((row) => row.type === 'view').map((row) => row.name),
  }
}

export async function readTableColumns(db: D1Database, tableName: string): Promise<string[]> {
  const result = await db.prepare(`PRAGMA table_info(${quoteSqlIdentifier(tableName)})`).all<TableColumnRow>()
  return (result.results ?? [])
    .slice()
    .sort((left, right) => Number(left.cid ?? 0) - Number(right.cid ?? 0))
    .map((row) => String(row.name || '').trim())
    .filter(Boolean)
}

export async function countTableRows(db: D1Database, tableName: string): Promise<number> {
  try {
    const result = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${quoteSqlIdentifier(tableName)}`)
      .first<{ n: number }>()
    return Math.max(0, Number(result?.n ?? 0))
  } catch (error) {
    if (isDatabaseDumpInternalTable(tableName) || isProtectedDatabaseDumpTableError(error)) return 0
    throw error
  }
}
