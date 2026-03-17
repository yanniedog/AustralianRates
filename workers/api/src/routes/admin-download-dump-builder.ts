import { listAdminDownloadArtifacts, requeueAdminDownloadJob, type AdminDownloadArtifactRow, type AdminDownloadJobRow } from '../db/admin-download-jobs'
import { type AdminDownloadEnv, writeAdminDownloadArtifact } from './admin-download-artifact-writer'
import {
  DATABASE_DUMP_PARTS_PER_PASS,
  DATABASE_DUMP_ROW_BATCH_SIZE,
  databaseDumpArtifactR2Key,
  databaseDumpDataFileName,
  databaseDumpFooterFileName,
  databaseDumpHeaderFileName,
  databaseDumpIndexesFileName,
  databaseDumpProgressByTable,
  databaseDumpSchemaFileName,
  databaseDumpTriggersFileName,
  databaseDumpViewsFileName,
  isDatabaseDumpInternalTable,
  isProtectedDatabaseDumpTableError,
  listDatabaseDumpTables,
} from './admin-download-dump'
import { quoteSqlIdentifier, readDatabaseSchema, readTableColumns, type DatabaseSchema, type SchemaObject } from './admin-download-schema'

const INSERT_ROWS_PER_STATEMENT = 50

/** Tables that are filtered by a date column for monthly dumps; others are dumped in full for that month. */
const MONTHLY_TABLE_DATE_COLUMNS: Record<string, string> = {
  historical_loan_rates: 'collection_date',
  historical_savings_rates: 'collection_date',
  historical_term_deposit_rates: 'collection_date',
  home_loan_rate_events: 'collection_date',
  savings_rate_events: 'collection_date',
  td_rate_events: 'collection_date',
  home_loan_rate_intervals: 'effective_from_collection_date',
  savings_rate_intervals: 'effective_from_collection_date',
  td_rate_intervals: 'effective_from_collection_date',
  raw_payloads: 'fetched_at',
  run_reports: 'started_at',
  lender_endpoint_cache: 'fetched_at',
  product_catalog: 'last_seen_collection_date',
  series_catalog: 'last_seen_collection_date',
  series_presence_status: 'last_seen_collection_date',
  run_seen_products: 'collection_date',
  run_seen_series: 'collection_date',
  fetch_events: 'fetched_at',
  lender_dataset_runs: 'collection_date',
  rba_cash_rates: 'collection_date',
  backfill_cursors: 'updated_at',
  brand_normalization_map: 'updated_at',
  client_historical_runs: 'started_at',
  client_historical_tasks: 'collection_date',
  client_historical_batches: 'collection_date',
  admin_download_jobs: 'requested_at',
  admin_download_artifacts: 'created_at',
  download_change_feed: 'emitted_at',
  export_jobs: 'started_at',
  product_presence_status: 'last_seen_collection_date',
  analytics_projection_state: 'last_collection_date',
  ingest_replay_queue: 'collection_date',
  ingest_anomalies: 'collection_date',
}

function monthBounds(monthIso: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}$/.test(monthIso)) {
    return { start: '0000-01-01', end: '9999-12-32' }
  }
  const [y, m] = monthIso.split('-').map(Number)
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`
  const nextMonth = m === 12 ? [y + 1, 1] : [y, m + 1]
  const end = `${String(nextMonth[0]).padStart(4, '0')}-${String(nextMonth[1]).padStart(2, '0')}-01`
  return { start, end }
}

function sqlComment(value: string): string {
  return `-- ${String(value || '').trim()}`
}

function withTrailingSemicolon(sql: string): string {
  const normalized = String(sql || '').trim()
  if (!normalized) return ''
  return normalized.endsWith(';') ? normalized : `${normalized};`
}

function hexLiteral(bytes: Uint8Array): string {
  return `X'${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}'`
}

function serializeSqlValue(value: unknown): string {
  if (value == null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof ArrayBuffer) return hexLiteral(new Uint8Array(value))
  if (ArrayBuffer.isView(value)) {
    return hexLiteral(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  }
  return `'${String(value).replace(/'/g, "''")}'`
}

function buildInsertStatements(
  tableName: string,
  columnNames: string[],
  rows: Array<Record<string, unknown>>,
  useReplace = false,
): string[] {
  if (!rows.length || !columnNames.length) return []

  const tableSql = quoteSqlIdentifier(tableName)
  const columnsSql = columnNames.map((columnName) => quoteSqlIdentifier(columnName)).join(', ')
  const insertKw = useReplace ? 'INSERT OR REPLACE INTO' : 'INSERT INTO'
  const statements: string[] = []

  for (let index = 0; index < rows.length; index += INSERT_ROWS_PER_STATEMENT) {
    const batch = rows.slice(index, index + INSERT_ROWS_PER_STATEMENT)
    const valuesSql = batch
      .map((row) => `(${columnNames.map((columnName) => serializeSqlValue(row[columnName])).join(', ')})`)
      .join(',\n')
    statements.push(`${insertKw} ${tableSql} (${columnsSql}) VALUES\n${valuesSql};`)
  }

  return statements
}

function dropStatements(schema: DatabaseSchema): string[] {
  const statements: string[] = []
  for (const view of schema.views) {
    statements.push(`DROP VIEW IF EXISTS ${quoteSqlIdentifier(view.name)};`)
  }
  for (const trigger of schema.triggers) {
    statements.push(`DROP TRIGGER IF EXISTS ${quoteSqlIdentifier(trigger.name)};`)
  }
  for (const table of [...schema.tables].reverse()) {
    statements.push(`DROP TABLE IF EXISTS ${quoteSqlIdentifier(table.name)};`)
  }
  return statements
}

function headerLines(schema: DatabaseSchema, job: AdminDownloadJobRow): string[] {
  const isMonthly = job.export_kind === 'monthly' && job.month_iso
  const lines = [
    sqlComment(isMonthly ? 'AustralianRates monthly database dump' : 'AustralianRates full database dump'),
    sqlComment(`Generated at ${new Date().toISOString()}`),
    sqlComment(`Job id ${job.job_id}`),
  ]
  if (isMonthly) {
    lines.push(sqlComment(`Month ${job.month_iso}; data filtered by month for time-series tables; use INSERT OR REPLACE so batch import reconstructs DB.`))
  }
  lines.push(
    sqlComment('Restore by decompressing this file to .sql and running wrangler d1 execute --file against the target database.'),
    sqlComment('If you need an exact point-in-time clone, create the dump during a quiet period with writes paused.'),
    'PRAGMA foreign_keys = OFF;',
    ...dropStatements(schema),
  )
  return lines
}

function secondarySchemaLines(label: string, objects: SchemaObject[]): string[] {
  if (!objects.length) {
    return [sqlComment(`No ${label} definitions were present in sqlite_master.`)]
  }
  return objects.map((object) => withTrailingSemicolon(object.sql)).filter(Boolean)
}

function jobScopedWhereClause(
  tableName: string,
  jobId: string,
  monthIso?: string | null,
): { sql: string; bind: string[] } {
  const parts: string[] = []
  const bind: string[] = []
  let paramIndex = 1

  if (tableName === 'admin_download_jobs' || tableName === 'admin_download_artifacts') {
    parts.push(`job_id <> ?${paramIndex}`)
    bind.push(jobId)
    paramIndex += 1
  }

  if (monthIso && /^\d{4}-\d{2}$/.test(monthIso)) {
    const dateCol = MONTHLY_TABLE_DATE_COLUMNS[tableName]
    if (dateCol) {
      const { start, end } = monthBounds(monthIso)
      parts.push(`${quoteSqlIdentifier(dateCol)} >= ?${paramIndex}`)
      bind.push(start)
      paramIndex += 1
      parts.push(`${quoteSqlIdentifier(dateCol)} < ?${paramIndex}`)
      bind.push(end)
    }
  }

  const sql = parts.length ? `WHERE ${parts.join(' AND ')}` : ''
  return { sql, bind }
}

async function readTableRowsChunk(
  db: D1Database,
  job: AdminDownloadJobRow,
  tableName: string,
  limit: number,
  offset: number,
): Promise<Array<Record<string, unknown>>> {
  try {
    const scope = jobScopedWhereClause(tableName, job.job_id, job.month_iso ?? undefined)
    const result = await db
      .prepare(`SELECT * FROM ${quoteSqlIdentifier(tableName)} ${scope.sql} LIMIT ?${scope.bind.length + 1} OFFSET ?${scope.bind.length + 2}`)
      .bind(...scope.bind, limit, offset)
      .all<Record<string, unknown>>()
    return result.results ?? []
  } catch (error) {
    if (isDatabaseDumpInternalTable(tableName) || isProtectedDatabaseDumpTableError(error)) return []
    throw error
  }
}

async function countDumpTableRows(db: D1Database, job: AdminDownloadJobRow, tableName: string): Promise<number> {
  try {
    const scope = jobScopedWhereClause(tableName, job.job_id, job.month_iso ?? undefined)
    const result = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${quoteSqlIdentifier(tableName)} ${scope.sql}`)
      .bind(...scope.bind)
      .first<{ n: number }>()
    return Math.max(0, Number(result?.n ?? 0))
  } catch (error) {
    if (isDatabaseDumpInternalTable(tableName) || isProtectedDatabaseDumpTableError(error)) return 0
    throw error
  }
}

function artifactFileNames(artifacts: AdminDownloadArtifactRow[]): Set<string> {
  return new Set(
    artifacts
      .filter((artifact) => artifact.artifact_kind === 'main')
      .map((artifact) => String(artifact.file_name || '').trim())
      .filter(Boolean),
  )
}

async function writeMainArtifact(
  env: AdminDownloadEnv,
  db: D1Database,
  job: AdminDownloadJobRow,
  input: {
    fileName: string
    lines: string[]
    rowCount: number
    cursorStart?: number | null
    cursorEnd?: number | null
  },
): Promise<void> {
  await writeAdminDownloadArtifact(env, db, job, 'main', input.lines, input.rowCount, input.cursorStart, input.cursorEnd, {
    fileName: input.fileName,
    r2Key: databaseDumpArtifactR2Key(job.job_id, input.fileName),
  })
}

export async function runDatabaseDumpPass(env: AdminDownloadEnv, job: AdminDownloadJobRow): Promise<{ done: boolean }> {
  const db = env.DB
  const tables = await listDatabaseDumpTables(db)
  const schema = await readDatabaseSchema(db)
  const artifacts = await listAdminDownloadArtifacts(db, job.job_id)
  const existingFiles = artifactFileNames(artifacts)
  const tableProgress = databaseDumpProgressByTable(artifacts)
  let partsCreated = 0

  const hitPassLimit = async (): Promise<{ done: false }> => {
    await requeueAdminDownloadJob(db, job.job_id)
    return { done: false }
  }

  const writePart = async (
    fileName: string,
    lines: string[],
    rowCount: number,
    cursorStart?: number | null,
    cursorEnd?: number | null,
  ): Promise<boolean> => {
    await writeMainArtifact(env, db, job, { fileName, lines, rowCount, cursorStart, cursorEnd })
    partsCreated += 1
    return partsCreated >= DATABASE_DUMP_PARTS_PER_PASS
  }

  const headerFile = databaseDumpHeaderFileName()
  if (!existingFiles.has(headerFile)) {
    const shouldPause = await writePart(headerFile, headerLines(schema, job), 0, null, null)
    if (shouldPause) return hitPassLimit()
    existingFiles.add(headerFile)
  }

  for (const tableName of tables) {
    const schemaFile = databaseDumpSchemaFileName(tableName)
    if (existingFiles.has(schemaFile)) continue
    const tableSchema = schema.tables.find((table) => table.name === tableName)
    if (!tableSchema) continue

    const shouldPause = await writePart(
      schemaFile,
      [
        sqlComment(`Schema for table ${tableName}`),
        withTrailingSemicolon(tableSchema.sql),
      ].filter(Boolean),
      0,
      null,
      null,
    )
    if (shouldPause) return hitPassLimit()
    existingFiles.add(schemaFile)
  }

  for (const tableName of tables) {
    let offset = tableProgress.get(tableName) ?? 0
    const totalRows = await countDumpTableRows(db, job, tableName)
    if (offset >= totalRows) continue

    const columnNames = await readTableColumns(db, tableName)
    while (offset < totalRows) {
      const rows = await readTableRowsChunk(db, job, tableName, DATABASE_DUMP_ROW_BATCH_SIZE, offset)
      if (!rows.length) break

      const nextOffset = offset + rows.length
      const fileName = databaseDumpDataFileName(tableName, offset)
      if (!existingFiles.has(fileName)) {
        const useReplace = job.export_kind === 'monthly'
        const shouldPause = await writePart(
          fileName,
          [
            sqlComment(`Data for table ${tableName} rows ${offset} to ${nextOffset}`),
            ...buildInsertStatements(tableName, columnNames, rows, useReplace),
          ],
          rows.length,
          offset,
          nextOffset,
        )
        if (shouldPause) return hitPassLimit()
        existingFiles.add(fileName)
      }

      offset = nextOffset
    }
  }

  const indexesFile = databaseDumpIndexesFileName()
  if (!existingFiles.has(indexesFile)) {
    const shouldPause = await writePart(indexesFile, secondarySchemaLines('index', schema.indexes), 0, null, null)
    if (shouldPause) return hitPassLimit()
    existingFiles.add(indexesFile)
  }

  const triggersFile = databaseDumpTriggersFileName()
  if (!existingFiles.has(triggersFile)) {
    const shouldPause = await writePart(triggersFile, secondarySchemaLines('trigger', schema.triggers), 0, null, null)
    if (shouldPause) return hitPassLimit()
    existingFiles.add(triggersFile)
  }

  const viewsFile = databaseDumpViewsFileName()
  if (!existingFiles.has(viewsFile)) {
    const shouldPause = await writePart(viewsFile, secondarySchemaLines('view', schema.views), 0, null, null)
    if (shouldPause) return hitPassLimit()
    existingFiles.add(viewsFile)
  }

  const footerFile = databaseDumpFooterFileName()
  if (!existingFiles.has(footerFile)) {
    const endComment = job.export_kind === 'monthly' ? 'End of AustralianRates monthly database dump' : 'End of AustralianRates full database dump'
    await writePart(
      footerFile,
      [
        'PRAGMA foreign_keys = ON;',
        sqlComment(endComment),
      ],
      0,
      null,
      null,
    )
  }

  return { done: true }
}
