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

type ParsedWranglerPayload = {
  rows: WranglerQueryRow[]
  changes: number
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

type RunD1SqlOptions = {
  spawnRunner?: SpawnRunner
  wranglerBin?: string
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

function truncateText(value: string, maxChars = 4000): string {
  const text = String(value || '')
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...<truncated>`
}

function toFiniteNumberStrict(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') {
    const asNumber = Number(value)
    return Number.isFinite(asNumber) ? asNumber : null
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const BOOLEAN_OPTIONS = new Set([
  '--remote',
  '--apply',
  '--delete-extras',
  '--i-know-this-will-mutate-production',
  '--confirm-backup',
])

const VALUE_OPTIONS = new Set([
  '--db',
  '--backup-artifact',
])

type ParsedCliArgs = {
  flags: Set<string>
  values: Map<string, string>
  positionals: string[]
}

function parseBooleanValue(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  throw new Error(`invalid boolean value "${value}"`)
}

function parseCliArgs(args: string[]): ParsedCliArgs {
  const flags = new Set<string>()
  const values = new Map<string, string>()
  const positionals: string[] = []

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    const equalIndex = token.indexOf('=')
    const key = equalIndex >= 0 ? token.slice(0, equalIndex) : token
    const inlineValue = equalIndex >= 0 ? token.slice(equalIndex + 1) : undefined

    if (BOOLEAN_OPTIONS.has(key)) {
      if (inlineValue === undefined) {
        flags.add(key)
      } else if (parseBooleanValue(inlineValue)) {
        flags.add(key)
      } else {
        flags.delete(key)
      }
      continue
    }

    if (VALUE_OPTIONS.has(key)) {
      let value = inlineValue
      if (value === undefined) {
        value = args[i + 1]
        i += 1
      }
      if (!value || value.startsWith('--')) {
        throw new Error(`option ${key} requires a value`)
      }
      values.set(key, value)
      continue
    }

    throw new Error(`unknown option ${key}`)
  }

  return { flags, values, positionals }
}

function exampleCommand(): string {
  return 'node scripts/repair-presence-prod.js --remote --db australianrates_api --confirm-backup --backup-artifact artifacts\\api-prod-YYYYMMDDTHHMMSSZ.sql'
}

function formatCliErrorMessage(reason: string, args: string[]): string {
  return `CLI preflight failed: ${reason}; received_argv=${JSON.stringify(args)}; example="${exampleCommand()}"`
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
  let parsed: ParsedCliArgs
  try {
    parsed = parseCliArgs(args)
  } catch (error) {
    throw new Error(formatCliErrorMessage((error as Error)?.message || 'invalid arguments', args))
  }

  if (parsed.positionals.length > 0) {
    throw new Error(formatCliErrorMessage(`unexpected positional arguments: ${parsed.positionals.join(' ')}`, args))
  }

  const remote = parsed.flags.has('--remote')
  if (!remote) {
    throw new Error(formatCliErrorMessage('--remote is required for production repair mode', args))
  }

  const apply = parsed.flags.has('--apply')
  const acknowledgeMutation = parsed.flags.has('--i-know-this-will-mutate-production')
  if (apply && !acknowledgeMutation) {
    throw new Error(formatCliErrorMessage('--i-know-this-will-mutate-production is required when --apply is set', args))
  }

  const confirmBackup = parsed.flags.has('--confirm-backup')
  if (!confirmBackup) {
    throw new Error(formatCliErrorMessage('--confirm-backup is required', args))
  }

  const db = String(parsed.values.get('--db') || '').trim()
  if (!db) {
    throw new Error(formatCliErrorMessage('--db <name> is required', args))
  }
  if (db !== ALLOWED_DB) {
    throw new Error(formatCliErrorMessage(`only --db ${ALLOWED_DB} is allowed`, args))
  }

  let backupArtifact: string
  try {
    backupArtifact = resolveBackupArtifact(parsed.values.get('--backup-artifact'))
  } catch (error) {
    throw new Error(formatCliErrorMessage((error as Error)?.message || 'invalid --backup-artifact', args))
  }

  return {
    db,
    remote: true,
    apply,
    deleteExtras: parsed.flags.has('--delete-extras'),
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
orphan_presence AS (
  SELECT
    pps.section,
    pps.bank_name,
    pps.product_id
  FROM product_presence_status pps
  LEFT JOIN product_catalog pc
    ON pc.dataset_kind = pps.section
   AND pc.bank_name = pps.bank_name
   AND pc.product_id = pps.product_id
  WHERE pc.product_id IS NULL
),
missing AS (
  SELECT
    e.section,
    e.bank_name,
    e.product_id,
    e.is_removed,
    e.removed_at,
    e.last_seen_collection_date,
    e.last_seen_at,
    e.last_seen_run_id
  FROM expected e
  LEFT JOIN product_presence_status pps
    ON pps.section = e.section
   AND pps.bank_name = e.bank_name
   AND pps.product_id = e.product_id
  WHERE pps.product_id IS NULL
),
extra AS (
  SELECT
    op.section,
    op.bank_name,
    op.product_id
  FROM orphan_presence op
),
extra_safe_delete AS (
  SELECT
    op.section,
    op.bank_name,
    op.product_id
  FROM orphan_presence op
)
`
}

export function buildRepairPresenceProdPlanSql(): PresenceRepairProdPlanSql {
  const cte = expectedPresenceCteSql()
  return {
    current_orphan_count: `
SELECT COUNT(*) AS orphan_presence_count
FROM product_presence_status pps
LEFT JOIN product_catalog pc
  ON pc.dataset_kind = pps.section
 AND pc.bank_name = pps.bank_name
 AND pc.product_id = pps.product_id
WHERE pc.product_id IS NULL;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractResultRows(container: unknown): unknown[] {
  if (!isRecord(container)) return []
  if (Array.isArray(container.result)) return container.result
  if (Array.isArray(container.results)) return container.results
  return []
}

function parseArrayRowAsOrphanCount(rows: unknown[]): WranglerQueryRow[] {
  if (rows.length !== 1) {
    throw new Error('Array-row result requires exactly one row.')
  }
  const first = rows[0]
  if (!Array.isArray(first) || first.length !== 1) {
    throw new Error('Array-row result requires exactly one column.')
  }
  const value = toFiniteNumberStrict(first[0])
  if (value === null) {
    throw new Error('Array-row result must contain a numeric value.')
  }
  return [{ orphan_presence_count: value }]
}

function parseRowsFromWranglerShape(root: unknown): WranglerQueryRow[] {
  const rows = extractResultRows(root)
  if (rows.length === 0) return []

  const first = rows[0]
  if (Array.isArray(first)) {
    return parseArrayRowAsOrphanCount(rows)
  }

  if (isRecord(first)) {
    return rows.map((row) => {
      if (!isRecord(row)) {
        throw new Error('Mixed wrangler result shape encountered.')
      }
      return row
    })
  }

  const asNumber = toFiniteNumberStrict(first)
  if (rows.length === 1 && asNumber !== null) {
    return [{ orphan_presence_count: asNumber }]
  }

  throw new Error('Unsupported wrangler row shape.')
}

function unwrapWranglerRoot(parsed: unknown): unknown {
  if (Array.isArray(parsed) && parsed.length === 1 && isRecord(parsed[0])) {
    return parsed[0]
  }
  return parsed
}

function parseChangesFromWranglerRoot(parsed: unknown, root: unknown): number {
  if (isRecord(root)) {
    const changes = toFiniteNumberStrict(root.meta && isRecord(root.meta) ? root.meta.changes : undefined)
    if (changes !== null) return changes
  }
  if (Array.isArray(parsed) && isRecord(parsed[0])) {
    const firstMeta = parsed[0].meta
    const changes = toFiniteNumberStrict(isRecord(firstMeta) ? firstMeta.changes : undefined)
    if (changes !== null) return changes
  }
  return 0
}

function extractJsonText(stdout: string): string {
  const text = String(stdout || '').trim()
  if (!text) {
    throw new Error('Wrangler output is empty.')
  }

  try {
    JSON.parse(text)
    return text
  } catch {
    // try extracting trailing JSON payload from mixed progress + JSON output
  }

  const startIndices = [text.indexOf('['), text.indexOf('{')]
    .filter((value) => value >= 0)
    .sort((a, b) => a - b)

  for (const start of startIndices) {
    const candidate = text.slice(start).trim()
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // continue
    }

    const closing = candidate.startsWith('[') ? candidate.lastIndexOf(']') : candidate.lastIndexOf('}')
    if (closing > 0) {
      const bounded = candidate.slice(0, closing + 1)
      try {
        JSON.parse(bounded)
        return bounded
      } catch {
        // continue
      }
    }
  }

  throw new Error(`Unable to locate JSON payload in wrangler output: ${truncateText(text, 500)}`)
}

function parseWranglerJsonPayload(stdout: string): ParsedWranglerPayload {
  const jsonText = extractJsonText(stdout)
  const parsed = JSON.parse(jsonText) as unknown
  const root = unwrapWranglerRoot(parsed)
  const rows = parseRowsFromWranglerShape(root)
  const changes = parseChangesFromWranglerRoot(parsed, root)
  return { rows, changes }
}

export function parseFirstRowFromWranglerJson(stdout: string): Record<string, any> {
  const parsed = parseWranglerJsonPayload(stdout)
  const row = parsed.rows[0]
  if (!row) {
    throw new Error('Wrangler JSON did not include a result row.')
  }
  return row as Record<string, any>
}

function parseSingleNumericRowFromNonJson(stdout: string): WranglerQueryRow {
  const trimmed = String(stdout || '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    const arrayStart = trimmed.indexOf('[')
    const arrayEnd = trimmed.lastIndexOf(']')
    const objectStart = trimmed.indexOf('{')
    const objectEnd = trimmed.lastIndexOf('}')
    const candidate =
      arrayStart >= 0 && arrayEnd > arrayStart
        ? trimmed.slice(arrayStart, arrayEnd + 1)
        : objectStart >= 0 && objectEnd > objectStart
          ? trimmed.slice(objectStart, objectEnd + 1)
          : ''
    if (!candidate) {
      throw new Error('No JSON payload found in non-JSON fallback output.')
    }
    parsed = JSON.parse(candidate)
  }

  const root = unwrapWranglerRoot(parsed)
  const rows = parseRowsFromWranglerShape(root)
  if (rows.length !== 1) {
    throw new Error('Fallback output must include exactly one row.')
  }
  const entries = Object.entries(rows[0] || {})
  if (entries.length !== 1) {
    throw new Error('Fallback output must include exactly one numeric column.')
  }
  const numeric = toFiniteNumberStrict(entries[0]?.[1])
  if (numeric === null) {
    throw new Error('Fallback output column is not numeric.')
  }
  return { orphan_presence_count: numeric }
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

function isWranglerExecutionSummaryRow(row: WranglerQueryRow | undefined): boolean {
  if (!row) return false
  return 'Total queries executed' in row && 'Rows read' in row
}

function isJsonUnsupportedError(text: string): boolean {
  return /unknown option\s+--json/i.test(text) || /Unexpected argument:\s*--json/i.test(text)
}

function formatD1FailureDetails(
  label: string,
  args: string[],
  runError: unknown,
  tempPath: string,
  sql: string,
): string {
  const errorMessage = runError instanceof Error ? runError.message : String(runError)
  return [
    `D1 execution failed (${label}).`,
    'executable=wrangler|cmd.exe',
    `invocation_args=${args.join(' ')}`,
    `exit_code=non-zero`,
    `stdout=${truncateText(errorMessage)}`,
    `stderr=${truncateText(errorMessage)}`,
    `temp_sql_file=${tempPath}`,
    `sql_preview=${summarizeSql(sql)}`,
  ].join('\n')
}

function formatD1ParseFailureDetails(
  label: string,
  run: RunWranglerResult,
  tempPath: string,
  sql: string,
  parseError: unknown,
): string {
  const parseMessage = parseError instanceof Error ? parseError.message : String(parseError)
  return [
    `D1 output parse failed (${label}).`,
    `executable=${run.executable}`,
    `args=${run.args.join(' ')}`,
    `exit_code=${run.exitCode}`,
    `stdout=${truncateText(run.stdout)}`,
    `stderr=${truncateText(run.stderr)}`,
    `temp_sql_file=${tempPath}`,
    `sql_preview=${summarizeSql(sql)}`,
    `parse_error=${parseMessage}`,
  ].join('\n')
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

  const jsonArgs = ['d1', 'execute', dbName, ...(remote ? ['--remote'] : []), '--file', tempPath, '--json']
  const plainArgs = ['d1', 'execute', dbName, ...(remote ? ['--remote'] : []), '--file', tempPath]

  try {
    let run: RunWranglerResult
    let usedJson = true

    try {
      run = runWrangler(jsonArgs, { spawnRunner, wranglerBin: options?.wranglerBin })
    } catch (jsonError) {
      const message = jsonError instanceof Error ? jsonError.message : String(jsonError)
      if (!isJsonUnsupportedError(message)) {
        throw new Error(formatD1FailureDetails(label, jsonArgs, jsonError, tempPath, sql))
      }
      usedJson = false
      try {
        run = runWrangler(plainArgs, { spawnRunner, wranglerBin: options?.wranglerBin })
      } catch (plainError) {
        throw new Error(formatD1FailureDetails(label, plainArgs, plainError, tempPath, sql))
      }
    }

    let parsedPayload: ParsedWranglerPayload
    try {
      if (usedJson) {
        parsedPayload = parseWranglerJsonPayload(run.stdout)
      } else {
        parsedPayload = {
          rows: [parseSingleNumericRowFromNonJson(run.stdout)],
          changes: 0,
        }
      }
    } catch (parseError) {
      throw new Error(formatD1ParseFailureDetails(label, run, tempPath, sql, parseError))
    }

    return {
      command: invocationFromRun(run),
      exitCode: run.exitCode,
      payload: [
        {
          results: parsedPayload.rows,
          success: true,
          meta: {
            changes: parsedPayload.changes,
          },
        },
      ],
    }
  } catch (error) {
    throw new Error(`${(error as Error)?.message || String(error)}\ntemp_sql_file=${tempPath}\nsql_preview=${summarizeSql(sql)}`)
  } finally {
    try {
      unlinkFile(tempPath)
    } catch {
      // best effort cleanup
    }
  }
}

function runD1SqlCommand(
  dbName: string,
  remote: boolean,
  sqlText: string,
  label: string,
  options?: RunD1SqlOptions,
): ExecuteCommandResult {
  const sql = String(sqlText || '').trim()
  if (!sql) {
    throw new Error(`SQL text for ${label} must be non-empty.`)
  }

  const normalizedSql = normalizeSql(sql)
  const jsonArgs = ['d1', 'execute', dbName, ...(remote ? ['--remote'] : []), '--command', normalizedSql, '--json']
  const plainArgs = ['d1', 'execute', dbName, ...(remote ? ['--remote'] : []), '--command', normalizedSql]
  const spawnRunner = options?.spawnRunner ?? spawnSync

  try {
    let run: RunWranglerResult
    let usedJson = true

    try {
      run = runWrangler(jsonArgs, { spawnRunner, wranglerBin: options?.wranglerBin })
    } catch (jsonError) {
      const message = jsonError instanceof Error ? jsonError.message : String(jsonError)
      if (!isJsonUnsupportedError(message)) {
        throw new Error(formatD1FailureDetails(label, jsonArgs, jsonError, '<inline>', sql))
      }
      usedJson = false
      try {
        run = runWrangler(plainArgs, { spawnRunner, wranglerBin: options?.wranglerBin })
      } catch (plainError) {
        throw new Error(formatD1FailureDetails(label, plainArgs, plainError, '<inline>', sql))
      }
    }

    let parsedPayload: ParsedWranglerPayload
    try {
      if (usedJson) {
        parsedPayload = parseWranglerJsonPayload(run.stdout)
      } else {
        parsedPayload = {
          rows: [parseSingleNumericRowFromNonJson(run.stdout)],
          changes: 0,
        }
      }
    } catch (parseError) {
      throw new Error(
        [
          `D1 output parse failed (${label}).`,
          `executable=${run.executable}`,
          `args=${run.args.join(' ')}`,
          `exit_code=${run.exitCode}`,
          `stdout=${truncateText(run.stdout)}`,
          `stderr=${truncateText(run.stderr)}`,
          `sql_preview=${summarizeSql(sql)}`,
          `parse_error=${parseError instanceof Error ? parseError.message : String(parseError)}`,
        ].join('\n'),
      )
    }

    return {
      command: invocationFromRun(run),
      exitCode: run.exitCode,
      payload: [
        {
          results: parsedPayload.rows,
          success: true,
          meta: {
            changes: parsedPayload.changes,
          },
        },
      ],
    }
  } catch (error) {
    throw new Error(`${(error as Error)?.message || String(error)}\nsql_preview=${summarizeSql(sql)}`)
  }
}

function executeRemoteSql(db: string, sql: string, label: string, spawnRunner: SpawnRunner = spawnSync): ExecuteCommandResult {
  const fileRun = runD1SqlFile(db, true, sql, label, { spawnRunner })
  const first = firstRow(fileRun.payload)
  if (isWranglerExecutionSummaryRow(first) && startsWithSelectOrWith(sql)) {
    return runD1SqlCommand(db, true, sql, `${label}-command-fallback`, { spawnRunner })
  }
  return fileRun
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

function requiredNumberField(row: WranglerQueryRow, key: string, context: string): number {
  if (!(key in row)) {
    throw new Error(`Expected field "${key}" missing in ${context}. row=${JSON.stringify(row)}`)
  }
  return asNumber(row[key])
}

function readOrphanPresenceCount(row: WranglerQueryRow, context: string): number {
  if (!('orphan_presence_count' in row)) {
    throw new Error(`Expected field "orphan_presence_count" missing in ${context}. row=${JSON.stringify(row)}`)
  }
  return asNumber(row['orphan_presence_count'])
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

export function runPlanOnlyForTest(args: string[], spawnRunner: SpawnRunner): Record<string, unknown> {
  const config = parseRepairPresenceProdConfig(args)
  if (config.apply) {
    throw new Error('runPlanOnlyForTest only supports plan mode.')
  }

  const planSql = buildRepairPresenceProdPlanSql()
  for (const [name, sql] of Object.entries(planSql)) {
    if (!isSafePlanSql(sql)) {
      throw new Error(`Plan SQL failed safety check (${name}).`)
    }
  }

  const currentOrphan = executeRemoteSql(config.db, planSql.current_orphan_count, 'plan-current-orphan-count', spawnRunner)
  const plannedCounts = executeRemoteSql(config.db, planSql.planned_counts, 'plan-counts', spawnRunner)
  const currentOrphanRow = firstRow(currentOrphan.payload)
  const plannedCountsRow = firstRow(plannedCounts.payload)

  return {
    orphan_before: readOrphanPresenceCount(currentOrphanRow, 'current_orphan_count'),
    missing_count: requiredNumberField(plannedCountsRow, 'missing_rows', 'planned_counts'),
    extra_safe_delete_count: requiredNumberField(plannedCountsRow, 'extra_safe_delete_rows', 'planned_counts'),
    executed_commands: [
      { command: currentOrphan.command, exit_code: currentOrphan.exitCode },
      { command: plannedCounts.command, exit_code: plannedCounts.exitCode },
    ],
  }
}

export function main(args: string[]): void {
  const rawArgv = [...process.argv]
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
  const orphanBefore = readOrphanPresenceCount(currentOrphanRow, 'current_orphan_count')
  const missingCount = requiredNumberField(plannedCountsRow, 'missing_rows', 'planned_counts')
  const extraSafeDeleteCount = requiredNumberField(plannedCountsRow, 'extra_safe_delete_rows', 'planned_counts')

  const report: Record<string, unknown> = {
    ok: true,
    mode: config.apply ? 'apply' : 'plan_only',
    invocation: {
      argv: rawArgv,
      command_line: rawArgv.join(' '),
    },
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
      orphan_presence_count: orphanBefore,
      missing_rows: missingCount,
      extra_safe_delete_rows: extraSafeDeleteCount,
      extra_rows: requiredNumberField(plannedCountsRow, 'extra_rows', 'planned_counts'),
      expected_rows: requiredNumberField(plannedCountsRow, 'expected_rows', 'planned_counts'),
      existing_rows: requiredNumberField(plannedCountsRow, 'existing_rows', 'planned_counts'),
    },
    orphan_before: orphanBefore,
    missing_count: missingCount,
    extra_safe_delete_count: extraSafeDeleteCount,
    exit_code: 0,
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
      orphan_presence_count_after_apply: readOrphanPresenceCount(postVerifyRow, 'post_apply_orphan_count'),
    }
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (typeof require !== 'undefined' && require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    const message = (error as Error)?.message || String(error)
    if (message.startsWith('CLI preflight failed:')) {
      process.stderr.write(`${message}\n`)
    } else {
      process.stderr.write(`[repair-presence-prod] command_line=${process.argv.join(' ')}\n`)
      process.stderr.write(`${message}\n`)
    }
    process.exitCode = 1
  }
}
