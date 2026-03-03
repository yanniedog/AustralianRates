import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'

const ROW_SIZE_LIMIT_BYTES = 2_000_000
const DEFAULT_BATCH_SIZE = 100

const TARGET_TABLES = [
  'historical_loan_rates',
  'historical_savings_rates',
  'historical_term_deposit_rates',
  'latest_home_loan_series',
  'latest_savings_series',
  'latest_td_series',
] as const

type TargetTable = (typeof TARGET_TABLES)[number]

type ParsedConfig = {
  db: string
  remote: boolean
  batchSize: number
  maxBatches: number | null
  table: TargetTable | null
  dryRun: boolean
}

type PendingRow = {
  rowid: number
  cdr_product_detail_json: string
}

type BatchBuildResult = {
  statements: string[]
  rowCount: number
  uniquePayloadCount: number
}

function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir)
  while (true) {
    const packageJsonPath = path.join(current, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string }
        if (pkg.name === 'australianrates') {
          return current
        }
      } catch {
        // Keep walking up.
      }
    }

    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  throw new Error('Could not locate repo root. Run this script from inside the australianrates repository.')
}

const repoRoot = findRepoRoot(process.cwd())

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.floor(parsed))
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: ${value}`)
  }
  return Math.max(1, Math.floor(parsed))
}

function parseConfig(argv: string[]): ParsedConfig {
  let db = 'australianrates_api'
  let remote = false
  let batchSize = DEFAULT_BATCH_SIZE
  let maxBatches: number | null = null
  let table: TargetTable | null = null
  let dryRun = false

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--remote') {
      remote = true
      continue
    }
    if (token === '--dry-run') {
      dryRun = true
      continue
    }
    if (token === '--db' || token === '--database') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`)
      db = value.trim()
      i += 1
      continue
    }
    if (token.startsWith('--db=')) {
      db = token.split('=', 2)[1]?.trim() || db
      continue
    }
    if (token.startsWith('--database=')) {
      db = token.split('=', 2)[1]?.trim() || db
      continue
    }
    if (token === '--batch-size') {
      batchSize = parseNumber(argv[i + 1], DEFAULT_BATCH_SIZE)
      i += 1
      continue
    }
    if (token.startsWith('--batch-size=')) {
      batchSize = parseNumber(token.split('=', 2)[1], DEFAULT_BATCH_SIZE)
      continue
    }
    if (token === '--max-batches') {
      maxBatches = parseOptionalNumber(argv[i + 1])
      i += 1
      continue
    }
    if (token.startsWith('--max-batches=')) {
      maxBatches = parseOptionalNumber(token.split('=', 2)[1])
      continue
    }
    if (token === '--table') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error('--table requires a value')
      if (!TARGET_TABLES.includes(value as TargetTable)) {
        throw new Error(`Unsupported table: ${value}`)
      }
      table = value as TargetTable
      i += 1
      continue
    }
    if (token.startsWith('--table=')) {
      const value = token.split('=', 2)[1] || ''
      if (!TARGET_TABLES.includes(value as TargetTable)) {
        throw new Error(`Unsupported table: ${value}`)
      }
      table = value as TargetTable
      continue
    }
    throw new Error(`Unknown option: ${token}`)
  }

  if (!db) throw new Error('Missing --db value')

  return {
    db,
    remote,
    batchSize,
    maxBatches,
    table,
    dryRun,
  }
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function buildBackfillSql(table: TargetTable, rows: PendingRow[]): BatchBuildResult {
  const payloads = new Map<string, { hex: string; uncompressedBytes: number; compressedBytes: number }>()
  const updates: Array<{ rowid: number; hash: string }> = []

  for (const row of rows) {
    const json = row.cdr_product_detail_json
    const hash = crypto.createHash('sha256').update(json).digest('hex')
    if (!payloads.has(hash)) {
      const compressed = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 })
      if (compressed.byteLength > ROW_SIZE_LIMIT_BYTES) {
        throw new Error(
          `Compressed payload exceeds D1 row limit table=${table} rowid=${row.rowid} hash=${hash} bytes=${compressed.byteLength}`,
        )
      }
      payloads.set(hash, {
        hex: compressed.toString('hex'),
        uncompressedBytes: Buffer.byteLength(json, 'utf8'),
        compressedBytes: compressed.byteLength,
      })
    }
    updates.push({ rowid: row.rowid, hash })
  }

  const statements: string[] = ['BEGIN;']
  for (const [hash, payload] of payloads) {
    statements.push(
      `INSERT OR IGNORE INTO cdr_detail_payload_store (payload_hash, encoding, payload_blob, uncompressed_bytes, compressed_bytes) VALUES (${sqlString(hash)}, 'gzip', X'${payload.hex}', ${payload.uncompressedBytes}, ${payload.compressedBytes});`,
    )
  }
  for (const update of updates) {
    statements.push(
      `UPDATE ${table} SET cdr_product_detail_hash = ${sqlString(update.hash)} WHERE rowid = ${update.rowid} AND cdr_product_detail_hash IS NULL;`,
    )
  }
  statements.push('COMMIT;')

  return {
    statements,
    rowCount: updates.length,
    uniquePayloadCount: payloads.size,
  }
}

function extractJsonPayload(rawStdout: string): unknown {
  const trimmed = String(rawStdout || '').trim()
  if (!trimmed) throw new Error('Wrangler returned empty stdout')

  try {
    return JSON.parse(trimmed)
  } catch {
    // fall through
  }

  const starts = [trimmed.indexOf('['), trimmed.indexOf('{')].filter((v) => v >= 0).sort((a, b) => a - b)
  for (const start of starts) {
    const candidate = trimmed.slice(start).trim()
    try {
      return JSON.parse(candidate)
    } catch {
      // continue
    }
    const closeIndex = candidate.startsWith('[') ? candidate.lastIndexOf(']') : candidate.lastIndexOf('}')
    if (closeIndex > 0) {
      const bounded = candidate.slice(0, closeIndex + 1)
      try {
        return JSON.parse(bounded)
      } catch {
        // continue
      }
    }
  }

  throw new Error(`Failed to parse wrangler JSON output: ${trimmed.slice(0, 500)}`)
}

function wranglerExecuteJson(db: string, remote: boolean, sql: string): Array<Record<string, unknown>> {
  const tempFile = path.join(os.tmpdir(), `ar-backfill-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`)
  fs.writeFileSync(tempFile, `${sql}\n`, 'utf8')

  try {
    const args = ['wrangler', 'd1', 'execute', db]
    if (remote) args.push('--remote')
    args.push('--file', tempFile, '--json')

    const run = spawnSync('npx', args, {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })

    if ((run.status ?? 1) !== 0) {
      throw new Error(
        [
          `wrangler exited with code ${run.status}`,
          `command: npx ${args.join(' ')}`,
          `stdout: ${(run.stdout || '').slice(0, 2000)}`,
          `stderr: ${(run.stderr || '').slice(0, 2000)}`,
        ].join('\n'),
      )
    }

    const payload = extractJsonPayload(run.stdout || '') as Array<Record<string, unknown>>
    const first = Array.isArray(payload) ? payload[0] : null
    const results = first && Array.isArray(first.results) ? first.results : []
    return results.map((row) => (typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {}))
  } finally {
    try {
      fs.unlinkSync(tempFile)
    } catch {
      // best effort
    }
  }
}

function toPendingRows(rows: Array<Record<string, unknown>>): PendingRow[] {
  const out: PendingRow[] = []
  for (const row of rows) {
    const rowid = Number(row.rowid)
    const json = row.cdr_product_detail_json
    if (!Number.isFinite(rowid) || typeof json !== 'string' || json.length === 0) continue
    out.push({
      rowid: Math.floor(rowid),
      cdr_product_detail_json: json,
    })
  }
  return out
}

function pendingRowsSql(table: TargetTable, limit: number): string {
  return `
SELECT rowid, cdr_product_detail_json
FROM ${table}
WHERE cdr_product_detail_hash IS NULL
  AND cdr_product_detail_json IS NOT NULL
  AND TRIM(cdr_product_detail_json) != ''
ORDER BY rowid ASC
LIMIT ${limit};
`.trim()
}

function remainingRowsSql(table: TargetTable): string {
  return `
SELECT COUNT(*) AS pending_rows
FROM ${table}
WHERE cdr_product_detail_hash IS NULL
  AND cdr_product_detail_json IS NOT NULL
  AND TRIM(cdr_product_detail_json) != '';
`.trim()
}

function readPendingCount(db: string, remote: boolean, table: TargetTable): number {
  const rows = wranglerExecuteJson(db, remote, remainingRowsSql(table))
  const count = Number(rows[0]?.pending_rows ?? 0)
  return Number.isFinite(count) ? count : 0
}

export function runBackfillCdrDetailHash(args: string[]): number {
  const config = parseConfig(args)
  const tables = config.table ? [config.table] : [...TARGET_TABLES]
  let grandTotalRows = 0
  let grandTotalPayloads = 0

  for (const table of tables) {
    const initialPending = readPendingCount(config.db, config.remote, table)
    process.stdout.write(`[backfill-cdr-detail-hash] table=${table} pending_before=${initialPending}\n`)
    if (initialPending === 0) continue
    if (config.dryRun) continue

    let processedBatches = 0
    let processedRows = 0
    let processedPayloads = 0

    while (true) {
      if (config.maxBatches != null && processedBatches >= config.maxBatches) {
        process.stdout.write(`[backfill-cdr-detail-hash] table=${table} stopped=max_batches batches=${processedBatches}\n`)
        break
      }

      const rawRows = wranglerExecuteJson(config.db, config.remote, pendingRowsSql(table, config.batchSize))
      const pendingRows = toPendingRows(rawRows)
      if (pendingRows.length === 0) break

      const batch = buildBackfillSql(table, pendingRows)
      wranglerExecuteJson(config.db, config.remote, batch.statements.join('\n'))

      processedBatches += 1
      processedRows += batch.rowCount
      processedPayloads += batch.uniquePayloadCount
      process.stdout.write(
        `[backfill-cdr-detail-hash] table=${table} batch=${processedBatches} rows=${batch.rowCount} unique_payloads=${batch.uniquePayloadCount}\n`,
      )
    }

    const pendingAfter = readPendingCount(config.db, config.remote, table)
    process.stdout.write(
      `[backfill-cdr-detail-hash] table=${table} rows_written=${processedRows} payload_inserts_attempted=${processedPayloads} pending_after=${pendingAfter}\n`,
    )
    grandTotalRows += processedRows
    grandTotalPayloads += processedPayloads
  }

  process.stdout.write(
    `[backfill-cdr-detail-hash] done rows_written=${grandTotalRows} payload_inserts_attempted=${grandTotalPayloads}\n`,
  )
  return 0
}

export function main(args: string[]): void {
  try {
    process.exitCode = runBackfillCdrDetailHash(args)
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    process.exitCode = 1
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2))
}
