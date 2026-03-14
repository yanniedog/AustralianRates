import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { executeRemoteSqlWithFallbackForTest, isSafePlanSql, type SpawnRunner } from './repair-presence-prod'
import {
  DATASETS,
  buildDatasetCoverageReport,
  renderMarkdownReport,
  type AuditReport,
} from './coverage-audit-report'
import { resolveCliPath } from './cli-path'

const ALLOWED_DB = 'australianrates_api'
const BOOLEAN_OPTIONS = new Set(['--remote'])
const VALUE_OPTIONS = new Set(['--db', '--output-json', '--output-md'])

type AuditConfig = {
  db: string
  remote: true
  outputJson: string
  outputMd: string
}

type QueryResultRows = {
  rows: Array<Record<string, unknown>>
  command: string
  exitCode: number
  retry?: unknown
}

function parseCliArgs(args: string[]): { flags: Set<string>; values: Map<string, string>; positionals: string[] } {
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
  const dir = kind === 'json' ? 'artifacts' : 'docs'
  const ext = kind === 'json' ? 'json' : 'md'
  return path.resolve(process.cwd(), dir, `production-coverage-audit-${todayStamp()}.${ext}`)
}

function exampleCommand(): string {
  return 'node scripts/coverage-audit-prod.js --remote --db australianrates_api'
}

function formatCliError(reason: string, args: string[]): string {
  return `CLI preflight failed: ${reason}; received_argv=${JSON.stringify(args)}; example="${exampleCommand()}"`
}

function parseConfig(args: string[]): AuditConfig {
  const parsed = parseCliArgs(args)
  if (parsed.positionals.length > 0) {
    throw new Error(formatCliError(`unexpected positional arguments: ${parsed.positionals.join(' ')}`, args))
  }
  if (!parsed.flags.has('--remote')) throw new Error(formatCliError('--remote is required', args))
  const db = String(parsed.values.get('--db') || '').trim()
  if (db !== ALLOWED_DB) throw new Error(formatCliError(`only --db ${ALLOWED_DB} is allowed`, args))
  return {
    db,
    remote: true,
    outputJson: resolveCliPath(parsed.values.get('--output-json') || defaultOutput('json')),
    outputMd: resolveCliPath(parsed.values.get('--output-md') || defaultOutput('md')),
  }
}

function runPlanQuery(db: string, sql: string, label: string, expectedAlias: string, spawnRunner: SpawnRunner): QueryResultRows {
  if (!isSafePlanSql(sql)) throw new Error(`Plan SQL failed safety check (${label}).`)
  const rawResult = executeRemoteSqlWithFallbackForTest(db, sql, spawnRunner, {
    phase: 'plan',
    expectedAlias,
  }) as unknown as {
    payload: Array<{ results?: Array<Record<string, unknown>> }>
    command: string
    exitCode: number
    retry?: unknown
  }
  return {
    rows: rawResult.payload?.[0]?.results ?? [],
    command: rawResult.command,
    exitCode: rawResult.exitCode,
    retry: rawResult.retry,
  }
}

function datasetQueries(table: string): { banks: string; present: string } {
  return {
    banks: `SELECT bank_name FROM ${table} GROUP BY bank_name ORDER BY bank_name`,
    present: `SELECT collection_date, bank_name, COUNT(*) AS row_count, COUNT(DISTINCT series_key) AS series_count FROM ${table} GROUP BY collection_date, bank_name ORDER BY collection_date, bank_name`,
  }
}

function buildSqlPack(): Record<string, string> {
  const dedupeEntries = DATASETS.map((dataset) => [
    `${dataset.key}_safe_exact_duplicate_candidates`,
    `WITH grouped AS (
  SELECT
    series_key,
    collection_date,
    COUNT(DISTINCT COALESCE(run_source, 'scheduled')) AS sources,
    COUNT(DISTINCT ${dataset.stateSignatureSql}) AS states
  FROM ${dataset.table}
  GROUP BY series_key, collection_date
)
SELECT series_key, collection_date
FROM grouped
WHERE sources > 1
  AND states = 1
ORDER BY collection_date, series_key;`,
  ] as const)
  return Object.fromEntries([
    [
      'coverage_over_time_template',
      `SELECT collection_date, bank_name, COUNT(*) AS row_count, COUNT(DISTINCT series_key) AS series_count
FROM {{table}}
GROUP BY collection_date, bank_name
ORDER BY collection_date, bank_name;`,
    ],
    [
      'conflict_review_template',
      `SELECT series_key, collection_date, COALESCE(run_source, 'scheduled') AS run_source
FROM {{table}}
WHERE series_key = ? AND collection_date = ?
ORDER BY run_source, parsed_at;`,
    ],
    [
      'lender_gap_dashboard_template',
      `SELECT collection_date, bank_name, COUNT(*) AS row_count, COUNT(DISTINCT series_key) AS series_count
FROM {{table}}
GROUP BY collection_date, bank_name
ORDER BY collection_date DESC, bank_name ASC;`,
    ],
    ...dedupeEntries,
  ])
}

function ensureOutputPath(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

export function runCoverageAudit(args: string[], spawnRunner: SpawnRunner = spawnSync): AuditReport {
  const config = parseConfig(args)
  const executedCommands: Array<{ label: string; command: string; exit_code: number }> = []
  const retries: unknown[] = []
  const collect = (sql: string, label: string, expectedAlias: string) => {
    const result = runPlanQuery(config.db, sql, label, expectedAlias, spawnRunner)
    executedCommands.push({ label, command: result.command, exit_code: result.exitCode })
    if (result.retry) retries.push(result.retry)
    return result.rows
  }

  const datasetStats = collect(
    `SELECT 'home_loans' AS dataset, COUNT(*) AS total_rows, COUNT(DISTINCT collection_date) AS distinct_dates, MIN(collection_date) AS min_collection_date, MAX(collection_date) AS max_collection_date, COUNT(DISTINCT series_key) AS distinct_series, COUNT(DISTINCT bank_name || '|' || product_id) AS distinct_products FROM historical_loan_rates UNION ALL SELECT 'savings', COUNT(*), COUNT(DISTINCT collection_date), MIN(collection_date), MAX(collection_date), COUNT(DISTINCT series_key), COUNT(DISTINCT bank_name || '|' || product_id) FROM historical_savings_rates UNION ALL SELECT 'term_deposits', COUNT(*), COUNT(DISTINCT collection_date), MIN(collection_date), MAX(collection_date), COUNT(DISTINCT series_key), COUNT(DISTINCT bank_name || '|' || product_id) FROM historical_term_deposit_rates`,
    'dataset-stats',
    'dataset',
  )
  const coverageState = collect(
    `SELECT dataset_key, first_coverage_date, cursor_date, status, empty_streak, last_tick_status, last_tick_message, updated_at FROM dataset_coverage_progress ORDER BY dataset_key`,
    'dataset-coverage-state',
    'dataset_key',
  )
  const rawBacklogBySource = collect(
    `SELECT COALESCE(rp.source_type, 'unknown') AS source_type, COUNT(*) AS orphan_rows FROM raw_payloads rp LEFT JOIN raw_objects ro ON ro.content_hash = rp.content_hash WHERE ro.content_hash IS NULL GROUP BY COALESCE(rp.source_type, 'unknown') ORDER BY orphan_rows DESC, source_type ASC`,
    'raw-backlog-by-source',
    'source_type',
  )
  const integrity = collect(
    `SELECT 'home_loans' AS dataset, SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END) AS missing_series_key, SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure) THEN 1 ELSE 0 END) AS mismatched_series_key FROM historical_loan_rates UNION ALL SELECT 'savings', SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END), SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier) THEN 1 ELSE 0 END) FROM historical_savings_rates UNION ALL SELECT 'term_deposits', SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END), SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier || '|' || interest_payment) THEN 1 ELSE 0 END) FROM historical_term_deposit_rates`,
    'integrity',
    'dataset',
  )
  const overlapSummary = collect(
    `WITH home AS ( SELECT 'home_loans' AS dataset, series_key, collection_date, COUNT(DISTINCT COALESCE(run_source,'scheduled')) AS sources, COUNT(DISTINCT printf('%s|%s|%s', COALESCE(interest_rate,''), COALESCE(comparison_rate,''), COALESCE(annual_fee,''))) AS states FROM historical_loan_rates GROUP BY series_key, collection_date ), savings AS ( SELECT 'savings' AS dataset, series_key, collection_date, COUNT(DISTINCT COALESCE(run_source,'scheduled')) AS sources, COUNT(DISTINCT printf('%s|%s|%s|%s|%s', COALESCE(interest_rate,''), COALESCE(min_balance,''), COALESCE(max_balance,''), COALESCE(monthly_fee,''), COALESCE(conditions,''))) AS states FROM historical_savings_rates GROUP BY series_key, collection_date ), td AS ( SELECT 'term_deposits' AS dataset, series_key, collection_date, COUNT(DISTINCT COALESCE(run_source,'scheduled')) AS sources, COUNT(DISTINCT printf('%s|%s|%s', COALESCE(interest_rate,''), COALESCE(min_deposit,''), COALESCE(max_deposit,''))) AS states FROM historical_term_deposit_rates GROUP BY series_key, collection_date ) SELECT dataset, COUNT(*) AS overlapping_series_dates, SUM(CASE WHEN states > 1 THEN 1 ELSE 0 END) AS overlapping_series_dates_with_conflicts FROM (SELECT * FROM home UNION ALL SELECT * FROM savings UNION ALL SELECT * FROM td) WHERE sources > 1 GROUP BY dataset ORDER BY dataset`,
    'overlap-summary',
    'dataset',
  )
  const overlapDateBreakdown = collect(
    `WITH combined AS ( SELECT 'home_loans' AS dataset, collection_date, COUNT(*) AS overlaps FROM ( SELECT series_key, collection_date, COUNT(DISTINCT COALESCE(run_source,'scheduled')) AS sources FROM historical_loan_rates GROUP BY series_key, collection_date ) WHERE sources > 1 GROUP BY collection_date UNION ALL SELECT 'savings', collection_date, COUNT(*) FROM ( SELECT series_key, collection_date, COUNT(DISTINCT COALESCE(run_source,'scheduled')) AS sources FROM historical_savings_rates GROUP BY series_key, collection_date ) WHERE sources > 1 GROUP BY collection_date UNION ALL SELECT 'term_deposits', collection_date, COUNT(*) FROM ( SELECT series_key, collection_date, COUNT(DISTINCT COALESCE(run_source,'scheduled')) AS sources FROM historical_term_deposit_rates GROUP BY series_key, collection_date ) WHERE sources > 1 GROUP BY collection_date ) SELECT dataset, collection_date, overlaps FROM combined ORDER BY dataset, collection_date`,
    'overlap-date-breakdown',
    'dataset',
  )
  const conflictDateBreakdown = collect(
    `WITH home AS ( SELECT 'home_loans' AS dataset, collection_date, COUNT(*) AS conflicts FROM ( SELECT series_key, collection_date, COUNT(DISTINCT printf('%s|%s|%s', COALESCE(interest_rate,''), COALESCE(comparison_rate,''), COALESCE(annual_fee,''))) AS states, COUNT(DISTINCT COALESCE(run_source,'scheduled')) AS sources FROM historical_loan_rates GROUP BY series_key, collection_date ) WHERE sources > 1 AND states > 1 GROUP BY collection_date ), savings AS ( SELECT 'savings' AS dataset, collection_date, COUNT(*) AS conflicts FROM ( SELECT series_key, collection_date, COUNT(DISTINCT printf('%s|%s|%s|%s|%s', COALESCE(interest_rate,''), COALESCE(min_balance,''), COALESCE(max_balance,''), COALESCE(monthly_fee,''), COALESCE(conditions,''))) AS states, COUNT(DISTINCT COALESCE(run_source,'scheduled')) AS sources FROM historical_savings_rates GROUP BY series_key, collection_date ) WHERE sources > 1 AND states > 1 GROUP BY collection_date ), td AS ( SELECT 'term_deposits' AS dataset, collection_date, COUNT(*) AS conflicts FROM ( SELECT series_key, collection_date, COUNT(DISTINCT printf('%s|%s|%s', COALESCE(interest_rate,''), COALESCE(min_deposit,''), COALESCE(max_deposit,''))) AS states, COUNT(DISTINCT COALESCE(run_source,'scheduled')) AS sources FROM historical_term_deposit_rates GROUP BY series_key, collection_date ) WHERE sources > 1 AND states > 1 GROUP BY collection_date ) SELECT * FROM (SELECT * FROM home UNION ALL SELECT * FROM savings UNION ALL SELECT * FROM td) ORDER BY dataset, collection_date`,
    'conflict-date-breakdown',
    'dataset',
  )

  const datasets = DATASETS.map((dataset) => {
    const sql = datasetQueries(dataset.table)
    const bankRows = collect(sql.banks, `${dataset.key}-bank-universe`, 'bank_name')
    const presentRows = collect(sql.present, `${dataset.key}-present-by-date-bank`, 'collection_date')
    return buildDatasetCoverageReport(dataset, datasetStats, bankRows, presentRows, overlapDateBreakdown, conflictDateBreakdown)
  })

  const report: AuditReport = {
    ok: true,
    phase: 'audit',
    generated_at: new Date().toISOString(),
    target_db: config.db,
    executed_commands: executedCommands,
    retry: retries.length > 0 ? retries : null,
    dataset_stats: datasetStats,
    dataset_coverage_state: coverageState,
    overlap_summary: overlapSummary,
    raw_backlog_by_source: rawBacklogBySource,
    integrity,
    datasets,
    canonical_rule_set: [
      'Default canonical source is scheduled.',
      'If scheduled and manual rows share the same series_key and collection_date and have identical normalized state, keep scheduled and archive/delete manual.',
      'If a series_key plus collection_date exists only in manual, keep it until a scheduled replacement exists.',
      'If scheduled and manual disagree on normalized state for the same series_key and collection_date, do not auto-delete either row.',
      'Never dedupe across different collection_date or different series_key values.',
    ],
    recommendations: [
      'Do not wipe the database. Continue from the current baseline starting on 2026-02-26.',
      'Do not describe the current data as deep historical coverage; it is a recent baseline with known lender/day gaps.',
      'Clean overlap days first, especially 2026-03-09 across all datasets and 2026-03-05 for term deposits.',
      'Prioritize recurring lender gaps over wholesale resets, especially UBank in home loans and savings and Great Southern Bank in home loans.',
      'Treat zero-row days as system coverage gaps that should be visible in ops dashboards.',
    ],
    sql_pack: buildSqlPack(),
  }

  ensureOutputPath(config.outputJson)
  ensureOutputPath(config.outputMd)
  fs.writeFileSync(config.outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  fs.writeFileSync(config.outputMd, renderMarkdownReport(report), 'utf8')
  return report
}

export function main(args: string[]): void {
  try {
    const config = parseConfig(args)
    const report = runCoverageAudit(args)
    process.stdout.write(
      `${JSON.stringify({ ok: true, output_json: config.outputJson, output_md: config.outputMd, generated_at: report.generated_at })}\n`,
    )
    process.exitCode = 0
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: (error as Error)?.message || String(error), exit_code: 1 })}\n`)
    process.exitCode = 1
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2))
}
