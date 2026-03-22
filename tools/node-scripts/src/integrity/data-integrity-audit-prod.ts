import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  executeRemoteSqlCommandForTest,
  executeRemoteSqlWithFallbackForTest,
  isSafePlanSql,
  type SpawnRunner,
} from './repair-presence-prod'
import { resolveCliPath } from './cli-path'

const ALLOWED_DB = 'australianrates_api'
const BOOLEAN_OPTIONS = new Set(['--remote'])
const VALUE_OPTIONS = new Set(['--db', '--output-json', '--output-md'])
const DEFAULT_ORIGIN = 'https://www.australianrates.com'
const SAMPLE_LIMIT = 20
const QUICK_CHECK_RE = /^PRAGMA\s+quick_check\s*;?$/i
const FOREIGN_KEY_CHECK_RE = /^PRAGMA\s+foreign_key_check\s*;?$/i

type AuditSeverity = 'invalid' | 'suspicious' | 'indicator'
type AuditScope = 'historical' | 'latest' | 'metadata'

type AuditConfig = {
  db: string
  remote: true
  outputJson: string
  outputMd: string
  origin: string
}

type ExecutedCommand = {
  label: string
  command: string
  exit_code: number
}

type AuditFinding = {
  check: string
  severity: AuditSeverity
  scope: AuditScope
  passed: boolean
  count?: number
  pair_count?: number
  detail?: Record<string, unknown>
  sample?: Array<Record<string, unknown>>
  interpretation: string
}

type DataIntegrityReport = {
  ok: boolean
  generated_at: string
  target_db: string
  origin: string
  executed_commands: ExecutedCommand[]
  retry: unknown[] | null
  findings: AuditFinding[]
  summary: {
    total_checks: number
    passed: number
    failed: number
    invalid_findings: number
    suspicious_findings: number
    indicator_findings: number
    execution_errors: number
  }
}

type SqlSpec = {
  label: string
  sql: string
  expectedAlias?: string
  runner?: 'command' | 'fallback'
}

type QuantifiedCheckSpec = {
  check: string
  severity: Exclude<AuditSeverity, 'indicator'>
  scope: AuditScope
  count: SqlSpec
  sample?: SqlSpec
  interpretation: (row: Record<string, unknown>) => string
  passed: (row: Record<string, unknown>) => boolean
  detail?: (row: Record<string, unknown>) => Record<string, unknown>
}

type ParsedArgs = {
  flags: Set<string>
  values: Map<string, string>
  positionals: string[]
}

type SqlRunContext = {
  config: AuditConfig
  spawnRunner: SpawnRunner
  executedCommands: ExecutedCommand[]
  retries: unknown[]
  findings: AuditFinding[]
}

type AdminAuditResponse = {
  ok: boolean
  tables?: Array<{ name: string; row_count: number }>
}

function parseCliArgs(args: string[]): ParsedArgs {
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
      if (inlineValue === undefined || inlineValue === 'true' || inlineValue === '1') flags.add(key)
      continue
    }
    if (VALUE_OPTIONS.has(key)) {
      let value = inlineValue
      if (value === undefined) {
        value = args[i + 1]
        i += 1
      }
      if (!value || value.startsWith('--')) throw new Error(`option ${key} requires a value`)
      values.set(key, value)
      continue
    }
    throw new Error(`unknown option ${key}`)
  }
  return { flags, values, positionals }
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultOutput(kind: 'json' | 'md'): string {
  const ext = kind === 'json' ? 'json' : 'md'
  return path.resolve(os.tmpdir(), `production-d1-validation-${todayStamp()}.${ext}`)
}

function resolveOrigin(): string {
  const raw = String(process.env.API_BASE || process.env.ADMIN_DB_STATS_ORIGIN || DEFAULT_ORIGIN).trim()
  return new URL(raw).origin
}

function parseConfig(args: string[]): AuditConfig {
  const parsed = parseCliArgs(args)
  if (parsed.positionals.length > 0) {
    throw new Error(`CLI: unexpected positional arguments: ${parsed.positionals.join(' ')}`)
  }
  if (!parsed.flags.has('--remote')) throw new Error('CLI: --remote is required')
  const db = String(parsed.values.get('--db') || '').trim()
  if (db !== ALLOWED_DB) throw new Error(`CLI: only --db ${ALLOWED_DB} is allowed`)
  return {
    db,
    remote: true,
    outputJson: resolveCliPath(parsed.values.get('--output-json') || defaultOutput('json')),
    outputMd: resolveCliPath(parsed.values.get('--output-md') || defaultOutput('md')),
    origin: resolveOrigin(),
  }
}

function ensureOutputPath(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function str(value: unknown): string {
  return value == null ? '' : String(value)
}

function isAllowedAuditSql(sql: string): boolean {
  const trimmed = String(sql || '').trim()
  return QUICK_CHECK_RE.test(trimmed) || FOREIGN_KEY_CHECK_RE.test(trimmed) || isSafePlanSql(trimmed)
}

function latestWhere(tableAlias = ''): string {
  const prefix = tableAlias ? `${tableAlias}.` : ''
  return `COALESCE(${prefix}is_removed, 0) = 0`
}

function homeLvrRankExpr(column = 'lvr_tier'): string {
  return `CASE ${column}
    WHEN 'lvr_=60%' THEN 1
    WHEN 'lvr_60-70%' THEN 2
    WHEN 'lvr_70-80%' THEN 3
    WHEN 'lvr_80-85%' THEN 4
    WHEN 'lvr_85-90%' THEN 5
    WHEN 'lvr_90-95%' THEN 6
  END`
}

function createExecutionErrorFinding(check: string, scope: AuditScope, error: unknown): AuditFinding {
  return {
    check,
    severity: 'suspicious',
    scope,
    passed: false,
    detail: { error: error instanceof Error ? error.message : String(error), execution_error: true },
    interpretation: 'The audit query did not complete successfully; this is an audit execution problem rather than a validated data result.',
  }
}

function recordCommand(context: SqlRunContext, label: string, command: string, exitCode: number): void {
  context.executedCommands.push({ label, command, exit_code: exitCode })
}

function runSql(context: SqlRunContext, spec: SqlSpec): Array<Record<string, unknown>> {
  if (!isAllowedAuditSql(spec.sql)) {
    throw new Error(`Unsafe SQL for ${spec.label}`)
  }
  const runner = spec.runner || 'command'
  const result =
    runner === 'fallback'
      ? executeRemoteSqlWithFallbackForTest(context.config.db, spec.sql, context.spawnRunner, {
          phase: 'plan',
          expectedAlias: spec.expectedAlias,
        })
      : executeRemoteSqlCommandForTest(context.config.db, spec.sql, context.spawnRunner)
  recordCommand(context, spec.label, result.command, result.exitCode)
  if (result.retry) context.retries.push(result.retry)
  return result.payload?.[0]?.results ?? []
}

async function fetchRowCountSnapshot(context: SqlRunContext): Promise<void> {
  const token = String(
    process.env.ADMIN_API_TOKEN ||
      process.env.ADMIN_API_TOKENS?.split(',')[0]?.trim() ||
      process.env.ADMIN_TEST_TOKEN ||
      process.env.LOCAL_ADMIN_API_TOKEN ||
      '',
  ).trim()
  const url = `${context.config.origin}/api/home-loan-rates/admin/db/audit`
  if (!token) {
    context.findings.push({
      check: 'table_row_counts_snapshot',
      severity: 'suspicious',
      scope: 'metadata',
      passed: false,
      detail: { error: 'Missing ADMIN_API_TOKEN for admin db/audit request.' },
      interpretation: 'The row-count snapshot could not be collected because the admin API token is missing.',
    })
    recordCommand(context, 'table_row_counts_snapshot', `GET ${url}`, 1)
    return
  }

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
  } catch (error) {
    context.findings.push(createExecutionErrorFinding('table_row_counts_snapshot', 'metadata', error))
    recordCommand(context, 'table_row_counts_snapshot', `GET ${url}`, 1)
    return
  }

  recordCommand(context, 'table_row_counts_snapshot', `GET ${url}`, response.ok ? 0 : 1)
  if (!response.ok) {
    context.findings.push({
      check: 'table_row_counts_snapshot',
      severity: 'suspicious',
      scope: 'metadata',
      passed: false,
      detail: { http_status: response.status, http_status_text: response.statusText },
      interpretation: 'The admin db/audit endpoint did not return a successful response, so the full table row snapshot is unavailable.',
    })
    return
  }

  const payload = (await response.json()) as AdminAuditResponse
  const tables = Array.isArray(payload.tables) ? payload.tables : []
  const totalRows = tables.reduce((sum, table) => sum + Math.max(0, Number(table.row_count || 0)), 0)
  context.findings.push({
    check: 'table_row_counts_snapshot',
    severity: 'indicator',
    scope: 'metadata',
    passed: true,
    detail: {
      table_count: tables.length,
      total_rows: totalRows,
      tables,
    },
    interpretation: 'Full user-table row counts were captured from the production admin audit endpoint.',
  })
}

function addCountSampleCheck(
  context: SqlRunContext,
  input: {
    check: string
    severity: Exclude<AuditSeverity, 'indicator'>
    scope: AuditScope
    countSql: SqlSpec
    sampleSql?: SqlSpec
    interpretation: (count: number) => string
  },
): void {
  try {
    const rows = runSql(context, input.countSql)
    const count = num(rows[0]?.affected_rows)
    let sample: Array<Record<string, unknown>> | undefined
    if (count > 0 && input.sampleSql) sample = runSql(context, input.sampleSql)
    context.findings.push({
      check: input.check,
      severity: input.severity,
      scope: input.scope,
      passed: count === 0,
      count,
      sample,
      detail: { affected_rows: count },
      interpretation: input.interpretation(count),
    })
  } catch (error) {
    context.findings.push(createExecutionErrorFinding(input.check, input.scope, error))
  }
}

function addQuickCheck(context: SqlRunContext): void {
  try {
    const rows = runSql(context, {
      label: 'sqlite_quick_check',
      sql: 'PRAGMA quick_check;',
      runner: 'command',
    })
    const results = rows.map((row) => str(row.quick_check || row.integrity_check)).filter(Boolean)
    const isOk = results.length > 0 && results.every((value) => value.toLowerCase() === 'ok')
    context.findings.push({
      check: 'sqlite_quick_check',
      severity: 'invalid',
      scope: 'metadata',
      passed: isOk,
      count: results.length,
      detail: { results },
      interpretation: isOk
        ? 'SQLite quick_check returned ok.'
        : 'SQLite quick_check returned non-ok results, which indicates structural database corruption or internal consistency issues.',
    })
  } catch (error) {
    context.findings.push(createExecutionErrorFinding('sqlite_quick_check', 'metadata', error))
  }
}

function addForeignKeyCheck(context: SqlRunContext): void {
  try {
    const rows = runSql(context, {
      label: 'sqlite_foreign_key_check',
      sql: 'PRAGMA foreign_key_check;',
      runner: 'command',
    })
    const count = rows.length
    context.findings.push({
      check: 'sqlite_foreign_key_check',
      severity: 'invalid',
      scope: 'metadata',
      passed: count === 0,
      count,
      sample: count > 0 ? rows.slice(0, SAMPLE_LIMIT) : undefined,
      detail: { violation_count: count },
      interpretation:
        count === 0
          ? 'SQLite foreign_key_check returned no violations.'
          : 'SQLite foreign_key_check returned violations, which indicates broken referential integrity.',
    })
  } catch (error) {
    context.findings.push(createExecutionErrorFinding('sqlite_foreign_key_check', 'metadata', error))
  }
}

function addDatasetStats(context: SqlRunContext): void {
  try {
    const rows = runSql(context, {
      label: 'dataset_stats',
      sql: `SELECT 'home_loans' AS dataset, COUNT(*) AS total_rows, COUNT(DISTINCT series_key) AS distinct_series FROM historical_loan_rates
UNION ALL SELECT 'savings', COUNT(*), COUNT(DISTINCT series_key) FROM historical_savings_rates
UNION ALL SELECT 'term_deposits', COUNT(*), COUNT(DISTINCT series_key) FROM historical_term_deposit_rates`,
      runner: 'fallback',
      expectedAlias: 'dataset',
    })
    context.findings.push({
      check: 'dataset_stats',
      severity: 'indicator',
      scope: 'metadata',
      passed: true,
      detail: { datasets: rows },
      interpretation: 'Historical dataset row counts and distinct series counts were captured for context.',
    })
  } catch (error) {
    context.findings.push(createExecutionErrorFinding('dataset_stats', 'metadata', error))
  }
}

function addProductKeyConsistency(context: SqlRunContext): void {
  try {
    const rows = runSql(context, {
      label: 'product_key_consistency',
      sql: `SELECT 'home_loans' AS dataset,
  SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END) AS missing_series_key,
  SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure) THEN 1 ELSE 0 END) AS mismatched_series_key
FROM historical_loan_rates
UNION ALL
SELECT 'savings',
  SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END),
  SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier) THEN 1 ELSE 0 END)
FROM historical_savings_rates
UNION ALL
SELECT 'term_deposits',
  SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END),
  SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier || '|' || interest_payment) THEN 1 ELSE 0 END)
FROM historical_term_deposit_rates`,
      runner: 'fallback',
      expectedAlias: 'dataset',
    })
    const missing = rows.reduce((sum, row) => sum + num(row.missing_series_key), 0)
    const mismatched = rows.reduce((sum, row) => sum + num(row.mismatched_series_key), 0)
    context.findings.push({
      check: 'product_key_consistency',
      severity: 'invalid',
      scope: 'historical',
      passed: missing === 0 && mismatched === 0,
      count: missing + mismatched,
      detail: {
        missing_series_key_total: missing,
        mismatched_series_key_total: mismatched,
        by_dataset: rows,
      },
      interpretation:
        missing === 0 && mismatched === 0
          ? 'All historical rows have series_key values aligned with the canonical product-key expression.'
          : 'Some historical rows have missing or mismatched series_key values, which breaks canonical longitudinal identity.',
    })
  } catch (error) {
    context.findings.push(createExecutionErrorFinding('product_key_consistency', 'historical', error))
  }
}

function addRunsWithNoOutputs(context: SqlRunContext): void {
  const runsCte = `WITH run_outputs AS (
  SELECT rr.run_id, rr.run_type, rr.run_source, rr.status, rr.started_at,
    (SELECT COUNT(*) FROM historical_loan_rates hl WHERE hl.run_id = rr.run_id) AS home_rows,
    (SELECT COUNT(*) FROM historical_savings_rates hs WHERE hs.run_id = rr.run_id) AS savings_rows,
    (SELECT COUNT(*) FROM historical_term_deposit_rates ht WHERE ht.run_id = rr.run_id) AS td_rows
  FROM run_reports rr
)`
  try {
    const rows = runSql(context, {
      label: 'runs_with_no_outputs_count',
      sql: `${runsCte}
SELECT COUNT(*) AS affected_rows
FROM run_outputs
WHERE (home_rows + savings_rows + td_rows) = 0`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    })
    const count = num(rows[0]?.affected_rows)
    let sample: Array<Record<string, unknown>> | undefined
    if (count > 0) {
      sample = runSql(context, {
        label: 'runs_with_no_outputs_sample',
        sql: `${runsCte}
SELECT run_id, run_type, run_source, status, started_at, home_rows, savings_rows, td_rows
FROM run_outputs
WHERE (home_rows + savings_rows + td_rows) = 0
ORDER BY started_at DESC
LIMIT ${SAMPLE_LIMIT}`,
        runner: 'command',
      })
    }
    context.findings.push({
      check: 'runs_with_no_outputs',
      severity: 'suspicious',
      scope: 'metadata',
      passed: count === 0,
      count,
      sample,
      detail: { affected_rows: count },
      interpretation:
        count === 0
          ? 'All run_reports rows have at least one corresponding output row.'
          : 'Some run_reports rows show zero outputs across all historical datasets; these runs should be reviewed as suspicious operational anomalies.',
    })
  } catch (error) {
    context.findings.push(createExecutionErrorFinding('runs_with_no_outputs', 'metadata', error))
  }
}

function addDuplicateChecks(context: SqlRunContext): void {
  const specs: Array<{ check: string; sql: string }> = [
    {
      check: 'exact_duplicate_rows_home_loans',
      sql: `WITH g AS (
  SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n
  FROM historical_loan_rates
  GROUP BY series_key, collection_date, run_id, interest_rate
  HAVING COUNT(*) > 1
)
SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS affected_rows FROM g`,
    },
    {
      check: 'exact_duplicate_rows_savings',
      sql: `WITH g AS (
  SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n
  FROM historical_savings_rates
  GROUP BY series_key, collection_date, run_id, interest_rate
  HAVING COUNT(*) > 1
)
SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS affected_rows FROM g`,
    },
    {
      check: 'exact_duplicate_rows_term_deposits',
      sql: `WITH g AS (
  SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n
  FROM historical_term_deposit_rates
  GROUP BY series_key, collection_date, run_id, interest_rate
  HAVING COUNT(*) > 1
)
SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS affected_rows FROM g`,
    },
  ]

  for (const spec of specs) {
    try {
      const rows = runSql(context, {
        label: `${spec.check}_count`,
        sql: spec.sql,
        expectedAlias: 'affected_rows',
        runner: 'fallback',
      })
      context.findings.push({
        check: spec.check,
        severity: 'invalid',
        scope: 'historical',
        passed: num(rows[0]?.affected_rows) === 0,
        count: num(rows[0]?.affected_rows),
        detail: { duplicate_groups: num(rows[0]?.duplicate_groups), affected_rows: num(rows[0]?.affected_rows) },
        interpretation:
          num(rows[0]?.affected_rows) === 0
            ? 'No exact duplicate historical rows were found for this dataset.'
            : 'Exact duplicate historical rows were found, which indicates invalid duplicate data.',
      })
    } catch (error) {
      context.findings.push(createExecutionErrorFinding(spec.check, 'historical', error))
    }
  }
}

function addBoundChecks(context: SqlRunContext): void {
  const specs: Array<{ check: string; sql: string; bounds: string }> = [
    {
      check: 'out_of_range_rates_home_loans',
      sql: `SELECT COUNT(*) AS affected_rows FROM historical_loan_rates WHERE interest_rate < 0.5 OR interest_rate > 25`,
      bounds: '0.5-25',
    },
    {
      check: 'out_of_range_rates_savings',
      sql: `SELECT COUNT(*) AS affected_rows FROM historical_savings_rates WHERE interest_rate < 0 OR interest_rate > 15`,
      bounds: '0-15',
    },
    {
      check: 'out_of_range_rates_term_deposits',
      sql: `SELECT COUNT(*) AS affected_rows FROM historical_term_deposit_rates WHERE interest_rate < 0 OR interest_rate > 15`,
      bounds: '0-15',
    },
  ]
  for (const spec of specs) {
    addCountSampleCheck(context, {
      check: spec.check,
      severity: 'invalid',
      scope: 'historical',
      countSql: {
        label: `${spec.check}_count`,
        sql: spec.sql,
        expectedAlias: 'affected_rows',
        runner: 'fallback',
      },
      interpretation: (count) =>
        count === 0
          ? `No historical rows were found outside the ${spec.bounds}% bounds.`
          : `Historical rows were found outside the ${spec.bounds}% bounds, which should be treated as invalid data.`,
    })
    const finding = context.findings[context.findings.length - 1]
    if (finding?.check === spec.check && finding.detail) finding.detail.bounds = spec.bounds
  }
}

function addNullChecks(context: SqlRunContext): void {
  const specs: Array<{ check: string; sql: string }> = [
    {
      check: 'null_required_fields_home_loans',
      sql: `SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name, '')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id, '')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date, '')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS affected_rows
FROM historical_loan_rates`,
    },
    {
      check: 'null_required_fields_savings',
      sql: `SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name, '')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id, '')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date, '')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS affected_rows
FROM historical_savings_rates`,
    },
    {
      check: 'null_required_fields_term_deposits',
      sql: `SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name, '')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id, '')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date, '')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS affected_rows
FROM historical_term_deposit_rates`,
    },
  ]
  for (const spec of specs) {
    addCountSampleCheck(context, {
      check: spec.check,
      severity: 'invalid',
      scope: 'historical',
      countSql: {
        label: `${spec.check}_count`,
        sql: spec.sql,
        expectedAlias: 'affected_rows',
        runner: 'fallback',
      },
      interpretation: (count) =>
        count === 0
          ? 'No historical rows were found with null or empty required fields.'
          : 'Historical rows were found with null or empty required fields, which should be treated as invalid data.',
    })
  }
}

function addOrphanLatestChecks(context: SqlRunContext): void {
  const specs: Array<{ check: string; sql: string }> = [
    {
      check: 'orphan_latest_home_loan_series',
      sql: `SELECT COUNT(*) AS affected_rows
FROM latest_home_loan_series l
LEFT JOIN (SELECT DISTINCT series_key FROM historical_loan_rates) h ON h.series_key = l.series_key
WHERE h.series_key IS NULL`,
    },
    {
      check: 'orphan_latest_savings_series',
      sql: `SELECT COUNT(*) AS affected_rows
FROM latest_savings_series l
LEFT JOIN (SELECT DISTINCT series_key FROM historical_savings_rates) h ON h.series_key = l.series_key
WHERE h.series_key IS NULL`,
    },
    {
      check: 'orphan_latest_td_series',
      sql: `SELECT COUNT(*) AS affected_rows
FROM latest_td_series l
LEFT JOIN (SELECT DISTINCT series_key FROM historical_term_deposit_rates) h ON h.series_key = l.series_key
WHERE h.series_key IS NULL`,
    },
  ]
  for (const spec of specs) {
    addCountSampleCheck(context, {
      check: spec.check,
      severity: 'invalid',
      scope: 'latest',
      countSql: {
        label: `${spec.check}_count`,
        sql: spec.sql,
        expectedAlias: 'affected_rows',
        runner: 'fallback',
      },
      interpretation: (count) =>
        count === 0
          ? 'No orphan latest-series rows were found for this dataset.'
          : 'Latest-series rows were found without a matching historical series_key, which is invalid longitudinal linkage.',
    })
  }
}

function addFreshnessIndicator(context: SqlRunContext): void {
  try {
    const rows = runSql(context, {
      label: 'latest_vs_global_freshness',
      sql: `WITH dataset_latest AS (
  SELECT 'home_loans' AS dataset, MAX(collection_date) AS global_latest,
    MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest
  FROM historical_loan_rates
  UNION ALL
  SELECT 'savings', MAX(collection_date),
    MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END)
  FROM historical_savings_rates
  UNION ALL
  SELECT 'term_deposits', MAX(collection_date),
    MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END)
  FROM historical_term_deposit_rates
)
SELECT dataset, global_latest, scheduled_latest,
  CASE
    WHEN global_latest IS NULL OR scheduled_latest IS NULL THEN NULL
    WHEN global_latest = scheduled_latest THEN 0
    ELSE 1
  END AS latest_global_mismatch
FROM dataset_latest
ORDER BY dataset`,
      expectedAlias: 'dataset',
      runner: 'fallback',
    })
    const mismatchCount = rows.filter((row) => num(row.latest_global_mismatch) === 1).length
    context.findings.push({
      check: 'latest_vs_global_freshness',
      severity: 'indicator',
      scope: 'metadata',
      passed: true,
      detail: {
        mismatch_dataset_count: mismatchCount,
        datasets: rows,
      },
      interpretation: 'Global latest dates and scheduled latest dates were captured to show current production freshness.',
    })
  } catch (error) {
    context.findings.push(createExecutionErrorFinding('latest_vs_global_freshness', 'metadata', error))
  }
}

function homeComparisonRateCheck(table: string, scope: AuditScope, activeOnly: boolean): QuantifiedCheckSpec {
  const whereParts = ['comparison_rate IS NOT NULL', 'comparison_rate + 0.000001 < interest_rate']
  if (activeOnly) whereParts.push(latestWhere())
  const where = whereParts.join(' AND ')
  return {
    check: `${scope}_home_comparison_rate_below_interest`,
    severity: 'invalid',
    scope,
    count: {
      label: `${scope}_home_comparison_rate_below_interest_count`,
      sql: `SELECT COUNT(*) AS affected_rows FROM ${table} WHERE ${where}`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sample: {
      label: `${scope}_home_comparison_rate_below_interest_sample`,
      sql: `SELECT bank_name, collection_date, product_id, product_name, security_purpose, repayment_type,
  rate_structure, lvr_tier, feature_set, has_offset_account, interest_rate, comparison_rate,
  ROUND(interest_rate - comparison_rate, 4) AS rate_gap
FROM ${table}
WHERE ${where}
ORDER BY rate_gap DESC, collection_date DESC, bank_name ASC, product_id ASC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    passed: (row) => num(row.affected_rows) === 0,
    detail: (row) => ({ affected_rows: num(row.affected_rows) }),
    interpretation: (row) =>
      num(row.affected_rows) === 0
        ? 'No rows were found where comparison_rate is below interest_rate.'
        : 'Comparison rate should not be below the nominal interest rate; these rows likely indicate parsing or field-mapping issues.',
  }
}

function homeLvrInversionCheck(table: string, scope: AuditScope, activeOnly: boolean): QuantifiedCheckSpec {
  const sourceWhere = activeOnly ? `WHERE ${latestWhere()}` : ''
  const pairsCte = `WITH ranked AS (
  SELECT bank_name, collection_date, product_id, security_purpose, repayment_type, rate_structure, feature_set,
    COALESCE(has_offset_account, -1) AS has_offset_account, lvr_tier, interest_rate,
    ${homeLvrRankExpr()} AS lvr_rank
  FROM ${table}
  ${sourceWhere}
),
pairs AS (
  SELECT low.bank_name, low.collection_date, low.product_id, low.security_purpose, low.repayment_type,
    low.rate_structure, low.feature_set, low.has_offset_account,
    low.lvr_tier AS lower_lvr_tier, low.interest_rate AS lower_interest_rate,
    high.lvr_tier AS higher_lvr_tier, high.interest_rate AS higher_interest_rate,
    ROUND(low.interest_rate - high.interest_rate, 4) AS rate_gap,
    low.bank_name || '|' || low.collection_date || '|' || low.product_id || '|' || low.security_purpose || '|' ||
      low.repayment_type || '|' || low.rate_structure || '|' || low.feature_set || '|' || low.has_offset_account AS group_key
  FROM ranked low
  JOIN ranked high
    ON high.bank_name = low.bank_name
   AND high.collection_date = low.collection_date
   AND high.product_id = low.product_id
   AND high.security_purpose = low.security_purpose
   AND high.repayment_type = low.repayment_type
   AND high.rate_structure = low.rate_structure
   AND high.feature_set = low.feature_set
   AND high.has_offset_account = low.has_offset_account
   AND high.lvr_rank > low.lvr_rank
  WHERE low.lvr_rank IS NOT NULL
    AND high.lvr_rank IS NOT NULL
    AND low.interest_rate > high.interest_rate + 0.01
)`
  return {
    check: `${scope}_home_lower_lvr_above_higher_lvr`,
    severity: 'suspicious',
    scope,
    count: {
      label: `${scope}_home_lower_lvr_above_higher_lvr_count`,
      sql: `${pairsCte}
SELECT COUNT(DISTINCT group_key) AS affected_rows, COUNT(*) AS pair_count FROM pairs`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sample: {
      label: `${scope}_home_lower_lvr_above_higher_lvr_sample`,
      sql: `${pairsCte}
SELECT bank_name, collection_date, product_id, security_purpose, repayment_type, rate_structure, feature_set,
  has_offset_account, lower_lvr_tier, lower_interest_rate, higher_lvr_tier, higher_interest_rate, rate_gap
FROM pairs
ORDER BY rate_gap DESC, collection_date DESC, bank_name ASC, product_id ASC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    passed: (row) => num(row.affected_rows) === 0,
    detail: (row) => ({ affected_groups: num(row.affected_rows), pair_count: num(row.pair_count) }),
    interpretation: (row) =>
      num(row.affected_rows) === 0
        ? 'No lower-LVR vs higher-LVR pricing inversions were found.'
        : 'Lower-LVR tiers pricing above higher-LVR tiers is economically unusual and should be reviewed as suspicious, not automatically invalid.',
  }
}

function homeOwnerOccupiedCheck(table: string, scope: AuditScope, activeOnly: boolean): QuantifiedCheckSpec {
  const sourceWhere = activeOnly ? `AND ${latestWhere('oo')} AND ${latestWhere('inv')}` : ''
  const pairsCte = `WITH pairs AS (
  SELECT oo.bank_name, oo.collection_date, oo.product_id, oo.repayment_type, oo.rate_structure, oo.lvr_tier,
    oo.feature_set, COALESCE(oo.has_offset_account, -1) AS has_offset_account,
    oo.interest_rate AS owner_occupied_rate, inv.interest_rate AS investment_rate,
    ROUND(oo.interest_rate - inv.interest_rate, 4) AS rate_gap,
    oo.bank_name || '|' || oo.collection_date || '|' || oo.product_id || '|' || oo.repayment_type || '|' ||
      oo.rate_structure || '|' || oo.lvr_tier || '|' || oo.feature_set || '|' || COALESCE(oo.has_offset_account, -1) AS group_key
  FROM ${table} oo
  JOIN ${table} inv
    ON inv.bank_name = oo.bank_name
   AND inv.collection_date = oo.collection_date
   AND inv.product_id = oo.product_id
   AND inv.repayment_type = oo.repayment_type
   AND inv.rate_structure = oo.rate_structure
   AND inv.lvr_tier = oo.lvr_tier
   AND inv.feature_set = oo.feature_set
   AND COALESCE(inv.has_offset_account, -1) = COALESCE(oo.has_offset_account, -1)
   AND inv.security_purpose = 'investment'
  WHERE oo.security_purpose = 'owner_occupied'
    ${sourceWhere}
    AND oo.interest_rate > inv.interest_rate + 0.01
)`
  return {
    check: `${scope}_home_owner_occupied_above_investment`,
    severity: 'suspicious',
    scope,
    count: {
      label: `${scope}_home_owner_occupied_above_investment_count`,
      sql: `${pairsCte}
SELECT COUNT(DISTINCT group_key) AS affected_rows, COUNT(*) AS pair_count FROM pairs`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sample: {
      label: `${scope}_home_owner_occupied_above_investment_sample`,
      sql: `${pairsCte}
SELECT bank_name, collection_date, product_id, repayment_type, rate_structure, lvr_tier, feature_set,
  has_offset_account, owner_occupied_rate, investment_rate, rate_gap
FROM pairs
ORDER BY rate_gap DESC, collection_date DESC, bank_name ASC, product_id ASC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    passed: (row) => num(row.affected_rows) === 0,
    detail: (row) => ({ affected_groups: num(row.affected_rows), pair_count: num(row.pair_count) }),
    interpretation: (row) =>
      num(row.affected_rows) === 0
        ? 'No owner-occupied vs investment pricing inversions were found.'
        : 'Owner-occupied rates above investment rates are unusual and should be reviewed for source or normalization issues.',
  }
}

function homePrincipalInterestCheck(table: string, scope: AuditScope, activeOnly: boolean): QuantifiedCheckSpec {
  const sourceWhere = activeOnly ? `AND ${latestWhere('pi')} AND ${latestWhere('io')}` : ''
  const pairsCte = `WITH pairs AS (
  SELECT pi.bank_name, pi.collection_date, pi.product_id, pi.security_purpose, pi.rate_structure, pi.lvr_tier,
    pi.feature_set, COALESCE(pi.has_offset_account, -1) AS has_offset_account,
    pi.interest_rate AS principal_and_interest_rate, io.interest_rate AS interest_only_rate,
    ROUND(pi.interest_rate - io.interest_rate, 4) AS rate_gap,
    pi.bank_name || '|' || pi.collection_date || '|' || pi.product_id || '|' || pi.security_purpose || '|' ||
      pi.rate_structure || '|' || pi.lvr_tier || '|' || pi.feature_set || '|' || COALESCE(pi.has_offset_account, -1) AS group_key
  FROM ${table} pi
  JOIN ${table} io
    ON io.bank_name = pi.bank_name
   AND io.collection_date = pi.collection_date
   AND io.product_id = pi.product_id
   AND io.security_purpose = pi.security_purpose
   AND io.rate_structure = pi.rate_structure
   AND io.lvr_tier = pi.lvr_tier
   AND io.feature_set = pi.feature_set
   AND COALESCE(io.has_offset_account, -1) = COALESCE(pi.has_offset_account, -1)
   AND io.repayment_type = 'interest_only'
  WHERE pi.repayment_type = 'principal_and_interest'
    ${sourceWhere}
    AND pi.interest_rate > io.interest_rate + 0.01
)`
  return {
    check: `${scope}_home_principal_and_interest_above_interest_only`,
    severity: 'suspicious',
    scope,
    count: {
      label: `${scope}_home_principal_and_interest_above_interest_only_count`,
      sql: `${pairsCte}
SELECT COUNT(DISTINCT group_key) AS affected_rows, COUNT(*) AS pair_count FROM pairs`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sample: {
      label: `${scope}_home_principal_and_interest_above_interest_only_sample`,
      sql: `${pairsCte}
SELECT bank_name, collection_date, product_id, security_purpose, rate_structure, lvr_tier, feature_set,
  has_offset_account, principal_and_interest_rate, interest_only_rate, rate_gap
FROM pairs
ORDER BY rate_gap DESC, collection_date DESC, bank_name ASC, product_id ASC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    passed: (row) => num(row.affected_rows) === 0,
    detail: (row) => ({ affected_groups: num(row.affected_rows), pair_count: num(row.pair_count) }),
    interpretation: (row) =>
      num(row.affected_rows) === 0
        ? 'No principal-and-interest vs interest-only pricing inversions were found.'
        : 'Principal-and-interest rates above interest-only rates are suspicious and should be reviewed with the source product details.',
  }
}

function savingsTotalCheck(table: string, scope: AuditScope, activeOnly: boolean): QuantifiedCheckSpec {
  const totalFilter = activeOnly ? `AND ${latestWhere('t')}` : ''
  const componentFilter = activeOnly ? `AND ${latestWhere('c')}` : ''
  const pairsCte = `WITH pairs AS (
  SELECT t.bank_name, t.collection_date, t.product_id, t.account_type, t.deposit_tier,
    c.rate_type AS component_rate_type, t.interest_rate AS total_rate, c.interest_rate AS component_rate,
    ROUND(c.interest_rate - t.interest_rate, 4) AS rate_gap,
    t.bank_name || '|' || t.collection_date || '|' || t.product_id || '|' || t.account_type || '|' || t.deposit_tier AS group_key
  FROM ${table} t
  JOIN ${table} c
    ON c.bank_name = t.bank_name
   AND c.collection_date = t.collection_date
   AND c.product_id = t.product_id
   AND c.account_type = t.account_type
   AND c.deposit_tier = t.deposit_tier
   AND c.rate_type IN ('base', 'bonus')
  WHERE t.rate_type = 'total'
    ${totalFilter}
    ${componentFilter}
    AND t.interest_rate + 0.01 < c.interest_rate
)`
  return {
    check: `${scope}_savings_total_below_base_or_bonus`,
    severity: 'suspicious',
    scope,
    count: {
      label: `${scope}_savings_total_below_base_or_bonus_count`,
      sql: `${pairsCte}
SELECT COUNT(DISTINCT group_key) AS affected_rows, COUNT(*) AS pair_count FROM pairs`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sample: {
      label: `${scope}_savings_total_below_base_or_bonus_sample`,
      sql: `${pairsCte}
SELECT bank_name, collection_date, product_id, account_type, deposit_tier,
  component_rate_type, total_rate, component_rate, rate_gap
FROM pairs
ORDER BY rate_gap DESC, collection_date DESC, bank_name ASC, product_id ASC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    passed: (row) => num(row.affected_rows) === 0,
    detail: (row) => ({ affected_groups: num(row.affected_rows), pair_count: num(row.pair_count) }),
    interpretation: (row) =>
      num(row.affected_rows) === 0
        ? 'No savings rows were found where total rate is below base or bonus components.'
        : 'A total savings rate below its base or bonus component is suspicious and likely indicates incorrect component extraction.',
  }
}

function savingsBalanceRangeCheck(table: string, scope: AuditScope, activeOnly: boolean): QuantifiedCheckSpec {
  const whereParts = ['min_balance IS NOT NULL', 'max_balance IS NOT NULL', 'min_balance > max_balance']
  if (activeOnly) whereParts.push(latestWhere())
  const where = whereParts.join(' AND ')
  return {
    check: `${scope}_savings_min_balance_above_max_balance`,
    severity: 'invalid',
    scope,
    count: {
      label: `${scope}_savings_min_balance_above_max_balance_count`,
      sql: `SELECT COUNT(*) AS affected_rows FROM ${table} WHERE ${where}`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sample: {
      label: `${scope}_savings_min_balance_above_max_balance_sample`,
      sql: `SELECT bank_name, collection_date, product_id, account_type, rate_type, deposit_tier, min_balance, max_balance
FROM ${table}
WHERE ${where}
ORDER BY collection_date DESC, bank_name ASC, product_id ASC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    passed: (row) => num(row.affected_rows) === 0,
    detail: (row) => ({ affected_rows: num(row.affected_rows) }),
    interpretation: (row) =>
      num(row.affected_rows) === 0
        ? 'No savings rows were found with min_balance greater than max_balance.'
        : 'A min_balance above max_balance is internally inconsistent and should be treated as invalid data.',
  }
}

function tdDepositRangeCheck(table: string, scope: AuditScope, activeOnly: boolean): QuantifiedCheckSpec {
  const whereParts = ['min_deposit IS NOT NULL', 'max_deposit IS NOT NULL', 'min_deposit > max_deposit']
  if (activeOnly) whereParts.push(latestWhere())
  const where = whereParts.join(' AND ')
  return {
    check: `${scope}_term_deposits_min_deposit_above_max_deposit`,
    severity: 'invalid',
    scope,
    count: {
      label: `${scope}_term_deposits_min_deposit_above_max_deposit_count`,
      sql: `SELECT COUNT(*) AS affected_rows FROM ${table} WHERE ${where}`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sample: {
      label: `${scope}_term_deposits_min_deposit_above_max_deposit_sample`,
      sql: `SELECT bank_name, collection_date, product_id, term_months, deposit_tier, interest_payment, min_deposit, max_deposit
FROM ${table}
WHERE ${where}
ORDER BY collection_date DESC, bank_name ASC, product_id ASC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    passed: (row) => num(row.affected_rows) === 0,
    detail: (row) => ({ affected_rows: num(row.affected_rows) }),
    interpretation: (row) =>
      num(row.affected_rows) === 0
        ? 'No term deposit rows were found with min_deposit greater than max_deposit.'
        : 'A min_deposit above max_deposit is internally inconsistent and should be treated as invalid data.',
  }
}

function tdTermMonthsCheck(table: string, scope: AuditScope, activeOnly: boolean): QuantifiedCheckSpec {
  const primary = 'term_months IS NULL OR term_months <= 0'
  const where = activeOnly ? `(${primary}) AND ${latestWhere()}` : `(${primary})`
  return {
    check: `${scope}_term_deposits_invalid_term_months`,
    severity: 'invalid',
    scope,
    count: {
      label: `${scope}_term_deposits_invalid_term_months_count`,
      sql: `SELECT COUNT(*) AS affected_rows FROM ${table} WHERE ${where}`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sample: {
      label: `${scope}_term_deposits_invalid_term_months_sample`,
      sql: `SELECT bank_name, collection_date, product_id, term_months, deposit_tier, interest_payment, interest_rate
FROM ${table}
WHERE ${where}
ORDER BY collection_date DESC, bank_name ASC, product_id ASC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    passed: (row) => num(row.affected_rows) === 0,
    detail: (row) => ({ affected_rows: num(row.affected_rows) }),
    interpretation: (row) =>
      num(row.affected_rows) === 0
        ? 'No term deposit rows were found with term_months <= 0 or null.'
        : 'A null or non-positive term_months value is invalid for a term deposit record.',
  }
}

function tdInterestPaymentCheck(table: string, scope: AuditScope, activeOnly: boolean): QuantifiedCheckSpec {
  const maturityFilter = activeOnly ? `AND ${latestWhere('m')}` : ''
  const paymentFilter = activeOnly ? `AND ${latestWhere('p')}` : ''
  const pairsCte = `WITH pairs AS (
  SELECT m.bank_name, m.collection_date, m.product_id, m.term_months, m.deposit_tier,
    m.interest_rate AS at_maturity_rate, p.interest_payment AS other_interest_payment,
    p.interest_rate AS other_interest_rate, ROUND(p.interest_rate - m.interest_rate, 4) AS rate_gap,
    m.bank_name || '|' || m.collection_date || '|' || m.product_id || '|' || m.term_months || '|' || m.deposit_tier AS group_key
  FROM ${table} m
  JOIN ${table} p
    ON p.bank_name = m.bank_name
   AND p.collection_date = m.collection_date
   AND p.product_id = m.product_id
   AND p.term_months = m.term_months
   AND p.deposit_tier = m.deposit_tier
   AND p.interest_payment IN ('monthly', 'quarterly', 'annually')
  WHERE m.interest_payment = 'at_maturity'
    ${maturityFilter}
    ${paymentFilter}
    AND m.interest_rate + 0.01 < p.interest_rate
)`
  return {
    check: `${scope}_term_deposits_at_maturity_below_periodic_payments`,
    severity: 'suspicious',
    scope,
    count: {
      label: `${scope}_term_deposits_at_maturity_below_periodic_payments_count`,
      sql: `${pairsCte}
SELECT COUNT(DISTINCT group_key) AS affected_rows, COUNT(*) AS pair_count FROM pairs`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sample: {
      label: `${scope}_term_deposits_at_maturity_below_periodic_payments_sample`,
      sql: `${pairsCte}
SELECT bank_name, collection_date, product_id, term_months, deposit_tier,
  at_maturity_rate, other_interest_payment, other_interest_rate, rate_gap
FROM pairs
ORDER BY rate_gap DESC, collection_date DESC, bank_name ASC, product_id ASC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    passed: (row) => num(row.affected_rows) === 0,
    detail: (row) => ({ affected_groups: num(row.affected_rows), pair_count: num(row.pair_count) }),
    interpretation: (row) =>
      num(row.affected_rows) === 0
        ? 'No term deposit rows were found where at-maturity rates are below periodic payment variants.'
        : 'At-maturity term deposit rates below periodic-payment variants are suspicious and should be reviewed for source or extraction issues.',
  }
}

function buildFinanceChecks(): QuantifiedCheckSpec[] {
  return [
    homeComparisonRateCheck('historical_loan_rates', 'historical', false),
    homeLvrInversionCheck('historical_loan_rates', 'historical', false),
    homeOwnerOccupiedCheck('historical_loan_rates', 'historical', false),
    homePrincipalInterestCheck('historical_loan_rates', 'historical', false),
    savingsTotalCheck('historical_savings_rates', 'historical', false),
    savingsBalanceRangeCheck('historical_savings_rates', 'historical', false),
    tdDepositRangeCheck('historical_term_deposit_rates', 'historical', false),
    tdTermMonthsCheck('historical_term_deposit_rates', 'historical', false),
    tdInterestPaymentCheck('historical_term_deposit_rates', 'historical', false),
    homeComparisonRateCheck('latest_home_loan_series', 'latest', true),
    homeLvrInversionCheck('latest_home_loan_series', 'latest', true),
    homeOwnerOccupiedCheck('latest_home_loan_series', 'latest', true),
    homePrincipalInterestCheck('latest_home_loan_series', 'latest', true),
    savingsTotalCheck('latest_savings_series', 'latest', true),
    savingsBalanceRangeCheck('latest_savings_series', 'latest', true),
    tdDepositRangeCheck('latest_td_series', 'latest', true),
    tdTermMonthsCheck('latest_td_series', 'latest', true),
    tdInterestPaymentCheck('latest_td_series', 'latest', true),
  ]
}

function addQuantifiedCheck(context: SqlRunContext, spec: QuantifiedCheckSpec): void {
  try {
    const rows = runSql(context, spec.count)
    const row = rows[0] || {}
    const countValue = num(row.affected_rows)
    const pairCount = Number.isFinite(Number(row.pair_count)) ? num(row.pair_count) : undefined
    let sample: Array<Record<string, unknown>> | undefined
    if (countValue > 0 && spec.sample) sample = runSql(context, spec.sample)
    context.findings.push({
      check: spec.check,
      severity: spec.severity,
      scope: spec.scope,
      passed: spec.passed(row),
      count: countValue,
      pair_count: pairCount,
      detail: spec.detail ? spec.detail(row) : undefined,
      sample,
      interpretation: spec.interpretation(row),
    })
  } catch (error) {
    context.findings.push(createExecutionErrorFinding(spec.check, spec.scope, error))
  }
}

function renderMarkdownReport(report: DataIntegrityReport): string {
  const sections: Array<{ title: string; severity: AuditSeverity }> = [
    { title: 'Invalid', severity: 'invalid' },
    { title: 'Suspicious', severity: 'suspicious' },
    { title: 'Indicator', severity: 'indicator' },
  ]
  const lines: string[] = [
    '# Production D1 validation and commonsense finance audit',
    '',
    `Generated: ${report.generated_at}`,
    `Target DB: ${report.target_db}`,
    `Origin: ${report.origin}`,
    '',
    '## Summary',
    '',
    `- Total checks: ${report.summary.total_checks}`,
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    `- Invalid findings: ${report.summary.invalid_findings}`,
    `- Suspicious findings: ${report.summary.suspicious_findings}`,
    `- Indicator findings: ${report.summary.indicator_findings}`,
    `- Execution errors: ${report.summary.execution_errors}`,
    '',
  ]

  for (const section of sections) {
    lines.push(`## ${section.title}`)
    lines.push('')
    const findings = report.findings.filter((finding) => finding.severity === section.severity)
    if (findings.length === 0) {
      lines.push('- None')
      lines.push('')
      continue
    }
    for (const finding of findings) {
      const status = finding.passed ? 'PASS' : 'FAIL'
      lines.push(`### ${finding.check} [${finding.scope}] ${status}`)
      lines.push('')
      if (finding.count !== undefined) lines.push(`- Count: ${finding.count}`)
      if (finding.pair_count !== undefined) lines.push(`- Pair count: ${finding.pair_count}`)
      lines.push(`- Interpretation: ${finding.interpretation}`)
      if (finding.detail && Object.keys(finding.detail).length > 0) {
        lines.push(`- Detail: ${JSON.stringify(finding.detail)}`)
      }
      if (finding.sample && finding.sample.length > 0) {
        lines.push(`- Sample (up to ${SAMPLE_LIMIT}):`)
        for (const row of finding.sample) lines.push(`  - ${JSON.stringify(row)}`)
      }
      lines.push('')
    }
  }

  lines.push('## Executed Commands')
  lines.push('')
  for (const command of report.executed_commands) {
    lines.push(`- \`${command.command}\` (exit ${command.exit_code})`)
  }
  return lines.join('\n')
}

export async function runDataIntegrityAudit(
  args: string[],
  spawnRunner: SpawnRunner = spawnSync,
): Promise<DataIntegrityReport> {
  const config = parseConfig(args)
  const executedCommands: ExecutedCommand[] = []
  const retries: unknown[] = []
  const findings: AuditFinding[] = []
  const context: SqlRunContext = { config, spawnRunner, executedCommands, retries, findings }

  addQuickCheck(context)
  addForeignKeyCheck(context)
  await fetchRowCountSnapshot(context)
  addDatasetStats(context)
  addProductKeyConsistency(context)

  addCountSampleCheck(context, {
    check: 'orphan_product_presence_status',
    severity: 'invalid',
    scope: 'metadata',
    countSql: {
      label: 'orphan_product_presence_status_count',
      sql: `SELECT COUNT(*) AS affected_rows
FROM product_presence_status p
LEFT JOIN product_catalog c
  ON c.dataset_kind = p.section
 AND c.bank_name = p.bank_name
 AND c.product_id = p.product_id
WHERE c.product_id IS NULL`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sampleSql: {
      label: 'orphan_product_presence_status_sample',
      sql: `SELECT p.section, p.bank_name, p.product_id, p.last_seen_collection_date, p.last_seen_at
FROM product_presence_status p
LEFT JOIN product_catalog c
  ON c.dataset_kind = p.section
 AND c.bank_name = p.bank_name
 AND c.product_id = p.product_id
WHERE c.product_id IS NULL
ORDER BY p.last_seen_at DESC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    interpretation: (count) =>
      count === 0
        ? 'No orphan product_presence_status rows were found.'
        : 'Presence rows without a matching product_catalog entry are invalid linkage data.',
  })

  addCountSampleCheck(context, {
    check: 'fetch_event_raw_object_linkage',
    severity: 'invalid',
    scope: 'metadata',
    countSql: {
      label: 'fetch_event_raw_object_linkage_count',
      sql: `SELECT COUNT(*) AS affected_rows
FROM fetch_events fe
LEFT JOIN raw_objects ro ON ro.content_hash = fe.content_hash
WHERE ro.content_hash IS NULL`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sampleSql: {
      label: 'fetch_event_raw_object_linkage_sample',
      sql: `SELECT fe.id, fe.source_type, fe.fetched_at, fe.source_url, fe.content_hash
FROM fetch_events fe
LEFT JOIN raw_objects ro ON ro.content_hash = fe.content_hash
WHERE ro.content_hash IS NULL
ORDER BY fe.fetched_at DESC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    interpretation: (count) =>
      count === 0
        ? 'No fetch_events rows were found without a matching raw_objects record.'
        : 'fetch_events rows without a matching raw_objects record indicate invalid raw-object linkage.',
  })

  addCountSampleCheck(context, {
    check: 'raw_payload_raw_object_linkage',
    severity: 'suspicious',
    scope: 'metadata',
    countSql: {
      label: 'raw_payload_raw_object_linkage_count',
      sql: `SELECT COUNT(*) AS affected_rows
FROM raw_payloads rp
LEFT JOIN raw_objects ro ON ro.content_hash = rp.content_hash
WHERE ro.content_hash IS NULL`,
      expectedAlias: 'affected_rows',
      runner: 'fallback',
    },
    sampleSql: {
      label: 'raw_payload_raw_object_linkage_sample',
      sql: `SELECT rp.id, rp.source_type, rp.fetched_at, rp.source_url, rp.content_hash
FROM raw_payloads rp
LEFT JOIN raw_objects ro ON ro.content_hash = rp.content_hash
WHERE ro.content_hash IS NULL
ORDER BY rp.fetched_at DESC
LIMIT ${SAMPLE_LIMIT}`,
      runner: 'command',
    },
    interpretation: (count) =>
      count === 0
        ? 'No raw_payloads rows were found without a matching raw_objects record.'
        : 'raw_payloads rows without raw_objects are suspicious lineage gaps and should be reviewed.',
  })

  addRunsWithNoOutputs(context)
  addDuplicateChecks(context)
  addBoundChecks(context)
  addNullChecks(context)
  addOrphanLatestChecks(context)
  addFreshnessIndicator(context)

  for (const spec of buildFinanceChecks()) addQuantifiedCheck(context, spec)

  const failed = findings.filter((finding) => !finding.passed)
  const invalidFindings = failed.filter((finding) => finding.severity === 'invalid').length
  const suspiciousFindings = failed.filter((finding) => finding.severity === 'suspicious').length
  const executionErrors = findings.filter((finding) => finding.detail?.execution_error === true).length

  const report: DataIntegrityReport = {
    ok: failed.length === 0,
    generated_at: new Date().toISOString(),
    target_db: config.db,
    origin: config.origin,
    executed_commands: executedCommands,
    retry: retries.length > 0 ? retries : null,
    findings,
    summary: {
      total_checks: findings.length,
      passed: findings.filter((finding) => finding.passed).length,
      failed: failed.length,
      invalid_findings: invalidFindings,
      suspicious_findings: suspiciousFindings,
      indicator_findings: findings.filter((finding) => finding.severity === 'indicator').length,
      execution_errors: executionErrors,
    },
  }

  ensureOutputPath(config.outputJson)
  ensureOutputPath(config.outputMd)
  fs.writeFileSync(config.outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  fs.writeFileSync(config.outputMd, renderMarkdownReport(report), 'utf8')
  return report
}

export async function main(args: string[]): Promise<void> {
  try {
    const config = parseConfig(args)
    const report = await runDataIntegrityAudit(args)
    process.stdout.write(
      `${JSON.stringify({
        ok: report.ok,
        output_json: config.outputJson,
        output_md: config.outputMd,
        generated_at: report.generated_at,
        failed_count: report.summary.failed,
      })}\n`,
    )
    process.exitCode = report.ok ? 0 : 1
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: (error as Error)?.message || String(error), exit_code: 1 })}\n`,
    )
    process.exitCode = 1
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: (error as Error)?.message || String(error), exit_code: 1 })}\n`,
    )
    process.exitCode = 1
  })
}
