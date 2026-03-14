import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

const DB_NAME = 'australianrates_api_test'
const TABLES = ['historical_loan_rates', 'historical_savings_rates', 'historical_term_deposit_rates', 'run_reports']

function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir)
  while (true) {
    const packageJsonPath = path.join(current, 'package.json')
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }
        if (pkg.name === 'australianrates') return current
      } catch {
        // Keep walking.
      }
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('Could not locate repo root.')
}

const repoRoot = findRepoRoot(process.cwd())
const apiRoot = path.join(repoRoot, 'workers', 'api')
const LOG_PATH = path.join(repoRoot, '.tmp', 'verify-admin-dump-restore.log')
const WRANGLER_BIN = path.join(repoRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

function readAdminToken(): string {
  const devVarsPath = path.join(apiRoot, '.dev.vars')
  if (!existsSync(devVarsPath)) return 'test-admin-token'
  const match = readFileSync(devVarsPath, 'utf8').match(/^\s*ADMIN_API_TOKEN\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m)
  return match?.[1]?.trim() || 'test-admin-token'
}

const ADMIN_TOKEN = readAdminToken()

function logStep(message: string): void {
  mkdirSync(path.dirname(LOG_PATH), { recursive: true })
  appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`)
}

function quoteIdentifier(value: string): string {
  return `"${String(value || '').replace(/"/g, '""')}"`
}

function sqlValue(value: unknown): string {
  if (value == null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

function insertSql(tableName: string, row: Record<string, unknown>): string {
  const columns = Object.keys(row)
  return `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map((column) => sqlValue(row[column])).join(', ')});`
}

function seriesKey(parts: unknown[]): string {
  return parts.map((part) => String(part)).join('|')
}

function buildSeedSql(): string {
  const home = JSON.parse(readFileSync(path.join(apiRoot, 'test', 'fixtures', 'real-normalized-home-loan-row.json'), 'utf8')) as Record<string, unknown>
  const savings = JSON.parse(readFileSync(path.join(apiRoot, 'test', 'fixtures', 'real-normalized-savings-row.json'), 'utf8')) as Record<string, unknown>
  const td = JSON.parse(readFileSync(path.join(apiRoot, 'test', 'fixtures', 'real-normalized-td-row.json'), 'utf8')) as Record<string, unknown>
  const parsedAt = '2026-03-14T00:00:00.000Z'
  const runId = 'seed-run-1'

  return [
    insertSql('historical_loan_rates', {
      bank_name: home.bankName,
      collection_date: home.collectionDate,
      product_id: home.productId,
      product_name: home.productName,
      security_purpose: home.securityPurpose,
      repayment_type: home.repaymentType,
      rate_structure: home.rateStructure,
      lvr_tier: home.lvrTier,
      feature_set: home.featureSet,
      interest_rate: home.interestRate,
      comparison_rate: home.comparisonRate,
      annual_fee: home.annualFee,
      source_url: home.sourceUrl,
      data_quality_flag: home.dataQualityFlag,
      confidence_score: home.confidenceScore,
      parsed_at: parsedAt,
      run_id: runId,
      run_source: 'scheduled',
      retrieval_type: 'present_scrape_same_date',
      product_url: home.sourceUrl,
      published_at: null,
      product_code: home.productId,
      series_key: seriesKey([
        home.bankName,
        home.productId,
        home.securityPurpose,
        home.repaymentType,
        home.lvrTier,
        home.rateStructure,
      ]),
      fetch_event_id: null,
      cdr_product_detail_hash: null,
    }),
    insertSql('historical_savings_rates', {
      bank_name: savings.bankName,
      collection_date: savings.collectionDate,
      product_id: savings.productId,
      product_name: savings.productName,
      account_type: savings.accountType,
      rate_type: savings.rateType,
      interest_rate: savings.interestRate,
      deposit_tier: savings.depositTier,
      min_balance: savings.minBalance,
      max_balance: savings.maxBalance,
      conditions: savings.conditions,
      monthly_fee: savings.monthlyFee,
      source_url: savings.sourceUrl,
      data_quality_flag: savings.dataQualityFlag,
      confidence_score: savings.confidenceScore,
      parsed_at: parsedAt,
      run_id: runId,
      run_source: 'scheduled',
      retrieval_type: 'present_scrape_same_date',
      product_url: savings.sourceUrl,
      published_at: null,
      product_code: savings.productId,
      series_key: seriesKey([savings.bankName, savings.productId, savings.accountType, savings.rateType, savings.depositTier]),
      fetch_event_id: null,
      cdr_product_detail_hash: null,
    }),
    insertSql('historical_term_deposit_rates', {
      bank_name: td.bankName,
      collection_date: td.collectionDate,
      product_id: td.productId,
      product_name: td.productName,
      term_months: td.termMonths,
      interest_rate: td.interestRate,
      deposit_tier: td.depositTier,
      min_deposit: td.minDeposit,
      max_deposit: td.maxDeposit,
      interest_payment: td.interestPayment,
      source_url: td.sourceUrl,
      data_quality_flag: td.dataQualityFlag,
      confidence_score: td.confidenceScore,
      parsed_at: parsedAt,
      run_id: runId,
      run_source: 'scheduled',
      retrieval_type: 'present_scrape_same_date',
      product_url: td.sourceUrl,
      published_at: null,
      product_code: td.productId,
      series_key: seriesKey([td.bankName, td.productId, td.termMonths, td.depositTier, td.interestPayment]),
      fetch_event_id: null,
      cdr_product_detail_hash: null,
    }),
    insertSql('run_reports', {
      run_id: runId,
      run_type: 'daily',
      started_at: '2026-03-14T00:00:00.000Z',
      finished_at: '2026-03-14T00:10:00.000Z',
      status: 'ok',
      per_lender_json: '{}',
      errors_json: '[]',
      run_source: 'scheduled',
    }),
  ].join('\n')
}

function runWrangler(args: string[], cwd = apiRoot, encoding: BufferEncoding = 'utf8') {
  const commandArgs = args[0] === 'wrangler' ? args.slice(1) : args
  const result = spawnSync(process.execPath, [WRANGLER_BIN, ...commandArgs], {
    cwd,
    env: process.env,
    encoding,
    shell: false,
  })
  if (result.error) throw result.error
  if ((result.status ?? 1) !== 0) throw new Error(result.stderr || result.stdout || `Command failed: npx ${args.join(' ')}`)
  return result.stdout
}

function executeD1File(persistDir: string, filePath: string): void {
  runWrangler(['wrangler', 'd1', 'execute', DB_NAME, '--env', 'test', '--local', '--persist-to', persistDir, '--file', filePath])
}

function queryJson<T>(persistDir: string, sql: string): T {
  const output = runWrangler(
    ['wrangler', 'd1', 'execute', DB_NAME, '--env', 'test', '--local', '--persist-to', persistDir, '--command', sql, '--json'],
  )
  return JSON.parse(output) as T
}

function queryCounts(persistDir: string): Record<string, number> {
  const sql = TABLES.map((tableName) => `SELECT '${tableName}' AS table_name, COUNT(*) AS n FROM ${quoteIdentifier(tableName)}`).join(' UNION ALL ')
  const payload = queryJson<Array<{ results: Array<{ table_name: string; n: number }> }>>(persistDir, sql)
  return Object.fromEntries((payload[0]?.results ?? []).map((row) => [row.table_name, Number(row.n || 0)]))
}

function queryTableNames(persistDir: string): string[] {
  const payload = queryJson<Array<{ results: Array<{ name: string }> }>>(
    persistDir,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name ASC;`,
  )
  return (payload[0]?.results ?? []).map((row) => row.name)
}

async function adminTableCounts(port: number): Promise<Record<string, number>> {
  const payload = await adminJson(port, '/db/tables?counts=true')
  const rows = Array.isArray(payload.tables) ? payload.tables as Array<{ name?: string; count?: number }> : []
  return Object.fromEntries(
    TABLES.map((tableName) => [tableName, Number(rows.find((row) => row.name === tableName)?.count ?? 0)]),
  )
}

function startWorker(persistDir: string, envFile: string, port: number): { child: ReturnType<typeof spawn>; logs: () => string } {
  const child = spawn(
    process.execPath,
    [
      WRANGLER_BIN,
      'dev',
      '--env',
      'test',
      '--env-file',
      envFile,
      '--var',
      `ADMIN_API_TOKEN=${ADMIN_TOKEN}`,
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      persistDir,
      '--show-interactive-dev-session=false',
    ],
    { cwd: apiRoot, env: process.env, shell: false },
  )
  let output = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk) => {
      output = `${output}${chunk.toString()}`
      if (output.length > 12000) output = output.slice(-12000)
    })
  }
  return { child, logs: () => output }
}

async function stopWorker(child: ReturnType<typeof spawn>): Promise<void> {
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', shell: false })
    return
  }
  if (!child.killed) child.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 1500))
  if (!child.killed) child.kill('SIGKILL')
}

async function waitForWorker(logs: () => string, port: number): Promise<void> {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/home-loan-rates/health`, { cache: 'no-store' })
      if (response.ok) return
    } catch {
      // Keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Local worker failed to start.\n${logs()}`)
}

async function adminJson(port: number, pathname: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}/api/home-loan-rates/admin${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(init?.headers || {}),
    },
  })
  const body = await response.text()
  const json = body ? JSON.parse(body) as Record<string, unknown> : {}
  if (!response.ok || json.ok !== true) throw new Error(`Admin request failed ${pathname}: ${body}`)
  return json
}

async function pollCompletedJob(port: number, jobId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    const payload = await adminJson(port, `/downloads/${encodeURIComponent(jobId)}`)
    if (payload.job && typeof payload.job === 'object' && (payload.job as { status?: string }).status === 'completed') return payload
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error(`Dump job ${jobId} did not complete in time.`)
}

async function downloadDump(port: number, jobId: string, targetPath: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/api/home-loan-rates/admin/downloads/${encodeURIComponent(jobId)}/download`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  })
  if (!response.ok) throw new Error(`Dump download failed with status ${response.status}.`)
  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileSync(targetPath, buffer)
  return gunzipSync(buffer).toString('utf8')
}

function combinedMigrationsSql(): string {
  return readdirSync(path.join(apiRoot, 'migrations'))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => readFileSync(path.join(apiRoot, 'migrations', fileName), 'utf8').trim())
    .join('\n\n')
}

function assertCounts(label: string, actual: Record<string, number>, expected: Record<string, number>): void {
  for (const tableName of TABLES) {
    if ((actual[tableName] ?? -1) !== (expected[tableName] ?? -1)) {
      throw new Error(`${label} mismatch for ${tableName}: expected ${expected[tableName]} but found ${actual[tableName]}`)
    }
  }
}

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ar-dump-restore-'))
  const sourcePersist = path.join(tempRoot, 'source-state')
  const targetPersist = path.join(tempRoot, 'target-state')
  mkdirSync(sourcePersist, { recursive: true })
  mkdirSync(targetPersist, { recursive: true })

  const migrationsFile = path.join(tempRoot, 'all-migrations.sql')
  const seedFile = path.join(tempRoot, 'seed.sql')
  const workerEnvFile = path.join(tempRoot, 'worker.env')
  const downloadPath = path.join(tempRoot, 'sandbox-dump.sql.gz')
  const initialPort = 8800 + Math.floor(Math.random() * 1000)
  writeFileSync(migrationsFile, combinedMigrationsSql())
  writeFileSync(seedFile, buildSeedSql())
  writeFileSync(workerEnvFile, `ADMIN_API_TOKEN=${ADMIN_TOKEN}\n`)

  let worker = startWorker(sourcePersist, workerEnvFile, initialPort)
  try {
    logStep('Applying migrations and seed data')
    executeD1File(sourcePersist, migrationsFile)
    executeD1File(sourcePersist, seedFile)

    logStep('Waiting for local worker')
    await waitForWorker(worker.logs, initialPort)
    const baselineCounts = await adminTableCounts(initialPort)
    logStep(`Baseline counts ${JSON.stringify(baselineCounts)} on port ${initialPort}`)

    logStep('Creating dump job')
    const created = await adminJson(initialPort, '/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream: 'operational', scope: 'all', mode: 'snapshot' }),
    })
    const jobId = String((created.job as { job_id?: string } | undefined)?.job_id || '')
    if (!jobId) throw new Error('Dump job creation did not return a job id.')
    logStep(`Polling dump job ${jobId}`)
    await pollCompletedJob(initialPort, jobId)

    logStep('Downloading dump artifact')
    const dumpSql = await downloadDump(initialPort, jobId, downloadPath)
    if (!dumpSql.includes('-- AustralianRates full database dump') || !dumpSql.includes('-- End of AustralianRates full database dump')) {
      throw new Error('Downloaded dump is missing the expected header/footer markers.')
    }

    logStep('Corrupting sandbox database through admin DB routes')
    const rateRowsPayload = await adminJson(initialPort, '/db/tables/historical_loan_rates/rows?limit=5')
    const firstRateRow = Array.isArray(rateRowsPayload.rows) ? rateRowsPayload.rows[0] as Record<string, unknown> | undefined : undefined
    if (!firstRateRow) throw new Error('No historical_loan_rates row was available to corrupt in the sandbox.')
    await adminJson(initialPort, '/db/tables/historical_loan_rates/rows', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bank_name: firstRateRow.bank_name,
        collection_date: firstRateRow.collection_date,
        product_id: firstRateRow.product_id,
        lvr_tier: firstRateRow.lvr_tier,
        rate_structure: firstRateRow.rate_structure,
        security_purpose: firstRateRow.security_purpose,
        repayment_type: firstRateRow.repayment_type,
        run_source: firstRateRow.run_source,
      }),
    })
    await adminJson(initialPort, '/db/tables/run_reports/rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_id: 'obsolete-run',
        run_type: 'backfill',
        started_at: '2026-03-14T02:00:00.000Z',
        finished_at: '2026-03-14T02:30:00.000Z',
        status: 'failed',
        per_lender_json: '{}',
        errors_json: '["obsolete"]',
        run_source: 'manual',
      }),
    })
    logStep(`Post-corruption counts ${JSON.stringify(await adminTableCounts(initialPort))}`)

    logStep('Running restore analysis')
    const analysisPayload = await adminJson(initialPort, `/downloads/${encodeURIComponent(jobId)}/restore/analysis`)
    const analysis = analysisPayload.analysis as {
      ready?: boolean
      requires_force?: boolean
      impact?: { rows_to_restore?: number; rows_to_remove?: number }
    }
    if (analysis.ready !== true || analysis.requires_force !== true) {
      throw new Error(`Unexpected restore analysis state: ${JSON.stringify(analysisPayload)}`)
    }
    if ((analysis.impact?.rows_to_restore ?? 0) < 1 || (analysis.impact?.rows_to_remove ?? 0) < 1) {
      throw new Error(`Restore analysis did not detect the expected missing/obsolete rows: ${JSON.stringify(analysisPayload)}`)
    }

    logStep('Executing in-place restore')
    await adminJson(initialPort, `/downloads/${encodeURIComponent(jobId)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    })

    assertCounts('in-place restore', await adminTableCounts(initialPort), baselineCounts)

    logStep('Importing dump into blank local D1')
    const importResult = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'scripts', 'import-d1-backup.js'),
        '--db',
        DB_NAME,
        '--input',
        downloadPath,
        '--env',
        'test',
        '--persist-to',
        targetPersist,
      ],
      {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
        shell: false,
      },
    )
    if ((importResult.status ?? 1) !== 0) {
      throw new Error(importResult.stderr || importResult.stdout || 'Blank-db import failed.')
    }

    assertCounts('blank-db import', queryCounts(targetPersist), baselineCounts)
    logStep('Sandbox dump/restore loop verified successfully')
    process.stdout.write(`Sandbox dump/restore loop verified successfully.\n`)
    process.stdout.write(`Source counts: ${JSON.stringify(baselineCounts)}\n`)
    process.stdout.write(`Dump artifact: ${downloadPath}\n`)
  } finally {
    logStep('Stopping local worker')
    await stopWorker(worker.child)
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
}

void main().catch((error) => {
  logStep(`ERROR ${(error as Error).stack || (error as Error).message}`)
  process.stderr.write(`${(error as Error).message}\n`)
  process.exitCode = 1
})
