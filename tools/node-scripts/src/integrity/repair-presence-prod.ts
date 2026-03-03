import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process'
import { isReadOnlySql, startsWithSelectOrWith } from './runbook'

const ALLOWED_DB = 'australianrates_api'
const FORBIDDEN_MUTATION_SQL = /\b(UPDATE|REPLACE|CREATE|DROP|ALTER|PRAGMA|TRUNCATE)\b/i

type WranglerQueryRow = Record<string, unknown>

type WranglerQueryResult = {
  results?: WranglerQueryRow[]
  success?: boolean
  meta?: {
    changes?: number
  }
}

export type RepairPresenceProdConfig = {
  db: string
  remote: true
  apply: boolean
  deleteExtras: boolean
  acknowledgeMutation: boolean
  confirmBackup: true
  backupArtifact: string
}

export type PresenceRepairProdPlanSql = {
  current_orphan_count: string
  planned_counts: string
}

export type PresenceRepairProdApplySql = {
  insert_missing: string
  delete_safe_extras: string
}

type ExecuteCommandResult = {
  command: string
  exitCode: number
  payload: WranglerQueryResult[]
}

export type SpawnRunner = (
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => SpawnSyncReturns<string>

type RunWranglerResult = {
  executable: string
  args: string[]
  fullCommand?: string
  exitCode: number
  stdout: string
  stderr: string
  errorMessage?: string
}

type RunD1SqlFileOptions = {
  spawnRunner?: SpawnRunner
  wranglerBin?: string
  tempDir?: string
  nowMs?: () => number
  writeFile?: (filePath: string, content: string) => void
  unlinkFile?: (filePath: string) => void
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

function parseArgValue(args: string[], key: string): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === key) {
      return args[i + 1]
    }
    if (arg.startsWith(`${key}=`)) {
      return arg.slice(`${key}=`.length)
    }
  }
  return undefined
}

function hasFlag(args: string[], key: string): boolean {
  return args.includes(key)
}

function resolveBackupArtifact(value: string | undefined): string {
  const raw = String(value || '').trim()
  if (!raw) {
    throw new Error('Refusing execution: --backup-artifact <path> is required.')
  }

  const resolved = path.resolve(raw)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Refusing execution: backup artifact does not exist at ${resolved}`)
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error(`Refusing execution: backup artifact is not a file at ${resolved}`)
  }
  return resolved
}

export function parseRepairPresenceProdConfig(args: string[]): RepairPresenceProdConfig {
  const remote = hasFlag(args, '--remote')
  if (!remote) {
    throw new Error('Refusing execution: --remote is required for production repair mode.')
  }

  const apply = hasFlag(args, '--apply')
  const acknowledgeMutation = hasFlag(args, '--i-know-this-will-mutate-production')
  if (apply && !acknowledgeMutation) {
    throw new Error('Refusing execution: --i-know-this-will-mutate-production is required.')
  }

  const confirmBackup = hasFlag(args, '--confirm-backup')
  if (!confirmBackup) {
    throw new Error('Refusing execution: --confirm-backup is required.')
  }

  const db = String(parseArgValue(args, '--db') || '').trim()
  if (!db) {
    throw new Error('Refusing execution: --db <name> is required.')
  }
  if (db !== ALLOWED_DB) {
    throw new Error(`Refusing execution: only --db ${ALLOWED_DB} is allowed.`)
  }

  const backupArtifact = resolveBackupArtifact(parseArgValue(args, '--backup-artifact'))

  return {
    db,
    remote: true,
    apply,
    deleteExtras: hasFlag(args, '--delete-extras'),
    acknowledgeMutation,
    confirmBackup: true,
    backupArtifact,
  }
}

function expectedPresenceCteSql(): string {
  return `
WITH expected AS (
  SELECT
    dataset_kind AS section,
    bank_name,
    product_id,
    COALESCE(is_removed, 0) AS is_removed,
    removed_at,
    last_seen_collection_date,
    COALESCE(last_seen_at, CURRENT_TIMESTAMP) AS last_seen_at,
    last_successful_run_id AS last_seen_run_id
  FROM product_catalog
),
missing AS (
  SELECT e.*
  FROM expected e
  LEFT JOIN product_presence_status p
    ON p.section = e.section
   AND p.bank_name = e.bank_name
   AND p.product_id = e.product_id
  WHERE p.product_id IS NULL
),
extra AS (
  SELECT p.*
  FROM product_presence_status p
  LEFT JOIN expected e
    ON e.section = p.section
   AND e.bank_name = p.bank_name
   AND e.product_id = p.product_id
  WHERE e.product_id IS NULL
),
historical_products AS (
  SELECT section, bank_name, product_id
  FROM (
    SELECT 'home_loans' AS section, bank_name, product_id
    FROM historical_loan_rates
    GROUP BY bank_name, product_id
    UNION
    SELECT 'savings' AS section, bank_name, product_id
    FROM historical_savings_rates
    GROUP BY bank_name, product_id
    UNION
    SELECT 'term_deposits' AS section, bank_name, product_id
    FROM historical_term_deposit_rates
    GROUP BY bank_name, product_id
  ) historical_union
),
extra_safe_delete AS (
  SELECT x.*
  FROM extra x
  LEFT JOIN historical_products h
    ON h.section = x.section
   AND h.bank_name = x.bank_name
   AND h.product_id = x.product_id
  WHERE h.product_id IS NULL
)
`
}

export function buildRepairPresenceProdPlanSql(): PresenceRepairProdPlanSql {
  const cte = expectedPresenceCteSql()
  return {
    current_orphan_count: `
SELECT COUNT(*) AS orphan_presence_count
FROM product_presence_status p
LEFT JOIN product_catalog c
  ON c.dataset_kind = p.section
 AND c.bank_name = p.bank_name
 AND c.product_id = p.product_id
WHERE c.product_id IS NULL
`,
    planned_counts: `
${cte}
SELECT
  (SELECT COUNT(*) FROM missing) AS missing_rows,
  (SELECT COUNT(*) FROM extra_safe_delete) AS extra_safe_delete_rows,
  (SELECT COUNT(*) FROM extra) AS extra_rows,
  (SELECT COUNT(*) FROM expected) AS expected_rows,
  (SELECT COUNT(*) FROM product_presence_status) AS existing_rows
`,
  }
}

export function buildRepairPresenceProdApplySql(): PresenceRepairProdApplySql {
  const cte = expectedPresenceCteSql()
  return {
    insert_missing: `
${cte}
INSERT OR IGNORE INTO product_presence_status (
  section,
  bank_name,
  product_id,
  is_removed,
  removed_at,
  last_seen_collection_date,
  last_seen_at,
  last_seen_run_id
)
SELECT
  section,
  bank_name,
  product_id,
  COALESCE(is_removed, 0),
  removed_at,
  last_seen_collection_date,
  COALESCE(last_seen_at, CURRENT_TIMESTAMP),
  last_seen_run_id
FROM missing
`,
    delete_safe_extras: `
${cte}
DELETE FROM product_presence_status
WHERE EXISTS (
  SELECT 1
  FROM extra_safe_delete s
  WHERE s.section = product_presence_status.section
    AND s.bank_name = product_presence_status.bank_name
    AND s.product_id = product_presence_status.product_id
)
`,
  }
}

export function isSafePlanSql(sql: string): boolean {
  return startsWithSelectOrWith(sql) && isReadOnlySql(sql)
}

export function isSafePresenceMutationSql(sql: string): boolean {
  const normalized = normalizeSql(sql)
  if (FORBIDDEN_MUTATION_SQL.test(normalized)) {
    return false
  }

  const isInsert = /^WITH\b.*\bINSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+product_presence_status\b/i.test(normalized)
  const isDelete = /^WITH\b.*\bDELETE\s+FROM\s+product_presence_status\b/i.test(normalized)
  if (!isInsert && !isDelete) {
    return false
  }

  for (const match of normalized.matchAll(/\bINSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+([a-zA-Z0-9_]+)/gi)) {
    if (String(match[1] || '').toLowerCase() !== 'product_presence_status') return false
  }
  for (const match of normalized.matchAll(/\bDELETE\s+FROM\s+([a-zA-Z0-9_]+)/gi)) {
    if (String(match[1] || '').toLowerCase() !== 'product_presence_status') return false
  }

  return true
}

function parseWranglerJsonOutput(stdout: string): WranglerQueryResult[] {
  const trimmed = stdout.trim()
  const tryParse = (candidate: string): WranglerQueryResult[] | null => {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (!Array.isArray(parsed)) return null
      return parsed as WranglerQueryResult[]
    } catch {
      return null
    }
  }

  const direct = tryParse(trimmed)
  if (direct) return direct

  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start >= 0 && end > start) {
    const sliced = tryParse(trimmed.slice(start, end + 1))
    if (sliced) return sliced
  }

  throw new Error(`Unable to parse wrangler JSON output: ${trimmed.slice(0, 400)}`)
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g
  for (const match of command.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[0])
  }
  return tokens
}

function escapeCmdExeArg(value: string): string {
  const escaped = String(value).replace(/"/g, '\\"')
  if (escaped.length === 0 || /[\s&|<>()^%!]/.test(escaped)) {
    return `"${escaped}"`
  }
  return escaped
}

function parseWranglerBin(raw: string | undefined): { command: string; prefixArgs: string[] } {
  const tokens = tokenizeCommand(String(raw || '').trim())
  if (tokens.length === 0) return { command: 'wrangler', prefixArgs: [] }
  return {
    command: tokens[0],
    prefixArgs: tokens.slice(1),
  }
}

export function buildCmdExeFallbackCommand(args: string[]): string {
  return ['npx', 'wrangler', ...args].map(escapeCmdExeArg).join(' ')
}

function summarizeSql(sqlText: string): string {
  return normalizeSql(sqlText).slice(0, 200)
}

function sanitizeLabel(label: string): string {
  const value = String(label || 'query').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return value || 'query'
}

function invocationFromRun(run: RunWranglerResult): string {
  return run.fullCommand ? `cmd.exe /d /s /c ${run.fullCommand}` : `${run.executable} ${run.args.join(' ')}`
}

function runSingleSpawn(
  spawnRunner: SpawnRunner,
  executable: string,
  args: string[],
  fullCommand?: string,
): RunWranglerResult {
  const result = spawnRunner(executable, args, {
    shell: false,
    stdio: 'pipe',
    encoding: 'utf8',
  })
  return {
    executable,
    args,
    fullCommand,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    errorMessage: result.error?.message,
  }
}

function formatRunFailure(prefix: string, run: RunWranglerResult): string {
  const invocation = run.fullCommand
    ? `${run.executable} ${run.args.join(' ')}\nfull_cmd=${run.fullCommand}`
    : `${run.executable} ${run.args.join(' ')}`
  return `${prefix}\nexecutable=${run.executable}\ninvocation=${invocation}\nexit=${run.exitCode}\nstdout=${run.stdout.trim()}\nstderr=${run.stderr.trim()}\nerror=${run.errorMessage || ''}`
}

export function runWrangler(
  args: string[],
  opts?: {
    spawnRunner?: SpawnRunner
    wranglerBin?: string
  },
): RunWranglerResult {
  const spawnRunner = opts?.spawnRunner ?? spawnSync
  const wranglerBin = opts?.wranglerBin ?? process.env.WRANGLER_BIN
  const parsed = parseWranglerBin(wranglerBin)
  const directIsNpx = /^npx(?:\.cmd)?$/i.test(parsed.command)
  const directArgs = directIsNpx ? [...(parsed.prefixArgs.length > 0 ? parsed.prefixArgs : ['wrangler']), ...args] : [...parsed.prefixArgs, ...args]
  const directRun = runSingleSpawn(spawnRunner, parsed.command, directArgs)
  if (directRun.exitCode === 0) return directRun

  const fallbackCmd = buildCmdExeFallbackCommand(args)
  const fallbackRun = runSingleSpawn(spawnRunner, 'cmd.exe', ['/d', '/s', '/c', fallbackCmd], fallbackCmd)
  if (fallbackRun.exitCode === 0) return fallbackRun

  throw new Error(
    `${formatRunFailure('Wrangler direct invocation failed.', directRun)}\n\n${formatRunFailure(
      'Wrangler cmd.exe fallback failed.',
      fallbackRun,
    )}`,
  )
}

export function runD1SqlFile(
  dbName: string,
  remote: boolean,
  sqlText: string,
  label: string,
  options?: RunD1SqlFileOptions,
): ExecuteCommandResult {
  const sql = String(sqlText || '').trim()
  if (!sql) {
    throw new Error(`SQL text for ${label} must be non-empty.`)
  }

  const nowMs = options?.nowMs ?? (() => Date.now())
  const tempDir = options?.tempDir ?? os.tmpdir()
  const tempPath = path.join(
    tempDir,
    `repair-presence-prod-${sanitizeLabel(label)}-${nowMs()}-${process.pid}.sql`,
  )

  const writeFile = options?.writeFile ?? ((filePath: string, content: string) => fs.writeFileSync(filePath, content, 'utf8'))
  const unlinkFile = options?.unlinkFile ?? ((filePath: string) => fs.unlinkSync(filePath))
  const spawnRunner = options?.spawnRunner ?? spawnSync

  writeFile(tempPath, `${sql}\n`)

  const args = ['d1', 'execute', dbName, ...(remote ? ['--remote'] : []), '--json', '--file', tempPath]

  try {
    const run = runWrangler(args, { spawnRunner, wranglerBin: options?.wranglerBin })
    return {
      command: invocationFromRun(run),
      exitCode: run.exitCode,
      payload: parseWranglerJsonOutput(run.stdout),
    }
  } catch (error) {
    throw new Error(
      `${(error as Error)?.message || String(error)}\ntemp_sql_file=${tempPath}\nsql_preview=${summarizeSql(sql)}`,
    )
  } finally {
    try {
      unlinkFile(tempPath)
    } catch {
      // best effort cleanup
    }
  }
}

function executeRemoteSql(db: string, sql: string, label: string, spawnRunner: SpawnRunner = spawnSync): ExecuteCommandResult {
  const run = runD1SqlFile(db, true, sql, label, { spawnRunner })
  return {
    command: run.command,
    exitCode: run.exitCode,
    payload: run.payload,
  }
}

export function executeRemoteSqlWithFallbackForTest(
  db: string,
  sql: string,
  spawnRunner: SpawnRunner,
): ExecuteCommandResult {
  return executeRemoteSql(db, sql, 'test', spawnRunner)
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function firstRow(payload: WranglerQueryResult[]): WranglerQueryRow {
  const firstResult = payload[0]
  const row = firstResult?.results?.[0]
  if (!row || typeof row !== 'object') {
    throw new Error('Wrangler result payload missing first row.')
  }
  return row
}

function changesFromPayload(payload: WranglerQueryResult[]): number {
  const firstResult = payload[0]
  return asNumber(firstResult?.meta?.changes)
}

export function main(args: string[]): void {
  const config = parseRepairPresenceProdConfig(args)

  const planSql = buildRepairPresenceProdPlanSql()
  const applySql = buildRepairPresenceProdApplySql()

  for (const [name, sql] of Object.entries(planSql)) {
    if (!isSafePlanSql(sql)) {
      throw new Error(`Plan SQL failed safety check (${name}).`)
    }
  }
  for (const [name, sql] of Object.entries(applySql)) {
    if (!isSafePresenceMutationSql(sql)) {
      throw new Error(`Apply SQL failed safety check (${name}).`)
    }
  }

  const currentOrphan = executeRemoteSql(config.db, planSql.current_orphan_count, 'plan-current-orphan-count')
  const plannedCounts = executeRemoteSql(config.db, planSql.planned_counts, 'plan-counts')

  const currentOrphanRow = firstRow(currentOrphan.payload)
  const plannedCountsRow = firstRow(plannedCounts.payload)

  const report: Record<string, unknown> = {
    ok: true,
    mode: config.apply ? 'apply' : 'plan_only',
    target_db: config.db,
    backup_artifact: config.backupArtifact,
    flags: {
      apply: config.apply,
      delete_extras: config.deleteExtras,
      remote: config.remote,
      acknowledge_mutation: config.acknowledgeMutation,
      confirm_backup: config.confirmBackup,
    },
    planned_counts: {
      orphan_presence_count: asNumber(currentOrphanRow.orphan_presence_count),
      missing_rows: asNumber(plannedCountsRow.missing_rows),
      extra_safe_delete_rows: asNumber(plannedCountsRow.extra_safe_delete_rows),
      extra_rows: asNumber(plannedCountsRow.extra_rows),
      expected_rows: asNumber(plannedCountsRow.expected_rows),
      existing_rows: asNumber(plannedCountsRow.existing_rows),
    },
    sql: {
      plan: planSql,
      apply: applySql,
    },
    executed_commands: [
      { command: currentOrphan.command, exit_code: currentOrphan.exitCode },
      { command: plannedCounts.command, exit_code: plannedCounts.exitCode },
    ],
  }

  if (config.apply) {
    const insertResult = executeRemoteSql(config.db, applySql.insert_missing, 'apply-insert-missing')
    const executedCommands = report.executed_commands as Array<{ command: string; exit_code: number }>
    executedCommands.push({ command: insertResult.command, exit_code: insertResult.exitCode })

    let deletedRows = 0
    if (config.deleteExtras) {
      const deleteResult = executeRemoteSql(config.db, applySql.delete_safe_extras, 'apply-delete-safe-extras')
      deletedRows = changesFromPayload(deleteResult.payload)
      executedCommands.push({ command: deleteResult.command, exit_code: deleteResult.exitCode })
    }

    const postVerify = executeRemoteSql(config.db, planSql.current_orphan_count, 'post-verify-orphan-count')
    executedCommands.push({ command: postVerify.command, exit_code: postVerify.exitCode })
    const postVerifyRow = firstRow(postVerify.payload)

    report.apply_result = {
      inserted_missing_rows: changesFromPayload(insertResult.payload),
      deleted_safe_extra_rows: deletedRows,
      orphan_presence_count_after_apply: asNumber(postVerifyRow.orphan_presence_count),
    }
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (typeof require !== 'undefined' && require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${(error as Error)?.message || String(error)}\n`)
    process.exitCode = 1
  }
}
