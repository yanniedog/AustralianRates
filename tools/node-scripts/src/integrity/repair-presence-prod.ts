import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process'
import { resolveCliPath } from './cli-path'
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
  attempt: {
    mode: '--file' | '--command'
    usedJson: boolean
    summaryOnly: boolean
    executable: string
    args: string[]
  }
  retry?: {
    reason: 'summary_only_output'
    first_mode: '--file'
    retry_mode: '--command'
    used_json: true
    attempts: Array<{ mode: '--file' | '--command'; executable: string; args_json: string[] }>
  }
}

type ParsedWranglerPayload = {
  rows: WranglerQueryRow[]
  changes: number
  summaryOnly: boolean
}

type LineLogger = (line: string) => void

export type SpawnRunner = (
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => SpawnSyncReturns<string>

type RunWranglerResult = {
  executable: string
  args: string[]
  exitCode: number
  stdout: string
  stderr: string
  errorMessage?: string
}

type RunD1SqlFileOptions = {
  spawnRunner?: SpawnRunner
  wranglerBin?: string
  platform?: NodeJS.Platform
  tempDir?: string
  nowMs?: () => number
  writeFile?: (filePath: string, content: string) => void
  unlinkFile?: (filePath: string) => void
  logLine?: LineLogger
}

type RunD1SqlOptions = {
  spawnRunner?: SpawnRunner
  wranglerBin?: string
  platform?: NodeJS.Platform
  logLine?: LineLogger
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

function truncateText(value: string, maxChars = 4000): string {
  const text = String(value || '')
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...<truncated>`
}

function tailLines(value: string, maxLines = 30): string {
  const lines = String(value || '').split(/\r?\n/)
  return lines.slice(-maxLines).join('\n')
}

function firstStackLines(error: unknown, maxLines = 20): string {
  const stack = (error as Error)?.stack
  if (!stack) return ''
  return stack.split('\n').slice(0, maxLines).join('\n')
}

function defaultLogLine(line: string): void {
  process.stderr.write(`${line}\n`)
}

function emitStartBanner(config: RepairPresenceProdConfig, mode: 'plan' | 'apply', logLine: LineLogger): void {
  logLine(
    `[repair-presence-prod] start db=${config.db} backup_artifact=${config.backupArtifact} mode=${mode} delete_extras=${config.deleteExtras ? 'on' : 'off'}`,
  )
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

  const resolved = resolveCliPath(raw)
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

function parseRowsFromResultArray(rows: unknown[]): WranglerQueryRow[] {
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

function collectRowSets(node: unknown): WranglerQueryRow[][] {
  const rowSets: WranglerQueryRow[][] = []
  const queue: unknown[] = [node]
  const seen = new Set<unknown>()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue
    if (seen.has(current)) continue
    seen.add(current)

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item)
      continue
    }

    const resultRows = extractResultRows(current)
    if (resultRows.length > 0) {
      if (resultRows.every((entry) => isRecord(entry) && (entry.success !== undefined || entry.results !== undefined || entry.result !== undefined))) {
        for (const entry of resultRows) queue.push(entry)
      }
      try {
        const parsedRows = parseRowsFromResultArray(resultRows)
        if (parsedRows.length > 0) {
          rowSets.push(parsedRows)
        }
      } catch {
        // Continue searching other branches for row sets.
      }
    }

    for (const value of Object.values(current)) {
      queue.push(value)
    }
  }

  return rowSets
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
  const rowSets = collectRowSets(root)
  const nonSummaryRows = rowSets.find((candidate) => candidate.length > 0 && !candidate.every((row) => isWranglerExecutionSummaryRow(row)))
  const summaryOnly = rowSets.length > 0 && !nonSummaryRows
  const rows = nonSummaryRows
    || []
  const changes = parseChangesFromWranglerRoot(parsed, root)
  return { rows, changes, summaryOnly }
}

export function parseFirstRowFromWranglerJson(
  stdout: string,
  context?: {
    stderr?: string
    executable?: string
    args?: string[]
  },
): Record<string, any> {
  const parsed = parseWranglerJsonPayload(stdout)
  const row = parsed.rows[0]
  if (!row) {
    throw new Error(
      [
        'Wrangler JSON did not include a result row.',
        `raw_stdout=${truncateText(stdout, 2000)}`,
        `raw_stderr=${truncateText(context?.stderr || '', 2000)}`,
        `executable=${context?.executable || ''}`,
        `args_json=${JSON.stringify(context?.args || [])}`,
      ].join('\n'),
    )
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
  const rowSets = collectRowSets(root)
  const rows = rowSets.find((candidate) => candidate.length > 0) || []
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

function parseWranglerBin(raw: string | undefined): { command: string; prefixArgs: string[] } {
  const tokens = tokenizeCommand(String(raw || '').trim())
  if (tokens.length === 0) return { command: 'wrangler', prefixArgs: [] }
  return {
    command: tokens[0],
    prefixArgs: tokens.slice(1),
  }
}

function summarizeSql(sqlText: string): string {
  return normalizeSql(sqlText).slice(0, 200)
}

function sanitizeLabel(label: string): string {
  const value = String(label || 'query').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return value || 'query'
}

function invocationFromRun(run: RunWranglerResult): string {
  return `${run.executable} ${run.args.join(' ')}`
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
  context: {
    dbName: string
    usedJson: boolean
    mode: '--file' | '--command'
  },
  args: string[],
  runError: unknown,
  tempPath: string,
  sql: string,
): string {
  const errorMessage = runError instanceof Error ? runError.message : String(runError)
  return [
    `D1 execution failed (${label}).`,
    `db_name=${context.dbName}`,
    `used_json=${context.usedJson}`,
    `mode=${context.mode}`,
    `invocation_args_json=${JSON.stringify(args)}`,
    `exit_code=non-zero`,
    `stdout=${truncateText(errorMessage)}`,
    `stderr=${truncateText(errorMessage)}`,
    `stderr_tail=${truncateText(tailLines(errorMessage, 30), 4000)}`,
    `temp_sql_file=${tempPath}`,
    `sql_preview=${summarizeSql(sql)}`,
  ].join('\n')
}

function formatD1ParseFailureDetails(
  label: string,
  run: RunWranglerResult,
  context: {
    dbName: string
    usedJson: boolean
    mode: '--file' | '--command'
  },
  tempPath: string,
  sql: string,
  parseError: unknown,
): string {
  const parseMessage = parseError instanceof Error ? parseError.message : String(parseError)
  return [
    `D1 output parse failed (${label}).`,
    `db_name=${context.dbName}`,
    `used_json=${context.usedJson}`,
    `mode=${context.mode}`,
    `executable=${run.executable}`,
    `args_json=${JSON.stringify(run.args)}`,
    `exit_code=${run.exitCode}`,
    `stdout=${truncateText(run.stdout)}`,
    `stderr=${truncateText(run.stderr)}`,
    `stderr_tail=${truncateText(tailLines(run.stderr, 30), 4000)}`,
    `temp_sql_file=${tempPath}`,
    `sql_preview=${summarizeSql(sql)}`,
    `parse_error=${parseMessage}`,
  ].join('\n')
}

function runSingleSpawn(
  spawnRunner: SpawnRunner,
  executable: string,
  args: string[],
): RunWranglerResult {
  const result = spawnRunner(executable, args, {
    shell: false,
    stdio: 'pipe',
    encoding: 'utf8',
  })
  return {
    executable,
    args,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    errorMessage: result.error?.message,
  }
}

function formatRunFailure(prefix: string, run: RunWranglerResult): string {
  const invocation = `${run.executable} ${run.args.join(' ')}`
  return `${prefix}\nexecutable=${run.executable}\nargs_json=${JSON.stringify(run.args)}\ninvocation=${invocation}\nexit=${run.exitCode}\nstdout=${run.stdout.trim()}\nstderr=${run.stderr.trim()}\nerror=${run.errorMessage || ''}`
}

type D1ExecuteInvocation = {
  executable: string
  args: string[]
}

type D1ExecuteParams = {
  dbName: string
  remote: boolean
  json: boolean
  filePath?: string
  commandSql?: string
  spawnRunner?: SpawnRunner
  wranglerBin?: string
  platform?: NodeJS.Platform
  logLine?: LineLogger
}

function buildD1ExecuteArgs(params: D1ExecuteParams): string[] {
  const args = ['d1', 'execute', params.dbName, ...(params.remote ? ['--remote'] : [])]
  if (params.filePath) {
    args.push('--file', params.filePath)
  } else if (params.commandSql) {
    args.push('--command', params.commandSql)
  } else {
    throw new Error('D1 execute requires either filePath or commandSql.')
  }
  if (params.json) {
    args.push('--json')
  }
  return args
}

function buildD1ExecuteCandidates(params: D1ExecuteParams): D1ExecuteInvocation[] {
  const baseArgs = buildD1ExecuteArgs(params)
  const wranglerBin = params.wranglerBin ?? process.env.WRANGLER_BIN
  const parsedBin = parseWranglerBin(wranglerBin)
  const platform = params.platform ?? process.platform
  const candidates: D1ExecuteInvocation[] = []
  const npxCliPath = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
  const hasNpxCli = fs.existsSync(npxCliPath)

  if (wranglerBin && parsedBin.command) {
    const isNpx = /^npx(?:\.cmd)?$/i.test(parsedBin.command)
    if (isNpx) {
      candidates.push({
        executable: parsedBin.command,
        args: [...parsedBin.prefixArgs, 'wrangler', ...baseArgs],
      })
      if (platform === 'win32' && hasNpxCli) {
        candidates.push({
          executable: process.execPath,
          args: [npxCliPath, ...parsedBin.prefixArgs, 'wrangler', ...baseArgs],
        })
      }
      return candidates
    }
    candidates.push({
      executable: parsedBin.command,
      args: [...parsedBin.prefixArgs, ...baseArgs],
    })
    return candidates
  }

  if (platform === 'win32') {
    candidates.push(
      { executable: 'npx.cmd', args: ['wrangler', ...baseArgs] },
      { executable: 'npx', args: ['wrangler', ...baseArgs] },
    )
    if (hasNpxCli) {
      candidates.push({
        executable: process.execPath,
        args: [npxCliPath, 'wrangler', ...baseArgs],
      })
    }
    return candidates
  }

  return [
    { executable: 'npx', args: ['wrangler', ...baseArgs] },
    { executable: 'wrangler', args: baseArgs },
  ]
}

export function runWranglerD1Execute(params: D1ExecuteParams): RunWranglerResult {
  const spawnRunner = params.spawnRunner ?? spawnSync
  const attempts = buildD1ExecuteCandidates(params)
  const failures: string[] = []

  for (const attempt of attempts) {
    params.logLine?.(
      `[repair-presence-prod] wrangler_command="${attempt.executable} ${attempt.args.join(' ')}" args_json=${JSON.stringify(attempt.args)}`,
    )
    const run = runSingleSpawn(spawnRunner, attempt.executable, attempt.args)
    if (run.exitCode === 0) {
      return run
    }
    failures.push(formatRunFailure(`Wrangler invocation failed (${attempt.executable}).`, run))
  }

  throw new Error(failures.join('\n\n'))
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

  writeFile(tempPath, `${sql}\n`)

  try {
    let run: RunWranglerResult
    let usedJson = true
    const jsonArgs = ['d1', 'execute', dbName, ...(remote ? ['--remote'] : []), '--file', tempPath, '--json']
    const plainArgs = ['d1', 'execute', dbName, ...(remote ? ['--remote'] : []), '--file', tempPath]

    try {
      run = runWranglerD1Execute({
        dbName,
        remote,
        json: true,
        filePath: tempPath,
        spawnRunner: options?.spawnRunner,
        wranglerBin: options?.wranglerBin,
        platform: options?.platform,
        logLine: options?.logLine,
      })
    } catch (jsonError) {
      const message = jsonError instanceof Error ? jsonError.message : String(jsonError)
      if (!isJsonUnsupportedError(message)) {
        throw new Error(
          formatD1FailureDetails(
            label,
            { dbName: dbName, usedJson: true, mode: '--file' },
            jsonArgs,
            jsonError,
            tempPath,
            sql,
          ),
        )
      }
      usedJson = false
      try {
        run = runWranglerD1Execute({
          dbName,
          remote,
          json: false,
          filePath: tempPath,
          spawnRunner: options?.spawnRunner,
          wranglerBin: options?.wranglerBin,
          platform: options?.platform,
          logLine: options?.logLine,
        })
      } catch (plainError) {
        throw new Error(
          formatD1FailureDetails(
            label,
            { dbName: dbName, usedJson: false, mode: '--file' },
            plainArgs,
            plainError,
            tempPath,
            sql,
          ),
        )
      }
    }

    let parsedPayload: ParsedWranglerPayload
    try {
      if (usedJson) {
        const parsed = parseWranglerJsonPayload(run.stdout)
        parsedPayload = {
          rows: parsed.rows,
          changes: parsed.changes,
          summaryOnly: parsed.summaryOnly,
        }
      } else {
        parsedPayload = {
          rows: [parseSingleNumericRowFromNonJson(run.stdout)],
          changes: 0,
          summaryOnly: false,
        }
      }
    } catch (parseError) {
      throw new Error(
        formatD1ParseFailureDetails(
          label,
          run,
          { dbName: dbName, usedJson, mode: '--file' },
          tempPath,
          sql,
          parseError,
        ),
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
      attempt: {
        mode: '--file',
        usedJson,
        summaryOnly: parsedPayload.summaryOnly,
        executable: run.executable,
        args: run.args,
      },
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
  const commandSql = normalizeSql(sql)

  const jsonArgs = ['d1', 'execute', dbName, ...(remote ? ['--remote'] : []), '--command', commandSql, '--json']
  const plainArgs = ['d1', 'execute', dbName, ...(remote ? ['--remote'] : []), '--command', commandSql]

  let run: RunWranglerResult
  let usedJson = true

  try {
    run = runWranglerD1Execute({
      dbName,
      remote,
      json: true,
      commandSql,
      spawnRunner: options?.spawnRunner,
      wranglerBin: options?.wranglerBin,
      platform: options?.platform,
      logLine: options?.logLine,
    })
  } catch (jsonError) {
    const message = jsonError instanceof Error ? jsonError.message : String(jsonError)
    if (!isJsonUnsupportedError(message)) {
      throw new Error(
        formatD1FailureDetails(
          label,
          { dbName, usedJson: true, mode: '--command' },
          jsonArgs,
          jsonError,
          '<inline>',
          commandSql,
        ),
      )
    }
    usedJson = false
    try {
      run = runWranglerD1Execute({
        dbName,
        remote,
        json: false,
        commandSql,
        spawnRunner: options?.spawnRunner,
        wranglerBin: options?.wranglerBin,
        platform: options?.platform,
        logLine: options?.logLine,
      })
    } catch (plainError) {
      throw new Error(
        formatD1FailureDetails(
          label,
          { dbName, usedJson: false, mode: '--command' },
          plainArgs,
          plainError,
          '<inline>',
            commandSql,
        ),
      )
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
        summaryOnly: false,
      }
    }
  } catch (parseError) {
    throw new Error(
      formatD1ParseFailureDetails(
        label,
        run,
        { dbName, usedJson, mode: '--command' },
        '<inline>',
        commandSql,
        parseError,
      ),
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
    attempt: {
      mode: '--command',
      usedJson,
      summaryOnly: parsedPayload.summaryOnly,
      executable: run.executable,
      args: run.args,
    },
  }
}

type ExecuteRemoteSqlOptions = {
  spawnRunner?: SpawnRunner
  phase?: 'plan' | 'apply'
  expectedAlias?: string
  logLine?: LineLogger
}

function executeRemoteSql(db: string, sql: string, label: string, options?: ExecuteRemoteSqlOptions): ExecuteCommandResult {
  const spawnRunner = options?.spawnRunner ?? spawnSync
  const initial = runD1SqlFile(db, true, sql, label, { spawnRunner, logLine: options?.logLine })

  if (options?.phase === 'apply' && initial.attempt.mode !== '--file') {
    throw new Error(`Apply mode invariant violated for ${label}: expected --file execution only.`)
  }

  const isPlanRetryEligible = options?.phase === 'plan'
    && startsWithSelectOrWith(sql)
    && isReadOnlySql(sql)
    && Boolean(options?.expectedAlias)

  if (!isPlanRetryEligible || !initial.attempt.summaryOnly) {
    return initial
  }

  options?.logLine?.('[repair-presence-prod] retry_reason=summary_only_output first_mode=--file retry_mode=--command')
  const retry = runD1SqlCommand(db, true, sql, `${label}-summary-only-retry`, {
    spawnRunner,
    logLine: options?.logLine,
  })
  if (retry.attempt.summaryOnly) {
    throw new Error(
      [
        `Wrangler returned execution summary without rowset for both --file and --command (${label}).`,
        'retry_reason=summary_only_output',
        `first_mode=${initial.attempt.mode}`,
        `retry_mode=${retry.attempt.mode}`,
        'used_json=true',
        `first_executable=${initial.attempt.executable}`,
        `first_args_json=${JSON.stringify(initial.attempt.args)}`,
        `retry_executable=${retry.attempt.executable}`,
        `retry_args_json=${JSON.stringify(retry.attempt.args)}`,
      ].join('\n'),
    )
  }

  const retryRow = firstRow(retry.payload)
  const expectedAlias = String(options?.expectedAlias || '')
  if (!(expectedAlias in retryRow)) {
    throw new Error(
      [
        `Retry row missing expected alias "${expectedAlias}" (${label}).`,
        'retry_reason=summary_only_output',
        `first_mode=${initial.attempt.mode}`,
        `retry_mode=${retry.attempt.mode}`,
        'used_json=true',
        `first_executable=${initial.attempt.executable}`,
        `first_args_json=${JSON.stringify(initial.attempt.args)}`,
        `retry_executable=${retry.attempt.executable}`,
        `retry_args_json=${JSON.stringify(retry.attempt.args)}`,
        `retry_row=${JSON.stringify(retryRow)}`,
      ].join('\n'),
    )
  }

  return {
    ...retry,
    retry: {
      reason: 'summary_only_output',
      first_mode: '--file',
      retry_mode: '--command',
      used_json: true,
      attempts: [
        { mode: '--file', executable: initial.attempt.executable, args_json: initial.attempt.args },
        { mode: '--command', executable: retry.attempt.executable, args_json: retry.attempt.args },
      ],
    },
  }
}

export function executeRemoteSqlWithFallbackForTest(
  db: string,
  sql: string,
  spawnRunner: SpawnRunner,
  options?: {
    phase?: 'plan' | 'apply'
    expectedAlias?: string
  },
): ExecuteCommandResult {
  return executeRemoteSql(db, sql, 'test', { spawnRunner, phase: options?.phase, expectedAlias: options?.expectedAlias })
}

export function executeRemoteSqlCommandForTest(
  db: string,
  sql: string,
  spawnRunner: SpawnRunner,
): ExecuteCommandResult {
  return runD1SqlCommand(db, true, sql, 'test', { spawnRunner })
}

export function executeRemoteSqlFileForTest(
  db: string,
  sql: string,
  spawnRunner: SpawnRunner,
): ExecuteCommandResult {
  return runD1SqlFile(db, true, sql, 'test', { spawnRunner })
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

export function runPlanOnlyForTest(
  args: string[],
  spawnRunner: SpawnRunner,
  options?: { logLine?: LineLogger },
): Record<string, unknown> {
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

  const currentOrphan = executeRemoteSql(config.db, planSql.current_orphan_count, 'plan-current-orphan-count', {
    spawnRunner,
    phase: 'plan',
    expectedAlias: 'orphan_presence_count',
    logLine: options?.logLine,
  })
  const plannedCounts = executeRemoteSql(config.db, planSql.planned_counts, 'plan-counts', {
    spawnRunner,
    phase: 'plan',
    expectedAlias: 'missing_rows',
    logLine: options?.logLine,
  })
  const currentOrphanRow = firstRow(currentOrphan.payload)
  const plannedCountsRow = firstRow(plannedCounts.payload)
  const orphanBefore = readOrphanPresenceCount(currentOrphanRow, 'current_orphan_count')
  const missingCount = requiredNumberField(plannedCountsRow, 'missing_rows', 'planned_counts')
  const extraSafeDeleteCount = requiredNumberField(plannedCountsRow, 'extra_safe_delete_rows', 'planned_counts')

  return {
    orphan_before: orphanBefore,
    missing_count: missingCount,
    extra_safe_delete_count: extraSafeDeleteCount,
    ok: true,
    phase: 'plan',
    exit_code: 0,
    executed_commands: [
      { command: currentOrphan.command, exit_code: currentOrphan.exitCode },
      { command: plannedCounts.command, exit_code: plannedCounts.exitCode },
    ],
    retry: currentOrphan.retry || plannedCounts.retry || null,
  }
}

type PlanCliOptions = {
  spawnRunner?: SpawnRunner
  stdoutWrite?: (text: string) => void
  argvForLog?: string[]
  logLine?: LineLogger
}

export function runPlanModeCli(args: string[], options?: PlanCliOptions): number {
  const stdoutWrite = options?.stdoutWrite ?? ((text: string) => process.stdout.write(text))
  const spawnRunner = options?.spawnRunner ?? spawnSync
  const argvForLog = options?.argvForLog ?? process.argv
  const logLine = options?.logLine ?? defaultLogLine

  try {
    const config = parseRepairPresenceProdConfig(args)
    emitStartBanner(config, 'plan', logLine)
    const report = runPlanOnlyForTest(args, spawnRunner, { logLine })
    stdoutWrite(`${JSON.stringify(report)}\n`)
    return 0
  } catch (error) {
    const message = (error as Error)?.message || String(error)
    const failure = {
      ok: false,
      phase: 'plan',
      error: message,
      stack: firstStackLines(error, 20),
      command_line: argvForLog.join(' '),
      exit_code: 1,
    }
    stdoutWrite(`${JSON.stringify(failure)}\n`)
    return 1
  }
}

export function main(args: string[]): void {
  if (!args.includes('--apply')) {
    process.exitCode = runPlanModeCli(args)
    return
  }

  const rawArgv = [...process.argv]
  const config = parseRepairPresenceProdConfig(args)
  const logLine = defaultLogLine
  emitStartBanner(config, 'apply', logLine)

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

  const currentOrphan = executeRemoteSql(config.db, planSql.current_orphan_count, 'plan-current-orphan-count', {
    phase: 'plan',
    expectedAlias: 'orphan_presence_count',
    logLine,
  })
  const plannedCounts = executeRemoteSql(config.db, planSql.planned_counts, 'plan-counts', {
    phase: 'plan',
    expectedAlias: 'missing_rows',
    logLine,
  })

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
    retry: currentOrphan.retry || plannedCounts.retry || null,
  }

  if (config.apply) {
    const insertResult = executeRemoteSql(config.db, applySql.insert_missing, 'apply-insert-missing', {
      phase: 'apply',
      logLine,
    })
    const executedCommands = report.executed_commands as Array<{ command: string; exit_code: number }>
    executedCommands.push({ command: insertResult.command, exit_code: insertResult.exitCode })

    let deletedRows = 0
    if (config.deleteExtras) {
      const deleteResult = executeRemoteSql(config.db, applySql.delete_safe_extras, 'apply-delete-safe-extras', {
        phase: 'apply',
        logLine,
      })
      deletedRows = changesFromPayload(deleteResult.payload)
      executedCommands.push({ command: deleteResult.command, exit_code: deleteResult.exitCode })
    }

    const postVerify = executeRemoteSql(config.db, planSql.current_orphan_count, 'post-verify-orphan-count', {
      phase: 'plan',
      expectedAlias: 'orphan_presence_count',
      logLine,
    })
    executedCommands.push({ command: postVerify.command, exit_code: postVerify.exitCode })
    const postVerifyRow = firstRow(postVerify.payload)

    report.apply_result = {
      inserted_missing_rows: changesFromPayload(insertResult.payload),
      deleted_safe_extra_rows: deletedRows,
      orphan_presence_count_after_apply: readOrphanPresenceCount(postVerifyRow, 'post_apply_orphan_count'),
    }
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = 0
}

if (typeof require !== 'undefined' && require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    const message = (error as Error)?.message || String(error)
    process.stderr.write(`[repair-presence-prod] command_line=${process.argv.join(' ')}\n`)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
