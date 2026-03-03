import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  executeRemoteSqlWithFallbackForTest,
  isSafePlanSql,
  type SpawnRunner,
} from './repair-presence-prod'

const ALLOWED_DB = 'australianrates_api'
const MUTATION_FLAGS = [
  '--apply',
  '--delete',
  '--delete-extras',
  '--mutate',
  '--i-know-this-will-mutate-production',
]

type RawLinkagePlanProdConfig = {
  db: string
  remote: true
  confirmBackup: true
  backupArtifact: string
  repeat: number
}

type ParsedCliArgs = {
  flags: Set<string>
  values: Map<string, string>
  positionals: string[]
}

const BOOLEAN_OPTIONS = new Set(['--remote', '--confirm-backup'])
const VALUE_OPTIONS = new Set(['--db', '--backup-artifact', '--repeat'])

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

    const eqIndex = token.indexOf('=')
    const key = eqIndex >= 0 ? token.slice(0, eqIndex) : token
    const inlineValue = eqIndex >= 0 ? token.slice(eqIndex + 1) : undefined

    if (BOOLEAN_OPTIONS.has(key)) {
      if (inlineValue === undefined || inlineValue === 'true' || inlineValue === '1') {
        flags.add(key)
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
  return 'node scripts/plan-raw-linkage-prod.js --remote --db australianrates_api --confirm-backup --backup-artifact artifacts\\api-prod-YYYYMMDDTHHMMSSZ.sql --repeat 2'
}

function formatCliError(reason: string, args: string[]): string {
  return `CLI preflight failed: ${reason}; received_argv=${JSON.stringify(args)}; example="${exampleCommand()}"`
}

function resolveBackupArtifact(input: string | undefined): string {
  const raw = String(input || '').trim()
  if (!raw) {
    throw new Error('--backup-artifact <path> is required')
  }
  const resolved = path.resolve(raw)
  if (!fs.existsSync(resolved)) {
    throw new Error(`backup artifact does not exist at ${resolved}`)
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error(`backup artifact is not a file at ${resolved}`)
  }
  return resolved
}

export function parseRawLinkagePlanProdConfig(args: string[]): RawLinkagePlanProdConfig {
  const hasMutationFlag = args.some((arg) => MUTATION_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)))
  if (hasMutationFlag) {
    throw new Error(formatCliError('mutation flags are forbidden for plan-only tool', args))
  }

  let parsed: ParsedCliArgs
  try {
    parsed = parseCliArgs(args)
  } catch (error) {
    throw new Error(formatCliError((error as Error)?.message || 'invalid arguments', args))
  }

  if (parsed.positionals.length > 0) {
    throw new Error(formatCliError(`unexpected positional arguments: ${parsed.positionals.join(' ')}`, args))
  }
  if (!parsed.flags.has('--remote')) {
    throw new Error(formatCliError('--remote is required', args))
  }
  if (!parsed.flags.has('--confirm-backup')) {
    throw new Error(formatCliError('--confirm-backup is required', args))
  }

  const db = String(parsed.values.get('--db') || '').trim()
  if (!db) {
    throw new Error(formatCliError('--db <name> is required', args))
  }
  if (db !== ALLOWED_DB) {
    throw new Error(formatCliError(`only --db ${ALLOWED_DB} is allowed`, args))
  }

  let backupArtifact: string
  try {
    backupArtifact = resolveBackupArtifact(parsed.values.get('--backup-artifact'))
  } catch (error) {
    throw new Error(formatCliError((error as Error)?.message || 'invalid --backup-artifact', args))
  }

  const repeatRaw = String(parsed.values.get('--repeat') || '2').trim()
  const repeat = Number.parseInt(repeatRaw, 10)
  if (!Number.isFinite(repeat) || repeat < 1) {
    throw new Error(formatCliError('--repeat must be an integer >= 1', args))
  }

  return {
    db,
    remote: true,
    confirmBackup: true,
    backupArtifact,
    repeat,
  }
}

export function buildRawLinkageProdPlanSql(): Record<string, string> {
  const base = `
WITH orphan_rows AS (
  SELECT rp.id, rp.source_type, rp.source_url, rp.content_hash, rp.fetched_at
  FROM raw_payloads rp
  LEFT JOIN raw_objects ro
    ON ro.content_hash = rp.content_hash
  WHERE ro.content_hash IS NULL
),
orphan_hashes AS (
  SELECT DISTINCT content_hash
  FROM orphan_rows
  WHERE content_hash IS NOT NULL AND TRIM(content_hash) != ''
)
`

  const sql = {
    orphan_count: `
${base}
SELECT COUNT(*) AS orphan_count
FROM orphan_rows
`,
    distinct_orphan_hashes: `
${base}
SELECT COUNT(*) AS distinct_orphan_hashes
FROM orphan_hashes
`,
    top_source_type_counts: `
${base}
SELECT
  COALESCE(source_type, 'unknown') AS source_type,
  COUNT(*) AS orphan_count
FROM orphan_rows
GROUP BY COALESCE(source_type, 'unknown')
ORDER BY orphan_count DESC, source_type ASC
LIMIT 20
`,
    sample_orphans: `
${base}
SELECT
  id,
  source_type,
  source_url,
  content_hash
FROM orphan_rows
ORDER BY fetched_at DESC, id DESC
LIMIT 20
`,
  }

  for (const [name, query] of Object.entries(sql)) {
    if (!isSafePlanSql(query)) {
      throw new Error(`Plan SQL failed safety check (${name}).`)
    }
  }
  return sql
}

type ExecutedQuery = {
  label: string
  command: string
  exit_code: number
}

type QueryResultRows = {
  rows: Array<Record<string, unknown>>
  command: string
  exitCode: number
  attempt?: unknown
  retry?: unknown
}

function runPlanQuery(
  db: string,
  sql: string,
  label: string,
  expectedAlias: string,
  spawnRunner: SpawnRunner,
): QueryResultRows {
  const rawResult = executeRemoteSqlWithFallbackForTest(db, sql, spawnRunner, {
    phase: 'plan',
    expectedAlias,
  }) as unknown as {
    payload: Array<{ results?: Array<Record<string, unknown>> }>
    command: string
    exitCode: number
    attempt?: unknown
    retry?: unknown
  }

  const rows = rawResult.payload?.[0]?.results ?? []
  return {
    rows,
    command: rawResult.command,
    exitCode: rawResult.exitCode,
    attempt: rawResult.attempt,
    retry: rawResult.retry,
  }
}

type RunCounts = {
  orphan_count: number
  distinct_orphan_hashes: number
}

function requiredNumberField(row: Record<string, unknown> | undefined, field: string): number {
  if (!row || !(field in row)) {
    throw new Error(`Expected numeric field "${field}" missing in query result.`)
  }
  const value = Number(row[field])
  if (!Number.isFinite(value)) {
    throw new Error(`Expected numeric field "${field}" is not finite: ${String(row[field])}`)
  }
  return value
}

export function runRawLinkageProdPlan(args: string[], spawnRunner: SpawnRunner = spawnSync): Record<string, unknown> {
  const config = parseRawLinkagePlanProdConfig(args)
  const sql = buildRawLinkageProdPlanSql()
  const countsPerRun: RunCounts[] = []
  const executedCommands: ExecutedQuery[] = []
  const retries: unknown[] = []
  const perRunDiagnostics: Array<Record<string, unknown>> = []
  let sourceTypeCountsRows: Array<Record<string, unknown>> = []
  let sampleRows: Array<Record<string, unknown>> = []

  for (let runIndex = 1; runIndex <= config.repeat; runIndex += 1) {
    const orphanCountResult = runPlanQuery(
      config.db,
      sql.orphan_count,
      `orphan-count-run-${runIndex}`,
      'orphan_count',
      spawnRunner,
    )
    const distinctHashesResult = runPlanQuery(
      config.db,
      sql.distinct_orphan_hashes,
      `distinct-orphan-hashes-run-${runIndex}`,
      'distinct_orphan_hashes',
      spawnRunner,
    )
    const sourceTypeCountsResult = runPlanQuery(
      config.db,
      sql.top_source_type_counts,
      `top-source-type-counts-run-${runIndex}`,
      'source_type',
      spawnRunner,
    )
    const sampleResult = runPlanQuery(
      config.db,
      sql.sample_orphans,
      `sample-orphans-run-${runIndex}`,
      'id',
      spawnRunner,
    )

    const orphanCount = requiredNumberField(orphanCountResult.rows[0], 'orphan_count')
    const distinctHashes = requiredNumberField(distinctHashesResult.rows[0], 'distinct_orphan_hashes')
    countsPerRun.push({
      orphan_count: orphanCount,
      distinct_orphan_hashes: distinctHashes,
    })

    executedCommands.push(
      { label: `orphan_count#${runIndex}`, command: orphanCountResult.command, exit_code: orphanCountResult.exitCode },
      {
        label: `distinct_orphan_hashes#${runIndex}`,
        command: distinctHashesResult.command,
        exit_code: distinctHashesResult.exitCode,
      },
      {
        label: `top_source_type_counts#${runIndex}`,
        command: sourceTypeCountsResult.command,
        exit_code: sourceTypeCountsResult.exitCode,
      },
      { label: `sample_orphans#${runIndex}`, command: sampleResult.command, exit_code: sampleResult.exitCode },
    )

    const retryItems = [
      orphanCountResult.retry,
      distinctHashesResult.retry,
      sourceTypeCountsResult.retry,
      sampleResult.retry,
    ].filter(Boolean)
    retries.push(...retryItems)

    perRunDiagnostics.push({
      run: runIndex,
      orphan_attempt: orphanCountResult.attempt || null,
      distinct_attempt: distinctHashesResult.attempt || null,
      source_type_attempt: sourceTypeCountsResult.attempt || null,
      sample_attempt: sampleResult.attempt || null,
      stdout_tail: 'not_captured_for_successful_plan_queries',
      stderr_tail: 'not_captured_for_successful_plan_queries',
    })

    if (runIndex === config.repeat) {
      sourceTypeCountsRows = sourceTypeCountsResult.rows
      sampleRows = sampleResult.rows
    }
  }

  const first = countsPerRun[0] || { orphan_count: 0, distinct_orphan_hashes: 0 }
  const stable = countsPerRun.every(
    (run) =>
      run.orphan_count === first.orphan_count
      && run.distinct_orphan_hashes === first.distinct_orphan_hashes,
  )

  return {
    ok: true,
    phase: 'plan',
    target_db: config.db,
    backup_artifact: config.backupArtifact,
    repeats: config.repeat,
    stable,
    counts_per_run: countsPerRun,
    counts: {
      orphan_count: first.orphan_count,
      distinct_orphan_hashes: first.distinct_orphan_hashes,
    },
    top_orphan_source_types: sourceTypeCountsRows,
    sample_orphans: sampleRows,
    executed_commands: executedCommands,
    retry: retries.length > 0 ? retries : null,
    unstable_diagnostics: stable ? null : perRunDiagnostics,
    exit_code: 0,
  }
}

type PlanCliOptions = {
  spawnRunner?: SpawnRunner
  stdoutWrite?: (text: string) => void
  argvForLog?: string[]
}

export function runRawLinkageProdPlanCli(args: string[], options?: PlanCliOptions): number {
  const stdoutWrite = options?.stdoutWrite ?? ((text: string) => process.stdout.write(text))
  const spawnRunner = options?.spawnRunner ?? spawnSync
  const argvForLog = options?.argvForLog ?? process.argv

  try {
    const report = runRawLinkageProdPlan(args, spawnRunner)
    stdoutWrite(`${JSON.stringify(report)}\n`)
    return 0
  } catch (error) {
    const failure = {
      ok: false,
      phase: 'plan',
      error: (error as Error)?.message || String(error),
      command_line: argvForLog.join(' '),
      exit_code: 1,
    }
    stdoutWrite(`${JSON.stringify(failure)}\n`)
    return 1
  }
}

export function main(args: string[]): void {
  process.exitCode = runRawLinkageProdPlanCli(args)
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2))
}
