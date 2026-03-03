import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
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
  acknowledgeMutation: true
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

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

function escapeForCommand(sql: string): string {
  return normalizeSql(sql).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
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

  const acknowledgeMutation = hasFlag(args, '--i-know-this-will-mutate-production')
  if (!acknowledgeMutation) {
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
    apply: hasFlag(args, '--apply'),
    deleteExtras: hasFlag(args, '--delete-extras'),
    acknowledgeMutation: true,
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

function wranglerCommandString(db: string, sql: string): string {
  return `wrangler d1 execute ${db} --remote --json --command "${escapeForCommand(sql)}"`
}

function executeRemoteSql(db: string, sql: string): ExecuteCommandResult {
  const args = ['wrangler', 'd1', 'execute', db, '--remote', '--json', '--command', sql]
  const result = spawnSync('npx', args, {
    encoding: 'utf8',
    shell: false,
  })

  if (result.error) {
    throw new Error(`Failed to run wrangler command: ${result.error.message}`)
  }

  const exitCode = typeof result.status === 'number' ? result.status : 1
  if (exitCode !== 0) {
    throw new Error(
      `Wrangler command failed (${exitCode}): ${wranglerCommandString(db, sql)}\n${String(result.stderr || '').trim()}`,
    )
  }

  const stdout = String(result.stdout || '')
  return {
    command: wranglerCommandString(db, sql),
    exitCode,
    payload: parseWranglerJsonOutput(stdout),
  }
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

  const currentOrphan = executeRemoteSql(config.db, planSql.current_orphan_count)
  const plannedCounts = executeRemoteSql(config.db, planSql.planned_counts)

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
    const insertResult = executeRemoteSql(config.db, applySql.insert_missing)
    const executedCommands = report.executed_commands as Array<{ command: string; exit_code: number }>
    executedCommands.push({ command: insertResult.command, exit_code: insertResult.exitCode })

    let deletedRows = 0
    if (config.deleteExtras) {
      const deleteResult = executeRemoteSql(config.db, applySql.delete_safe_extras)
      deletedRows = changesFromPayload(deleteResult.payload)
      executedCommands.push({ command: deleteResult.command, exit_code: deleteResult.exitCode })
    }

    const postVerify = executeRemoteSql(config.db, planSql.current_orphan_count)
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
