/**
 * Admin DB routes: list tables, schema, paginated rows, get by key, insert, update, delete.
 * All table names are allowlisted; key columns for update/delete are defined per table.
 */

import { Hono } from 'hono'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'

const ADMIN_DB_TABLES = [
  'historical_loan_rates',
  'historical_savings_rates',
  'historical_term_deposit_rates',
  'raw_payloads',
  'run_reports',
  'lender_endpoint_cache',
  'brand_normalization_map',
  'backfill_cursors',
  'auto_backfill_progress',
  'client_historical_runs',
  'client_historical_tasks',
  'client_historical_batches',
  'rba_cash_rates',
  'global_log',
] as const

type TableName = (typeof ADMIN_DB_TABLES)[number]

/** Rate tables are read/delete only via admin; all writes must go through validated ingest pipeline. */
const RATE_TABLES_READ_ONLY: TableName[] = [
  'historical_loan_rates',
  'historical_savings_rates',
  'historical_term_deposit_rates',
]

function isAllowedTable(name: string): name is TableName {
  return ADMIN_DB_TABLES.includes(name as TableName)
}

function isRateTableReadOnly(tableName: TableName): boolean {
  return RATE_TABLES_READ_ONLY.includes(tableName)
}

/** Key columns for each table (for UPDATE/DELETE and get-by-key). */
const TABLE_KEY_COLUMNS: Record<TableName, string[]> = {
  historical_loan_rates: [
    'bank_name',
    'collection_date',
    'product_id',
    'lvr_tier',
    'rate_structure',
    'security_purpose',
    'repayment_type',
    'run_source',
  ],
  historical_savings_rates: [
    'bank_name',
    'collection_date',
    'product_id',
    'rate_type',
    'deposit_tier',
    'run_source',
  ],
  historical_term_deposit_rates: [
    'bank_name',
    'collection_date',
    'product_id',
    'term_months',
    'deposit_tier',
    'run_source',
  ],
  raw_payloads: ['id'],
  run_reports: ['run_id'],
  lender_endpoint_cache: ['lender_code'],
  brand_normalization_map: ['id'],
  backfill_cursors: ['cursor_key'],
  auto_backfill_progress: ['lender_code'],
  client_historical_runs: ['run_id'],
  client_historical_tasks: ['task_id'],
  client_historical_batches: ['batch_id'],
  rba_cash_rates: ['collection_date'],
  global_log: ['id'],
}

export const adminDbRoutes = new Hono<AppContext>()

/** GET /admin/db/tables - list allowlisted tables with optional row counts */
adminDbRoutes.get('/db/tables', async (c) => {
  const db = c.env.DB
  const withCounts = c.req.query('counts') === 'true'
  const tables: { name: string; count?: number }[] = []

  for (const name of ADMIN_DB_TABLES) {
    if (!withCounts) {
      tables.push({ name })
      continue
    }
    try {
      const r = await db.prepare(`SELECT count(*) as n FROM ${name}`).first<{ n: number }>()
      tables.push({ name, count: r?.n ?? 0 })
    } catch {
      tables.push({ name, count: 0 })
    }
  }

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode ?? null,
    tables,
  })
})

/** GET /admin/db/tables/:tableName/schema - column info + key columns */
adminDbRoutes.get('/db/tables/:tableName/schema', async (c) => {
  const tableName = c.req.param('tableName')
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, 'BAD_REQUEST', `Table not allowed: ${tableName}`)
  }

  const db = c.env.DB
  const pragma = await db.prepare(`PRAGMA table_info(${tableName})`).all()
  const results = (pragma.results ?? []) as Array<{
    cid: number
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
  }>

  const columns = results.map((r) => ({
    name: r.name,
    type: r.type || 'TEXT',
    notnull: r.notnull === 1,
    pk: r.pk === 1,
    dflt_value: r.dflt_value ?? undefined,
  }))

  const keyCols = TABLE_KEY_COLUMNS[tableName]
  const hasAutoPk =
    columns.some((col) => col.name === 'id' && col.pk) && keyCols.length === 1 && keyCols[0] === 'id'

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode ?? null,
    table: tableName,
    columns,
    key_columns: keyCols,
    has_auto_increment_pk: hasAutoPk,
  })
})

/** GET /admin/db/tables/:tableName/rows - paginated list */
adminDbRoutes.get('/db/tables/:tableName/rows', async (c) => {
  const tableName = c.req.param('tableName')
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, 'BAD_REQUEST', `Table not allowed: ${tableName}`)
  }

  const limit = Math.min(Math.max(1, Number(c.req.query('limit')) || 50), 500)
  const offset = Math.max(0, Number(c.req.query('offset')) || 0)
  const sortCol = (c.req.query('sort') || '').trim() || null
  const sortDir = (c.req.query('dir') || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC'

  const db = c.env.DB
  const pragma = await db.prepare(`PRAGMA table_info(${tableName})`).all()
  const colNames = ((pragma.results ?? []) as Array<{ name: string }>).map((r) => r.name)
  const orderCol = sortCol && colNames.includes(sortCol) ? sortCol : colNames[0] ?? '1'
  const orderBy = `ORDER BY ${orderCol} ${sortDir}`

  const countResult = await db.prepare(`SELECT count(*) as n FROM ${tableName}`).first<{ n: number }>()
  const total = countResult?.n ?? 0

  const rowsStmt = `SELECT * FROM ${tableName} ${orderBy} LIMIT ? OFFSET ?`
  const rowsResult = await db.prepare(rowsStmt).bind(limit, offset).all()
  const rows = (rowsResult.results ?? []) as Record<string, unknown>[]

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode ?? null,
    rows,
    total,
    limit,
    offset,
  })
})

/** POST /admin/db/tables/:tableName/rows/by-key - get single row by key (body: key object) */
adminDbRoutes.post('/db/tables/:tableName/rows/by-key', async (c) => {
  const tableName = c.req.param('tableName')
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, 'BAD_REQUEST', `Table not allowed: ${tableName}`)
  }

  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const keyCols = TABLE_KEY_COLUMNS[tableName]
  const whereParts: string[] = []
  const values: unknown[] = []
  for (const col of keyCols) {
    const v = body[col]
    if (v === undefined || v === null) {
      return jsonError(c, 400, 'BAD_REQUEST', `Missing key column: ${col}`)
    }
    whereParts.push(`${col} = ?`)
    values.push(v)
  }
  const where = whereParts.join(' AND ')
  const db = c.env.DB
  const row = await db
    .prepare(`SELECT * FROM ${tableName} WHERE ${where}`)
    .bind(...values)
    .first<Record<string, unknown>>()

  if (!row) {
    return jsonError(c, 404, 'NOT_FOUND', 'Row not found')
  }
  return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode ?? null, row })
})

/** POST /admin/db/tables/:tableName/rows - insert row */
adminDbRoutes.post('/db/tables/:tableName/rows', async (c) => {
  const tableName = c.req.param('tableName')
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, 'BAD_REQUEST', `Table not allowed: ${tableName}`)
  }
  if (isRateTableReadOnly(tableName as TableName)) {
    return jsonError(
      c,
      400,
      'RATE_TABLE_READ_ONLY',
      'Rate data must be written via the ingest pipeline; admin DB is read/delete only for this table.',
    )
  }

  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const db = c.env.DB
  const pragma = await db.prepare(`PRAGMA table_info(${tableName})`).all()
  const colInfos = (pragma.results ?? []) as Array<{ name: string; pk: number }>
  const colNames = colInfos.map((r) => r.name).filter((n) => body[n] !== undefined)

  if (colNames.length === 0) {
    return jsonError(c, 400, 'BAD_REQUEST', 'No columns provided')
  }

  const placeholders = colNames.map(() => '?').join(', ')
  const cols = colNames.join(', ')
  const values = colNames.map((n) => body[n])

  try {
    await db.prepare(`INSERT INTO ${tableName} (${cols}) VALUES (${placeholders})`).bind(...values).run()
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    return jsonError(c, 400, 'CONSTRAINT_VIOLATION', msg, { details: msg })
  }

  const keyCols = TABLE_KEY_COLUMNS[tableName]
  if (keyCols.length === 1 && body[keyCols[0]] !== undefined) {
    const keyVal = body[keyCols[0]]
    const row = await db
      .prepare(`SELECT * FROM ${tableName} WHERE ${keyCols[0]} = ?`)
      .bind(keyVal)
      .first<Record<string, unknown>>()
    return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode ?? null, row: row ?? body })
  }
  return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode ?? null, row: body })
})

/** PUT /admin/db/tables/:tableName/rows - update row (body must include key columns + updated fields) */
adminDbRoutes.put('/db/tables/:tableName/rows', async (c) => {
  const tableName = c.req.param('tableName')
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, 'BAD_REQUEST', `Table not allowed: ${tableName}`)
  }
  if (isRateTableReadOnly(tableName as TableName)) {
    return jsonError(
      c,
      400,
      'RATE_TABLE_READ_ONLY',
      'Rate data must be written via the ingest pipeline; admin DB is read/delete only for this table.',
    )
  }

  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const keyCols = TABLE_KEY_COLUMNS[tableName]
  const db = c.env.DB
  const pragma = await db.prepare(`PRAGMA table_info(${tableName})`).all()
  const allCols = ((pragma.results ?? []) as Array<{ name: string }>).map((r) => r.name)

  const setCols = allCols.filter((col) => !keyCols.includes(col) && body[col] !== undefined)
  if (setCols.length === 0) {
    return jsonError(c, 400, 'BAD_REQUEST', 'No non-key columns to update')
  }

  const whereParts: string[] = []
  const bindValues: unknown[] = []
  for (const col of keyCols) {
    const v = body[col]
    if (v === undefined || v === null) {
      return jsonError(c, 400, 'BAD_REQUEST', `Missing key column: ${col}`)
    }
    whereParts.push(`${col} = ?`)
    bindValues.push(v)
  }
  const setParts = setCols.map((col) => `${col} = ?`)
  for (const col of setCols) {
    bindValues.push(body[col])
  }
  const setClause = setParts.join(', ')
  const where = whereParts.join(' AND ')

  try {
    const result = await db
      .prepare(`UPDATE ${tableName} SET ${setClause} WHERE ${where}`)
      .bind(...bindValues)
      .run()
    if ((result.meta.changes ?? 0) === 0) {
      return jsonError(c, 404, 'NOT_FOUND', 'No row matched the key')
    }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    return jsonError(c, 400, 'CONSTRAINT_VIOLATION', msg, { details: msg })
  }

  const row = await db
    .prepare(`SELECT * FROM ${tableName} WHERE ${where}`)
    .bind(...keyCols.map((col) => body[col]))
    .first<Record<string, unknown>>()
  return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode ?? null, row: row ?? body })
})

/** DELETE /admin/db/tables/:tableName/rows - delete row (body: key columns only) */
adminDbRoutes.delete('/db/tables/:tableName/rows', async (c) => {
  const tableName = c.req.param('tableName')
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, 'BAD_REQUEST', `Table not allowed: ${tableName}`)
  }

  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const keyCols = TABLE_KEY_COLUMNS[tableName]
  const whereParts: string[] = []
  const values: unknown[] = []
  for (const col of keyCols) {
    const v = body[col]
    if (v === undefined || v === null) {
      return jsonError(c, 400, 'BAD_REQUEST', `Missing key column: ${col}`)
    }
    whereParts.push(`${col} = ?`)
    values.push(v)
  }
  const where = whereParts.join(' AND ')
  const db = c.env.DB
  const result = await db.prepare(`DELETE FROM ${tableName} WHERE ${where}`).bind(...values).run()
  if ((result.meta.changes ?? 0) === 0) {
    return jsonError(c, 404, 'NOT_FOUND', 'No row matched the key')
  }
  return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode ?? null, deleted: true })
})
