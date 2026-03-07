import crypto from 'node:crypto'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  executeRemoteSqlWithFallbackForTest,
  isSafePlanSql,
  runD1SqlFile,
  type SpawnRunner,
} from './repair-presence-prod'
import { resolveCliPath } from './cli-path'

const ALLOWED_DB = 'australianrates_api'
const FORBIDDEN_MUTATION_SQL = /\b(UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|TRUNCATE)\b/i
const FORBIDDEN_FLAGS = ['--delete', '--delete-extras', '--mutate']

type RawLinkageRepairProdConfig = {
  db: string
  remote: true
  apply: boolean
  acknowledgeMutation: boolean
  confirmBackup: true
  backupArtifact: string
}

type ParsedCliArgs = {
  flags: Set<string>
  values: Map<string, string>
  positionals: string[]
}

type ExecutedCommand = {
  label: string
  mode: '--file' | '--command'
  executable: string
  exit_code: number
}

type CandidateRow = {
  content_hash: string
  source_type: string
  first_source_url: string
  r2_key: string
  body_bytes: number
  content_type: string
  reason_bucket: string
}

type PlanSnapshot = {
  orphanCount: number
  distinctHashesCount: number
  insertCandidateCount: number
  bucketCounts: Array<{ bucket: string; row_count: number }>
  candidateRows: CandidateRow[]
  candidateSample: CandidateRow[]
  planHash: string
  executedCommands: ExecutedCommand[]
}

const BOOLEAN_OPTIONS = new Set([
  '--remote',
  '--apply',
  '--i-know-this-will-mutate-production',
  '--confirm-backup',
])

const VALUE_OPTIONS = new Set([
  '--db',
  '--backup-artifact',
])

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
  return 'node scripts/repair-raw-linkage-prod.js --remote --db australianrates_api --confirm-backup --backup-artifact artifacts\\api-prod-YYYYMMDDTHHMMSSZ.sql'
}

function formatCliError(reason: string, args: string[]): string {
  return `CLI preflight failed: ${reason}; received_argv=${JSON.stringify(args)}; example="${exampleCommand()}"`
}

function resolveBackupArtifact(value: string | undefined): string {
  const raw = String(value || '').trim()
  if (!raw) {
    throw new Error('--backup-artifact <path> is required')
  }
  const resolved = resolveCliPath(raw)
  if (!fs.existsSync(resolved)) {
    throw new Error(`backup artifact does not exist at ${resolved}`)
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error(`backup artifact is not a file at ${resolved}`)
  }
  return resolved
}

export function parseRepairRawLinkageProdConfig(args: string[]): RawLinkageRepairProdConfig {
  if (args.some((arg) => FORBIDDEN_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)))) {
    throw new Error(formatCliError('delete/mutate flags are forbidden for raw linkage repair tool', args))
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

  const apply = parsed.flags.has('--apply')
  const acknowledgeMutation = parsed.flags.has('--i-know-this-will-mutate-production')
  if (apply && !acknowledgeMutation) {
    throw new Error(formatCliError('--i-know-this-will-mutate-production is required when --apply is set', args))
  }

  return {
    db,
    remote: true,
    apply,
    acknowledgeMutation,
    confirmBackup: true,
    backupArtifact,
  }
}

const REPAIRABLE_BUCKET = 'likely_missing_raw_object_row'

function rawLinkagePlanBaseCte(): string {
  return `
WITH orphan_rows AS (
  SELECT rp.id, rp.source_type, rp.source_url, rp.content_hash, rp.r2_key, rp.fetched_at
  FROM raw_payloads rp
  LEFT JOIN raw_objects ro
    ON ro.content_hash = rp.content_hash
  WHERE ro.content_hash IS NULL
),
orphan_hashes AS (
  SELECT DISTINCT content_hash
  FROM orphan_rows
  WHERE content_hash IS NOT NULL AND TRIM(content_hash) != ''
),
payload_ranked AS (
  SELECT
    orw.content_hash,
    orw.source_type,
    orw.source_url,
    orw.r2_key,
    orw.fetched_at,
    orw.id,
    ROW_NUMBER() OVER (
      PARTITION BY orw.content_hash
      ORDER BY orw.fetched_at DESC, orw.id DESC
    ) AS row_num
  FROM orphan_rows orw
  WHERE orw.content_hash IS NOT NULL AND TRIM(orw.content_hash) != ''
),
payload_latest AS (
  SELECT
    content_hash,
    source_type,
    source_url,
    r2_key
  FROM payload_ranked
  WHERE row_num = 1
),
fetch_stats AS (
  SELECT
    fe.content_hash,
    COUNT(*) AS fetch_events_count,
    MAX(COALESCE(fe.body_bytes, 0)) AS max_body_bytes,
    MAX(COALESCE(NULLIF(json_extract(fe.response_headers_json, '$.\"content-type\"'), ''), NULLIF(json_extract(fe.response_headers_json, '$.\"Content-Type\"'), ''), '')) AS content_type_guess
  FROM fetch_events fe
  WHERE fe.content_hash IS NOT NULL AND TRIM(fe.content_hash) != ''
  GROUP BY fe.content_hash
),
normalized_object_hashes AS (
  SELECT LOWER(TRIM(ro.content_hash)) AS normalized_hash
  FROM raw_objects ro
  WHERE ro.content_hash IS NOT NULL AND TRIM(ro.content_hash) != ''
  GROUP BY LOWER(TRIM(ro.content_hash))
),
classified_hashes AS (
  SELECT
    oh.content_hash,
    COALESCE(pl.source_type, '') AS source_type,
    COALESCE(pl.source_url, '') AS first_source_url,
    COALESCE(pl.r2_key, '') AS r2_key,
    COALESCE(fs.fetch_events_count, 0) AS fetch_events_count,
    COALESCE(fs.max_body_bytes, 0) AS body_bytes,
    COALESCE(NULLIF(fs.content_type_guess, ''), 'application/octet-stream') AS content_type,
    CASE
      WHEN LOWER(COALESCE(pl.source_type, '')) = 'wayback_html'
        OR LOWER(COALESCE(pl.source_url, '')) LIKE '%web.archive.org%'
        THEN 'legacy_wayback_html'
      WHEN noh.normalized_hash IS NOT NULL
        THEN 'normalized_hash_match_existing_object'
      WHEN COALESCE(fs.fetch_events_count, 0) > 0
        AND COALESCE(fs.max_body_bytes, 0) > 0
        AND COALESCE(TRIM(pl.r2_key), '') != ''
        THEN 'likely_missing_raw_object_row'
      WHEN COALESCE(fs.fetch_events_count, 0) = 0
        THEN 'missing_fetch_event_metadata'
      ELSE 'other_source'
    END AS reason_bucket
  FROM orphan_hashes oh
  LEFT JOIN payload_latest pl
    ON pl.content_hash = oh.content_hash
  LEFT JOIN fetch_stats fs
    ON fs.content_hash = oh.content_hash
  LEFT JOIN normalized_object_hashes noh
    ON noh.normalized_hash = LOWER(TRIM(oh.content_hash))
),
insert_candidates AS (
  SELECT
    content_hash,
    source_type,
    first_source_url,
    r2_key,
    body_bytes,
    content_type,
    reason_bucket
  FROM classified_hashes
  WHERE reason_bucket = '${REPAIRABLE_BUCKET}'
)
`
}

export type RawLinkageProdRepairPlanSql = {
  plan_counts: string
  bucket_counts: string
  insert_candidates: string
  candidate_sample: string
}

export function buildRawLinkageProdRepairPlanSql(): RawLinkageProdRepairPlanSql {
  const cte = rawLinkagePlanBaseCte()
  const sql = {
    plan_counts: `
${cte}
SELECT
  (SELECT COUNT(*) FROM orphan_rows) AS orphan_count,
  (SELECT COUNT(*) FROM orphan_hashes) AS distinct_hashes_count,
  (SELECT COUNT(*) FROM insert_candidates) AS insert_candidates_count
`,
    bucket_counts: `
${cte}
SELECT
  reason_bucket AS bucket,
  COUNT(*) AS row_count
FROM classified_hashes
GROUP BY reason_bucket
ORDER BY row_count DESC, bucket ASC
LIMIT 20
`,
    insert_candidates: `
${cte}
SELECT
  content_hash,
  source_type,
  first_source_url,
  r2_key,
  body_bytes,
  content_type,
  reason_bucket
FROM insert_candidates
ORDER BY content_hash ASC
`,
    candidate_sample: `
${cte}
SELECT
  content_hash,
  source_type,
  first_source_url,
  r2_key,
  body_bytes,
  content_type,
  reason_bucket
FROM insert_candidates
ORDER BY content_hash ASC
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

export function buildRawLinkageProdRepairApplySql(): { insert_repairable_raw_objects: string } {
  const cte = rawLinkagePlanBaseCte()
  return {
    insert_repairable_raw_objects: `
${cte}
INSERT OR IGNORE INTO raw_objects (
  content_hash,
  source_type,
  first_source_url,
  body_bytes,
  content_type,
  r2_key,
  created_at
)
SELECT
  content_hash,
  source_type,
  first_source_url,
  body_bytes,
  content_type,
  r2_key,
  CURRENT_TIMESTAMP
FROM insert_candidates
`,
  }
}

export function isSafeRawLinkageInsertSql(sql: string): boolean {
  const normalized = String(sql || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  if (FORBIDDEN_MUTATION_SQL.test(normalized)) return false
  if (!/^WITH\b.*\bINSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+raw_objects\b/i.test(normalized)) return false
  for (const match of normalized.matchAll(/\bINSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+([a-zA-Z0-9_]+)/gi)) {
    if (String(match[1] || '').toLowerCase() !== 'raw_objects') return false
  }
  return true
}

function stableHash(values: unknown[]): string {
  const normalized = values.map((value) => JSON.stringify(value)).sort((a, b) => a.localeCompare(b))
  return crypto.createHash('sha256').update(normalized.join('\n')).digest('hex')
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function requiredNumberField(row: Record<string, unknown> | undefined, field: string): number {
  if (!row || !(field in row)) {
    throw new Error(`Expected numeric field "${field}" missing in plan result row.`)
  }
  return asNumber(row[field])
}

function toExecutedCommand(
  label: string,
  rawResult: unknown,
): ExecutedCommand {
  const typed = rawResult as {
    exitCode?: number
    attempt?: { mode?: '--file' | '--command'; executable?: string }
  }
  return {
    label,
    mode: typed.attempt?.mode || '--file',
    executable: typed.attempt?.executable || '',
    exit_code: Number.isFinite(typed.exitCode as number) ? Number(typed.exitCode) : 1,
  }
}

function runPlanQuery(
  db: string,
  sql: string,
  label: string,
  expectedAlias: string,
  spawnRunner: SpawnRunner,
): {
  rows: Array<Record<string, unknown>>
  command: string
  attempt?: unknown
  retry?: unknown
  exitCode: number
} {
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
  return {
    rows: rawResult.payload?.[0]?.results ?? [],
    command: rawResult.command,
    attempt: rawResult.attempt,
    retry: rawResult.retry,
    exitCode: rawResult.exitCode,
  }
}

function collectPlanSnapshot(
  db: string,
  spawnRunner: SpawnRunner,
  labels: { prefix: string },
): PlanSnapshot & { retries: unknown[] } {
  const sql = buildRawLinkageProdRepairPlanSql()
  const counts = runPlanQuery(db, sql.plan_counts, `${labels.prefix}-counts`, 'orphan_count', spawnRunner)
  const buckets = runPlanQuery(db, sql.bucket_counts, `${labels.prefix}-buckets`, 'bucket', spawnRunner)
  const candidates = runPlanQuery(db, sql.insert_candidates, `${labels.prefix}-candidates`, 'content_hash', spawnRunner)
  const sample = runPlanQuery(db, sql.candidate_sample, `${labels.prefix}-sample`, 'content_hash', spawnRunner)

  const countRow = counts.rows[0]
  const orphanCount = requiredNumberField(countRow, 'orphan_count')
  const distinctHashesCount = requiredNumberField(countRow, 'distinct_hashes_count')
  const insertCandidateCount = requiredNumberField(countRow, 'insert_candidates_count')
  const candidateRows = candidates.rows.map((row) => ({
    content_hash: String(row.content_hash || ''),
    source_type: String(row.source_type || ''),
    first_source_url: String(row.first_source_url || ''),
    r2_key: String(row.r2_key || ''),
    body_bytes: asNumber(row.body_bytes),
    content_type: String(row.content_type || 'application/octet-stream'),
    reason_bucket: String(row.reason_bucket || ''),
  }))
  const planHash = stableHash(candidateRows.map((row) => [
    row.content_hash,
    row.source_type,
    row.first_source_url,
    row.r2_key,
    row.body_bytes,
    row.content_type,
    row.reason_bucket,
  ]))

  const bucketCounts = buckets.rows.map((row) => ({
    bucket: String(row.bucket || 'unknown'),
    row_count: asNumber(row.row_count),
  }))
  const candidateSample = sample.rows.map((row) => ({
    content_hash: String(row.content_hash || ''),
    source_type: String(row.source_type || ''),
    first_source_url: String(row.first_source_url || ''),
    r2_key: String(row.r2_key || ''),
    body_bytes: asNumber(row.body_bytes),
    content_type: String(row.content_type || 'application/octet-stream'),
    reason_bucket: String(row.reason_bucket || ''),
  }))

  return {
    orphanCount,
    distinctHashesCount,
    insertCandidateCount,
    bucketCounts,
    candidateRows,
    candidateSample,
    planHash,
    executedCommands: [
      toExecutedCommand(`${labels.prefix}-counts`, counts),
      toExecutedCommand(`${labels.prefix}-buckets`, buckets),
      toExecutedCommand(`${labels.prefix}-candidates`, candidates),
      toExecutedCommand(`${labels.prefix}-sample`, sample),
    ],
    retries: [counts.retry, buckets.retry, candidates.retry, sample.retry].filter(Boolean),
  }
}

function changesFromPayload(payload: unknown): number {
  const typed = payload as Array<{ meta?: { changes?: unknown } }>
  return asNumber(typed?.[0]?.meta?.changes)
}

function runApplyInsert(
  db: string,
  spawnRunner: SpawnRunner,
): {
  insertedCount: number
  command: string
  executed: ExecutedCommand
} {
  const applySql = buildRawLinkageProdRepairApplySql()
  if (!isSafeRawLinkageInsertSql(applySql.insert_repairable_raw_objects)) {
    throw new Error('Apply SQL failed safety validation: only INSERT INTO raw_objects is allowed.')
  }

  const run = runD1SqlFile(
    db,
    true,
    applySql.insert_repairable_raw_objects,
    'apply-insert-raw-objects',
    { spawnRunner },
  ) as unknown as {
    command: string
    exitCode: number
    payload: Array<{ meta?: { changes?: number } }>
    attempt?: { mode?: '--file' | '--command'; executable?: string }
  }

  return {
    insertedCount: changesFromPayload(run.payload),
    command: run.command,
    executed: {
      label: 'apply-insert-raw-objects',
      mode: run.attempt?.mode || '--file',
      executable: run.attempt?.executable || '',
      exit_code: run.exitCode,
    },
  }
}

function plansMatch(left: PlanSnapshot, right: PlanSnapshot): boolean {
  return left.orphanCount === right.orphanCount
    && left.distinctHashesCount === right.distinctHashesCount
    && left.insertCandidateCount === right.insertCandidateCount
    && left.planHash === right.planHash
}

export function runRawLinkageProdRepair(
  args: string[],
  spawnRunner: SpawnRunner = spawnSync,
): Record<string, unknown> {
  const config = parseRepairRawLinkageProdConfig(args)
  const mode: 'plan' | 'apply' = config.apply ? 'apply' : 'plan'

  const baseline = collectPlanSnapshot(config.db, spawnRunner, { prefix: 'plan' })
  const retries = [...baseline.retries]
  const executedCommands = [...baseline.executedCommands]

  if (!config.apply) {
    return {
      ok: true,
      phase: 'plan',
      db: config.db,
      backup_artifact_abs: config.backupArtifact,
      mode,
      orphan_before: baseline.orphanCount,
      orphan_after: baseline.orphanCount,
      inserted_raw_objects_count: 0,
      distinct_hashes_count: baseline.distinctHashesCount,
      insert_candidates_count: baseline.insertCandidateCount,
      top_bucket_counts: baseline.bucketCounts,
      candidate_sample: baseline.candidateSample,
      plan_hash: baseline.planHash,
      verify_hash: baseline.planHash,
      executed_commands: executedCommands,
      retry: retries.length > 0 ? retries : null,
      exit_code: 0,
    }
  }

  const fresh = collectPlanSnapshot(config.db, spawnRunner, { prefix: 'preapply-fresh' })
  executedCommands.push(...fresh.executedCommands)
  retries.push(...fresh.retries)

  if (!plansMatch(baseline, fresh)) {
    throw new Error(
      `Precondition failed: plan changed before apply; baseline_hash=${baseline.planHash}; fresh_hash=${fresh.planHash}; baseline_counts=${JSON.stringify({
        orphan: baseline.orphanCount,
        distinct: baseline.distinctHashesCount,
        insert: baseline.insertCandidateCount,
      })}; fresh_counts=${JSON.stringify({
        orphan: fresh.orphanCount,
        distinct: fresh.distinctHashesCount,
        insert: fresh.insertCandidateCount,
      })}`,
    )
  }

  const apply = runApplyInsert(config.db, spawnRunner)
  executedCommands.push(apply.executed)

  const post = collectPlanSnapshot(config.db, spawnRunner, { prefix: 'postapply-verify' })
  executedCommands.push(...post.executedCommands)
  retries.push(...post.retries)

  return {
    ok: true,
    phase: 'apply',
    db: config.db,
    backup_artifact_abs: config.backupArtifact,
    mode,
    orphan_before: baseline.orphanCount,
    orphan_after: post.orphanCount,
    inserted_raw_objects_count: apply.insertedCount,
    distinct_hashes_count: post.distinctHashesCount,
    insert_candidates_count_before: baseline.insertCandidateCount,
    insert_candidates_count_after: post.insertCandidateCount,
    top_bucket_counts_before: baseline.bucketCounts,
    top_bucket_counts_after: post.bucketCounts,
    plan_hash: baseline.planHash,
    verify_hash: post.planHash,
    executed_commands: executedCommands,
    retry: retries.length > 0 ? retries : null,
    exit_code: 0,
  }
}

type RawLinkageProdCliOptions = {
  spawnRunner?: SpawnRunner
  stdoutWrite?: (text: string) => void
  argvForLog?: string[]
}

export function runRawLinkageProdRepairCli(args: string[], options?: RawLinkageProdCliOptions): number {
  const stdoutWrite = options?.stdoutWrite ?? ((text: string) => process.stdout.write(text))
  const spawnRunner = options?.spawnRunner ?? spawnSync
  const argvForLog = options?.argvForLog ?? process.argv
  try {
    const report = runRawLinkageProdRepair(args, spawnRunner)
    stdoutWrite(`${JSON.stringify(report)}\n`)
    return 0
  } catch (error) {
    const failure = {
      ok: false,
      phase: args.includes('--apply') ? 'apply' : 'plan',
      db: String((args[args.indexOf('--db') + 1] || '')).trim() || null,
      mode: args.includes('--apply') ? 'apply' : 'plan',
      error: (error as Error)?.message || String(error),
      command_line: argvForLog.join(' '),
      exit_code: 1,
    }
    stdoutWrite(`${JSON.stringify(failure)}\n`)
    return 1
  }
}

export function main(args: string[]): void {
  process.exitCode = runRawLinkageProdRepairCli(args)
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2))
}
