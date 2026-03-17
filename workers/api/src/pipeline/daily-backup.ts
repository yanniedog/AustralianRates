/**
 * Daily database backup: exports one day's data (by collection_date or date part of
 * datetime columns) as a single gzipped SQL file to R2. Allows instant download and
 * later reconstruction by applying daily backups in order (INSERT OR REPLACE).
 */

import { listDatabaseDumpTables } from '../routes/admin-download-dump'
import { quoteSqlIdentifier, readTableColumns } from '../routes/admin-download-schema'
import { gzipCompressText } from '../utils/compression'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'

const INSERT_ROWS_PER_STATEMENT = 50

/** Tables included in daily backup and the column used to filter to one day. */
const DAILY_TABLE_DATE_COLUMNS: Record<string, { column: string; isDateOnly: boolean }> = {
  historical_loan_rates: { column: 'collection_date', isDateOnly: true },
  historical_savings_rates: { column: 'collection_date', isDateOnly: true },
  historical_term_deposit_rates: { column: 'collection_date', isDateOnly: true },
  rba_cash_rates: { column: 'collection_date', isDateOnly: true },
  lender_dataset_runs: { column: 'collection_date', isDateOnly: true },
  run_seen_products: { column: 'collection_date', isDateOnly: true },
  run_seen_series: { column: 'collection_date', isDateOnly: true },
  home_loan_rate_events: { column: 'collection_date', isDateOnly: true },
  savings_rate_events: { column: 'collection_date', isDateOnly: true },
  td_rate_events: { column: 'collection_date', isDateOnly: true },
  client_historical_tasks: { column: 'collection_date', isDateOnly: true },
  client_historical_batches: { column: 'collection_date', isDateOnly: true },
  ingest_replay_queue: { column: 'collection_date', isDateOnly: true },
  ingest_anomalies: { column: 'collection_date', isDateOnly: true },
  run_reports: { column: 'started_at', isDateOnly: false },
  fetch_events: { column: 'fetched_at', isDateOnly: false },
  raw_payloads: { column: 'fetched_at', isDateOnly: false },
  lender_endpoint_cache: { column: 'fetched_at', isDateOnly: false },
  admin_download_jobs: { column: 'requested_at', isDateOnly: false },
  admin_download_artifacts: { column: 'created_at', isDateOnly: false },
  backfill_cursors: { column: 'updated_at', isDateOnly: false },
  brand_normalization_map: { column: 'updated_at', isDateOnly: false },
  client_historical_runs: { column: 'started_at', isDateOnly: false },
  export_jobs: { column: 'started_at', isDateOnly: false },
}

const R2_PREFIX = 'daily-backup'
export const DAILY_BACKUP_FILENAME = (date: string) => `australianrates-daily-${date}.sql.gz`
export const dailyBackupR2Key = (date: string) => `${R2_PREFIX}/${date}/${DAILY_BACKUP_FILENAME(date)}`

function sqlComment(value: string): string {
  return `-- ${String(value || '').trim()}`
}

function serializeSqlValue(value: unknown): string {
  if (value == null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value)
    return `X'${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}'`
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    return `X'${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}'`
  }
  return `'${String(value).replace(/'/g, "''")}'`
}

function buildInsertStatements(
  tableName: string,
  columnNames: string[],
  rows: Array<Record<string, unknown>>,
): string[] {
  if (!rows.length || !columnNames.length) return []
  const tableSql = quoteSqlIdentifier(tableName)
  const columnsSql = columnNames.map((c) => quoteSqlIdentifier(c)).join(', ')
  const statements: string[] = []
  for (let i = 0; i < rows.length; i += INSERT_ROWS_PER_STATEMENT) {
    const batch = rows.slice(i, i + INSERT_ROWS_PER_STATEMENT)
    const valuesSql = batch
      .map((row) => `(${columnNames.map((col) => serializeSqlValue(row[col])).join(', ')})`)
      .join(',\n')
    statements.push(`INSERT OR REPLACE INTO ${tableSql} (${columnsSql}) VALUES\n${valuesSql};`)
  }
  return statements
}

function dayWhereClause(
  tableName: string,
  date: string,
): { sql: string; bind: (string | number)[] } {
  const meta = DAILY_TABLE_DATE_COLUMNS[tableName]
  if (!meta || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { sql: '', bind: [] }
  }
  const col = quoteSqlIdentifier(meta.column)
  if (meta.isDateOnly) {
    return { sql: `WHERE ${col} = ?1`, bind: [date] }
  }
  return { sql: `WHERE strftime('%Y-%m-%d', ${col}) = ?1`, bind: [date] }
}

export type DailyBackupResult = {
  ok: boolean
  date: string
  r2_key: string
  byte_size: number
  table_counts: Record<string, number>
  error?: string
}

/**
 * Build and upload the daily backup for the given date (YYYY-MM-DD).
 * Writes a single gzipped SQL file to R2; use INSERT OR REPLACE for reconstruction.
 */
export async function runDailyBackup(
  env: EnvBindings,
  date: string,
): Promise<DailyBackupResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {
      ok: false,
      date,
      r2_key: '',
      byte_size: 0,
      table_counts: {},
      error: 'Invalid date; use YYYY-MM-DD',
    }
  }

  const db = env.DB
  const allTables = await listDatabaseDumpTables(db)
  const tablesToExport = allTables.filter((t) => DAILY_TABLE_DATE_COLUMNS[t])
  const lines: string[] = [
    sqlComment('AustralianRates daily database backup'),
    sqlComment(`Date ${date}; one day of data only. Apply with INSERT OR REPLACE for reconstruction.`),
    sqlComment(`Generated at ${new Date().toISOString()}`),
    'PRAGMA foreign_keys = OFF;',
  ]

  const tableCounts: Record<string, number> = {}

  for (const tableName of tablesToExport) {
    const where = dayWhereClause(tableName, date)
    if (!where.sql) continue

    let rows: Array<Record<string, unknown>>
    try {
      const result = await db
        .prepare(`SELECT * FROM ${quoteSqlIdentifier(tableName)} ${where.sql}`)
        .bind(...where.bind)
        .all<Record<string, unknown>>()
      rows = result.results ?? []
    } catch (error) {
      log.warn('daily-backup', `Skip table ${tableName} (read error)`, {
        code: 'daily_backup_table_skip',
        error: (error as Error)?.message,
      })
      continue
    }

    tableCounts[tableName] = rows.length
    if (rows.length === 0) {
      lines.push(sqlComment(`${tableName}: 0 rows`))
      continue
    }

    const columnNames = await readTableColumns(db, tableName)
    lines.push(sqlComment(`Table ${tableName} (${rows.length} rows)`))
    lines.push(...buildInsertStatements(tableName, columnNames, rows))
  }

  lines.push('PRAGMA foreign_keys = ON;')
  lines.push(sqlComment(`End daily backup ${date}`))

  const sqlText = lines.join('\n')
  const compressed = await gzipCompressText(sqlText)
  const r2Key = dailyBackupR2Key(date)

  await env.RAW_BUCKET.put(r2Key, compressed, {
    httpMetadata: { contentType: 'application/gzip' },
    customMetadata: {
      daily_backup_date: date,
      generated_at: new Date().toISOString(),
      table_counts: JSON.stringify(tableCounts),
    },
  })

  log.info('daily-backup', 'Daily backup written', {
    code: 'daily_backup_written',
    context: JSON.stringify({ date, r2_key: r2Key, byte_size: compressed.byteLength, table_counts: tableCounts }),
  })

  return {
    ok: true,
    date,
    r2_key: r2Key,
    byte_size: compressed.byteLength,
    table_counts: tableCounts,
  }
}
