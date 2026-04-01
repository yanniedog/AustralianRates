import { spawnSync } from 'node:child_process'
import { createGzip } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createReadStream, createWriteStream } from 'node:fs'

const DEFAULT_DATES = ['2026-03-18', '2026-03-19', '2026-03-20', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01']
const WRANGLER_BIN = path.join(findRepoRoot(process.cwd()), 'node_modules', 'wrangler', 'bin', 'wrangler.js')

type Config = {
  dbName: string
  remote: boolean
  outputDir: string
  dates: string[]
  keepSql: boolean
}

type TableExport = {
  name: string
  sql: string
}

function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir)
  while (true) {
    const packageJsonPath = path.join(current, 'package.json')
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }
      if (pkg.name === 'australianrates') return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('Could not locate repo root.')
}

const repoRoot = findRepoRoot(process.cwd())

function parseArgs(argv: string[]): Config {
  let dbName = 'australianrates_api'
  let remote = false
  let outputDir = path.join(repoRoot, 'workers', 'api', 'test', 'fixtures', 'historical-quality')
  let dates = [...DEFAULT_DATES]
  let keepSql = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--remote') remote = true
    else if (arg === '--keep-sql') keepSql = true
    else if (arg === '--db') dbName = argv[++i] || dbName
    else if (arg.startsWith('--db=')) dbName = arg.split('=', 2)[1] || dbName
    else if (arg === '--output-dir') outputDir = path.resolve(argv[++i] || outputDir)
    else if (arg.startsWith('--output-dir=')) outputDir = path.resolve(arg.split('=', 2)[1] || outputDir)
    else if (arg === '--dates') dates = (argv[++i] || '').split(',').map((v) => v.trim()).filter(Boolean)
    else if (arg.startsWith('--dates=')) dates = (arg.split('=', 2)[1] || '').split(',').map((v) => v.trim()).filter(Boolean)
  }
  return { dbName, remote, outputDir, dates, keepSql }
}

function quoteSqlString(value: unknown): string {
  if (value == null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function dateValuesSql(dates: string[]): string {
  return dates.map((date) => `(${quoteSqlString(date)})`).join(', ')
}

function runWranglerJson(dbName: string, remote: boolean, sql: string): Array<Record<string, unknown>> {
  const args = [WRANGLER_BIN, 'd1', 'execute', dbName]
  if (remote) args.push('--remote')
  args.push('--json', '--command', sql)
  const result = spawnSync(process.execPath, args, {
    cwd: path.join(repoRoot, 'workers', 'api'),
    env: process.env,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 1024 * 1024 * 256,
  })
  if (result.error) throw result.error
  if ((result.status ?? 1) !== 0) throw new Error(result.stderr || result.stdout || `wrangler failed for SQL: ${sql.slice(0, 200)}`)
  const parsed = JSON.parse(result.stdout) as Array<{ results?: Array<Record<string, unknown>> }>
  return parsed[0]?.results ?? []
}

function fetchTableRows(config: Config, table: TableExport): Array<Record<string, unknown>> {
  return runWranglerJson(config.dbName, config.remote, table.sql)
}

function insertSql(tableName: string, row: Record<string, unknown>): string {
  const columns = Object.keys(row)
  return `INSERT OR REPLACE INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map((column) => quoteSqlString(row[column])).join(', ')});`
}

function historicalSliceSql(dates: string, table: string): string {
  return `WITH selected_dates(collection_date) AS (VALUES ${dates}) SELECT * FROM ${table} WHERE collection_date IN (SELECT collection_date FROM selected_dates) ORDER BY collection_date, bank_name, product_id;`
}

function selectedProductsSql(dates: string): string {
  return `WITH selected_dates(collection_date) AS (VALUES ${dates}), selected_products AS (
    SELECT DISTINCT 'home_loans' AS dataset_kind, bank_name, product_id FROM historical_loan_rates WHERE collection_date IN (SELECT collection_date FROM selected_dates)
    UNION
    SELECT DISTINCT 'savings', bank_name, product_id FROM historical_savings_rates WHERE collection_date IN (SELECT collection_date FROM selected_dates)
    UNION
    SELECT DISTINCT 'term_deposits', bank_name, product_id FROM historical_term_deposit_rates WHERE collection_date IN (SELECT collection_date FROM selected_dates)
  ) `
}

function selectedSeriesSql(dates: string): string {
  return `WITH selected_dates(collection_date) AS (VALUES ${dates}), selected_series AS (
    SELECT DISTINCT 'home_loans' AS dataset_kind, bank_name, product_id, series_key FROM historical_loan_rates WHERE collection_date IN (SELECT collection_date FROM selected_dates)
    UNION
    SELECT DISTINCT 'savings', bank_name, product_id, series_key FROM historical_savings_rates WHERE collection_date IN (SELECT collection_date FROM selected_dates)
    UNION
    SELECT DISTINCT 'term_deposits', bank_name, product_id, series_key FROM historical_term_deposit_rates WHERE collection_date IN (SELECT collection_date FROM selected_dates)
  ) `
}

function buildTableExports(dates: string[]): TableExport[] {
  const dateValues = dateValuesSql(dates)
  return [
    { name: 'product_catalog', sql: `${selectedProductsSql(dateValues)}SELECT pc.* FROM product_catalog pc JOIN selected_products sp ON sp.dataset_kind = pc.dataset_kind AND sp.bank_name = pc.bank_name AND sp.product_id = pc.product_id ORDER BY pc.dataset_kind, pc.bank_name, pc.product_id;` },
    { name: 'series_catalog', sql: `${selectedSeriesSql(dateValues)}SELECT sc.* FROM series_catalog sc JOIN selected_series ss ON ss.dataset_kind = sc.dataset_kind AND ss.series_key = sc.series_key ORDER BY sc.dataset_kind, sc.series_key;` },
    { name: 'product_presence_status', sql: `${selectedProductsSql(dateValues)}SELECT ps.* FROM product_presence_status ps JOIN selected_products sp ON sp.dataset_kind = ps.section AND sp.bank_name = ps.bank_name AND sp.product_id = ps.product_id ORDER BY ps.section, ps.bank_name, ps.product_id;` },
    { name: 'series_presence_status', sql: `${selectedSeriesSql(dateValues)}SELECT sps.* FROM series_presence_status sps JOIN selected_series ss ON ss.dataset_kind = sps.dataset_kind AND ss.series_key = sps.series_key ORDER BY sps.dataset_kind, sps.series_key;` },
    { name: 'raw_objects', sql: `WITH selected_dates(collection_date) AS (VALUES ${dateValues}) SELECT ro.* FROM raw_objects ro JOIN fetch_events fe ON fe.content_hash = ro.content_hash WHERE fe.collection_date IN (SELECT collection_date FROM selected_dates) GROUP BY ro.content_hash ORDER BY ro.content_hash;` },
    { name: 'fetch_events', sql: `WITH selected_dates(collection_date) AS (VALUES ${dateValues}) SELECT * FROM fetch_events WHERE collection_date IN (SELECT collection_date FROM selected_dates) ORDER BY collection_date, id;` },
    { name: 'historical_loan_rates', sql: historicalSliceSql(dateValues, 'historical_loan_rates') },
    { name: 'historical_savings_rates', sql: historicalSliceSql(dateValues, 'historical_savings_rates') },
    { name: 'historical_term_deposit_rates', sql: historicalSliceSql(dateValues, 'historical_term_deposit_rates') },
    { name: 'lender_dataset_runs', sql: `WITH selected_dates(collection_date) AS (VALUES ${dateValues}) SELECT * FROM lender_dataset_runs WHERE collection_date IN (SELECT collection_date FROM selected_dates) ORDER BY collection_date, dataset_kind, lender_code;` },
    { name: 'historical_provenance_status', sql: `${selectedSeriesSql(dateValues)}SELECT hps.* FROM historical_provenance_status hps JOIN selected_series ss ON ss.dataset_kind = hps.dataset_kind AND ss.series_key = hps.series_key WHERE hps.collection_date IN (SELECT collection_date FROM selected_dates) ORDER BY hps.dataset_kind, hps.collection_date, hps.series_key;` },
    { name: 'rba_cash_rates', sql: `SELECT * FROM rba_cash_rates WHERE effective_date <= ${quoteSqlString(dates[dates.length - 1])} ORDER BY effective_date;` },
  ]
}

async function gzipFile(sourcePath: string, targetPath: string): Promise<void> {
  await pipeline(createReadStream(sourcePath), createGzip({ level: 9 }), createWriteStream(targetPath))
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2))
  await mkdir(config.outputDir, { recursive: true })
  const baseName = `production-slice-${config.dates[0].replaceAll('-', '')}-${config.dates[config.dates.length - 1].replaceAll('-', '')}`
  const sqlPath = path.join(config.outputDir, `${baseName}.sql`)
  const gzipPath = `${sqlPath}.gz`
  const manifestPath = path.join(config.outputDir, `${baseName}.manifest.json`)
  const modulePath = path.join(config.outputDir, `${baseName}.fixture.ts`)
  const tableExports = buildTableExports(config.dates)
  const rowCounts: Record<string, number> = {}
  const sqlChunks = ['-- Historical quality integration fixture', '-- Real production data only']

  for (const table of tableExports) {
    const rows = fetchTableRows(config, table)
    rowCounts[table.name] = rows.length
    sqlChunks.push(`-- ${table.name}: ${rows.length} rows`)
    for (const row of rows) sqlChunks.push(insertSql(table.name, row))
  }

  writeFileSync(sqlPath, `${sqlChunks.join('\n')}\n`, 'utf8')
  await gzipFile(sqlPath, gzipPath)
  if (!config.keepSql) await unlink(sqlPath)
  const compressedSize = (await stat(gzipPath)).size
  const gzipBase64 = readFileSync(gzipPath).toString('base64')
  const gzipChunks = gzipBase64.match(/.{1,120}/g) ?? []
  writeFileSync(
    modulePath,
    `export const gzipBase64 = [\n${gzipChunks.map((chunk) => `  '${chunk}'`).join(',\n')}\n].join('');\n`,
    'utf8',
  )
  const manifest = {
    source_db: config.dbName,
    remote: config.remote,
    generated_at: new Date().toISOString(),
    selected_dates: config.dates,
    start_date: config.dates[0],
    end_date: config.dates[config.dates.length - 1],
    schema_version: '0046_historical_quality_scores_view',
    generation_command: `node scripts/export-historical-quality-fixture.js --db ${config.dbName}${config.remote ? ' --remote' : ''} --dates ${config.dates.join(',')}`,
    gzip_file_name: path.basename(gzipPath),
    fixture_module_file_name: path.basename(modulePath),
    sql_file_name: config.keepSql ? path.basename(sqlPath) : null,
    source_sql_retained: config.keepSql,
    row_counts: rowCounts,
    compressed_bytes: compressedSize,
  }
  mkdirSync(path.dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  process.stdout.write(`Fixture SQL: ${sqlPath}\n`)
  process.stdout.write(`Fixture gzip: ${gzipPath}\n`)
  process.stdout.write(`Manifest: ${manifestPath}\n`)
  process.stdout.write(`Row counts: ${JSON.stringify(rowCounts)}\n`)
}

void main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`)
  process.exitCode = 1
})
