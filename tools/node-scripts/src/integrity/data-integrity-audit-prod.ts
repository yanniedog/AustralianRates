/**
 * Full data integrity audit against production API D1.
 * Runs read-only checks for dead, invalid, duplicate, and erroneous data.
 * Output: JSON (artifacts/) and Markdown (docs/).
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  executeRemoteSqlWithFallbackForTest,
  isSafePlanSql,
  type SpawnRunner,
} from './repair-presence-prod'
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

type QuerySpec = {
  label: string
  sql: string
  expectedAlias: string
}

type IntegrityFinding = {
  category: 'dead' | 'invalid' | 'duplicate' | 'erroneous' | 'indicator'
  check: string
  passed: boolean
  count?: number
  detail?: Record<string, unknown>
  sample?: Array<Record<string, unknown>>
}

type DataIntegrityReport = {
  ok: boolean
  generated_at: string
  target_db: string
  executed_commands: Array<{ label: string; command: string; exit_code: number }>
  retry: unknown[] | null
  findings: IntegrityFinding[]
  summary: {
    total_checks: number
    passed: number
    failed: number
    dead_data_issues: number
    invalid_data_issues: number
    duplicate_data_issues: number
    other_issues: number
  }
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
  return path.resolve(process.cwd(), dir, `data-integrity-audit-${todayStamp()}.${ext}`)
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
  }
}

function runQuery(
  db: string,
  spec: QuerySpec,
  spawnRunner: SpawnRunner,
): { rows: Array<Record<string, unknown>>; command: string; exitCode: number; retry?: unknown } {
  if (!isSafePlanSql(spec.sql)) throw new Error(`Unsafe SQL for ${spec.label}`)
  const rawResult = executeRemoteSqlWithFallbackForTest(db, spec.sql, spawnRunner, {
    phase: 'plan',
    expectedAlias: spec.expectedAlias,
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

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function buildQueries(): QuerySpec[] {
  return [
    {
      label: 'dataset_stats',
      expectedAlias: 'dataset',
      sql: `SELECT 'home_loans' AS dataset, COUNT(*) AS total_rows, COUNT(DISTINCT series_key) AS distinct_series FROM historical_loan_rates
UNION ALL SELECT 'savings', COUNT(*), COUNT(DISTINCT series_key) FROM historical_savings_rates
UNION ALL SELECT 'term_deposits', COUNT(*), COUNT(DISTINCT series_key) FROM historical_term_deposit_rates`,
    },
    {
      label: 'product_key_consistency',
      expectedAlias: 'dataset',
      sql: `SELECT 'home_loans' AS dataset,
  SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END) AS missing_series_key,
  SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure) THEN 1 ELSE 0 END) AS mismatched_series_key
FROM historical_loan_rates
UNION ALL SELECT 'savings', SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END), SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier) THEN 1 ELSE 0 END) FROM historical_savings_rates
UNION ALL SELECT 'term_deposits', SUM(CASE WHEN series_key IS NULL OR TRIM(series_key) = '' THEN 1 ELSE 0 END), SUM(CASE WHEN series_key IS NOT NULL AND TRIM(series_key) != '' AND series_key != (bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier || '|' || interest_payment) THEN 1 ELSE 0 END) FROM historical_term_deposit_rates`,
    },
    {
      label: 'orphan_product_presence_count',
      expectedAlias: 'orphan_count',
      sql: `SELECT COUNT(*) AS orphan_count FROM product_presence_status p LEFT JOIN product_catalog c ON c.dataset_kind = p.section AND c.bank_name = p.bank_name AND c.product_id = p.product_id WHERE c.product_id IS NULL`,
    },
    {
      label: 'orphan_product_presence_sample',
      expectedAlias: 'section',
      sql: `SELECT p.section, p.bank_name, p.product_id, p.last_seen_collection_date, p.last_seen_at FROM product_presence_status p LEFT JOIN product_catalog c ON c.dataset_kind = p.section AND c.bank_name = p.bank_name AND c.product_id = p.product_id WHERE c.product_id IS NULL ORDER BY p.last_seen_at DESC LIMIT 20`,
    },
    {
      label: 'fetch_event_orphan_count',
      expectedAlias: 'orphan_count',
      sql: `SELECT COUNT(*) AS orphan_count FROM fetch_events fe LEFT JOIN raw_objects ro ON ro.content_hash = fe.content_hash WHERE ro.content_hash IS NULL`,
    },
    {
      label: 'fetch_event_orphan_sample',
      expectedAlias: 'id',
      sql: `SELECT fe.id, fe.source_type, fe.fetched_at, fe.source_url, fe.content_hash FROM fetch_events fe LEFT JOIN raw_objects ro ON ro.content_hash = fe.content_hash WHERE ro.content_hash IS NULL ORDER BY fe.fetched_at DESC LIMIT 20`,
    },
    {
      label: 'raw_payload_orphan_count',
      expectedAlias: 'orphan_count',
      sql: `SELECT COUNT(*) AS orphan_count FROM raw_payloads rp LEFT JOIN raw_objects ro ON ro.content_hash = rp.content_hash WHERE ro.content_hash IS NULL`,
    },
    {
      label: 'runs_with_no_outputs_count',
      expectedAlias: 'runs_with_no_outputs',
      sql: `WITH run_outputs AS (
  SELECT rr.run_id, (SELECT COUNT(*) FROM historical_loan_rates hl WHERE hl.run_id = rr.run_id) AS home_rows,
    (SELECT COUNT(*) FROM historical_savings_rates hs WHERE hs.run_id = rr.run_id) AS savings_rows,
    (SELECT COUNT(*) FROM historical_term_deposit_rates ht WHERE ht.run_id = rr.run_id) AS td_rows
  FROM run_reports rr
)
SELECT COUNT(*) AS runs_with_no_outputs FROM run_outputs WHERE (home_rows + savings_rows + td_rows) = 0`,
    },
    {
      label: 'exact_duplicate_home',
      expectedAlias: 'duplicate_groups',
      sql: `WITH g AS (SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n FROM historical_loan_rates GROUP BY series_key, collection_date, run_id, interest_rate HAVING COUNT(*) > 1)
SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS duplicate_rows FROM g`,
    },
    {
      label: 'exact_duplicate_savings',
      expectedAlias: 'duplicate_groups',
      sql: `WITH g AS (SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n FROM historical_savings_rates GROUP BY series_key, collection_date, run_id, interest_rate HAVING COUNT(*) > 1)
SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS duplicate_rows FROM g`,
    },
    {
      label: 'exact_duplicate_td',
      expectedAlias: 'duplicate_groups',
      sql: `WITH g AS (SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n FROM historical_term_deposit_rates GROUP BY series_key, collection_date, run_id, interest_rate HAVING COUNT(*) > 1)
SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS duplicate_rows FROM g`,
    },
    {
      label: 'out_of_range_rates_home',
      expectedAlias: 'out_of_range_count',
      sql: `SELECT COUNT(*) AS out_of_range_count FROM historical_loan_rates WHERE interest_rate < 0.5 OR interest_rate > 25`,
    },
    {
      label: 'out_of_range_rates_savings',
      expectedAlias: 'out_of_range_count',
      sql: `SELECT COUNT(*) AS out_of_range_count FROM historical_savings_rates WHERE interest_rate < 0 OR interest_rate > 15`,
    },
    {
      label: 'out_of_range_rates_td',
      expectedAlias: 'out_of_range_count',
      sql: `SELECT COUNT(*) AS out_of_range_count FROM historical_term_deposit_rates WHERE interest_rate < 0 OR interest_rate > 15`,
    },
    {
      label: 'null_required_home',
      expectedAlias: 'null_count',
      sql: `SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name,'')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id,'')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date,'')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS null_count FROM historical_loan_rates`,
    },
    {
      label: 'null_required_savings',
      expectedAlias: 'null_count',
      sql: `SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name,'')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id,'')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date,'')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS null_count FROM historical_savings_rates`,
    },
    {
      label: 'null_required_td',
      expectedAlias: 'null_count',
      sql: `SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name,'')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id,'')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date,'')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS null_count FROM historical_term_deposit_rates`,
    },
    {
      label: 'orphan_latest_home',
      expectedAlias: 'orphan_count',
      sql: `SELECT COUNT(*) AS orphan_count FROM latest_home_loan_series l LEFT JOIN (SELECT DISTINCT series_key FROM historical_loan_rates) h ON h.series_key = l.series_key WHERE h.series_key IS NULL`,
    },
    {
      label: 'orphan_latest_savings',
      expectedAlias: 'orphan_count',
      sql: `SELECT COUNT(*) AS orphan_count FROM latest_savings_series l LEFT JOIN (SELECT DISTINCT series_key FROM historical_savings_rates) h ON h.series_key = l.series_key WHERE h.series_key IS NULL`,
    },
    {
      label: 'orphan_latest_td',
      expectedAlias: 'orphan_count',
      sql: `SELECT COUNT(*) AS orphan_count FROM latest_td_series l LEFT JOIN (SELECT DISTINCT series_key FROM historical_term_deposit_rates) h ON h.series_key = l.series_key WHERE h.series_key IS NULL`,
    },
    {
      label: 'freshness_indicator',
      expectedAlias: 'dataset',
      sql: `WITH dataset_latest AS (
  SELECT 'home_loans' AS dataset, MAX(collection_date) AS global_latest, MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest FROM historical_loan_rates
  UNION ALL SELECT 'savings', MAX(collection_date), MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) FROM historical_savings_rates
  UNION ALL SELECT 'term_deposits', MAX(collection_date), MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) FROM historical_term_deposit_rates
)
SELECT dataset, global_latest, scheduled_latest, CASE WHEN global_latest IS NULL OR scheduled_latest IS NULL THEN NULL WHEN global_latest = scheduled_latest THEN 0 ELSE 1 END AS latest_global_mismatch FROM dataset_latest ORDER BY dataset`,
    },
  ]
}

function ensureOutputPath(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function renderMarkdownReport(report: DataIntegrityReport): string {
  const lines: string[] = [
    '# Data integrity audit report',
    '',
    `Generated: ${report.generated_at}`,
    `Target DB: ${report.target_db}`,
    '',
    '## Summary',
    '',
    `- Total checks: ${report.summary.total_checks}`,
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    `- Dead data issues: ${report.summary.dead_data_issues}`,
    `- Invalid data issues: ${report.summary.invalid_data_issues}`,
    `- Duplicate data issues: ${report.summary.duplicate_data_issues}`,
    `- Other issues: ${report.summary.other_issues}`,
    '',
    '## Findings',
    '',
  ]
  for (const f of report.findings) {
    const status = f.passed ? 'PASS' : 'FAIL'
    lines.push(`### ${f.check} [${f.category}] ${status}`)
    lines.push('')
    if (f.count !== undefined) lines.push(`- Count: ${f.count}`)
    if (f.detail && Object.keys(f.detail).length > 0) {
      lines.push('- Detail: ' + JSON.stringify(f.detail))
    }
    if (f.sample && f.sample.length > 0) {
      lines.push('- Sample (up to 20):')
      for (const row of f.sample) {
        lines.push('  - ' + JSON.stringify(row))
      }
    }
    lines.push('')
  }
  lines.push('## Executed commands')
  lines.push('')
  for (const c of report.executed_commands) {
    lines.push(`- \`${c.command}\` (exit ${c.exit_code})`)
  }
  return lines.join('\n')
}

export function runDataIntegrityAudit(
  args: string[],
  spawnRunner: SpawnRunner = spawnSync,
): DataIntegrityReport {
  const config = parseConfig(args)
  const queries = buildQueries()
  const findings: IntegrityFinding[] = []
  const executedCommands: Array<{ label: string; command: string; exit_code: number }> = []
  const retries: unknown[] = []

  const run = (spec: QuerySpec): Array<Record<string, unknown>> => {
    const result = runQuery(config.db, spec, spawnRunner)
    executedCommands.push({ label: spec.label, command: result.command, exit_code: result.exitCode })
    if (result.retry) retries.push(result.retry)
    return result.rows
  }

  const runSafe = (
    spec: QuerySpec,
    interpret: (rows: Array<Record<string, unknown>>) => void,
  ): void => {
    try {
      const rows = run(spec)
      interpret(rows)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      executedCommands.push({ label: spec.label, command: '(throw)', exit_code: 1 })
      findings.push({
        category: 'erroneous',
        check: spec.label,
        passed: false,
        detail: { error: message },
      })
    }
  }

  let productKeyConsistency: Array<Record<string, unknown>> = []
  runSafe(queries[0], () => {})
  runSafe(queries[1], (rows) => {
    productKeyConsistency = rows
  })
  if (productKeyConsistency.length > 0) {
    const missingTotal = productKeyConsistency.reduce((sum, r) => sum + num(r.missing_series_key), 0)
    const mismatchedTotal = productKeyConsistency.reduce((sum, r) => sum + num(r.mismatched_series_key), 0)
    findings.push({
      category: 'invalid',
      check: 'product_key_consistency',
      passed: missingTotal === 0 && mismatchedTotal === 0,
      count: missingTotal + mismatchedTotal,
      detail: {
        missing_series_key_total: missingTotal,
        mismatched_series_key_total: mismatchedTotal,
        by_dataset: productKeyConsistency,
      },
    })
  }

  runSafe(queries[2], (rows) => {
    const presenceCount = num(rows[0]?.orphan_count)
    let sample: Array<Record<string, unknown>> = []
    try {
      sample = run(queries[3])
    } catch {
      // optional sample
    }
    findings.push({
      category: 'dead',
      check: 'orphan_product_presence_status',
      passed: presenceCount === 0,
      count: presenceCount,
      detail: { orphan_count: presenceCount },
      sample: sample.length ? sample : undefined,
    })
  })

  runSafe(queries[4], (rows) => {
    const feCount = num(rows[0]?.orphan_count)
    let sample: Array<Record<string, unknown>> = []
    try {
      sample = run(queries[5])
    } catch {
      // optional sample
    }
    findings.push({
      category: 'dead',
      check: 'fetch_event_raw_object_linkage',
      passed: feCount === 0,
      count: feCount,
      detail: { orphan_count: feCount },
      sample: sample.length ? sample : undefined,
    })
  })

  runSafe(queries[6], (rows) => {
    const rpCount = num(rows[0]?.orphan_count)
    findings.push({
      category: 'dead',
      check: 'legacy_raw_payload_backlog',
      passed: true,
      count: rpCount,
      detail: { orphan_count: rpCount },
    })
  })

  runSafe(queries[7], (rows) => {
    const runsNoOut = num(rows[0]?.runs_with_no_outputs)
    findings.push({
      category: 'erroneous',
      check: 'runs_with_no_outputs',
      passed: runsNoOut === 0,
      count: runsNoOut,
      detail: { runs_with_no_outputs: runsNoOut },
    })
  })

  runSafe(queries[8], (rows) => {
    findings.push({
      category: 'duplicate',
      check: 'exact_duplicate_rows_home_loans',
      passed: num(rows[0]?.duplicate_groups) === 0,
      count: num(rows[0]?.duplicate_rows),
      detail: { duplicate_groups: num(rows[0]?.duplicate_groups), duplicate_rows: num(rows[0]?.duplicate_rows) },
    })
  })
  runSafe(queries[9], (rows) => {
    findings.push({
      category: 'duplicate',
      check: 'exact_duplicate_rows_savings',
      passed: num(rows[0]?.duplicate_groups) === 0,
      count: num(rows[0]?.duplicate_rows),
      detail: { duplicate_groups: num(rows[0]?.duplicate_groups), duplicate_rows: num(rows[0]?.duplicate_rows) },
    })
  })
  runSafe(queries[10], (rows) => {
    findings.push({
      category: 'duplicate',
      check: 'exact_duplicate_rows_term_deposits',
      passed: num(rows[0]?.duplicate_groups) === 0,
      count: num(rows[0]?.duplicate_rows),
      detail: { duplicate_groups: num(rows[0]?.duplicate_groups), duplicate_rows: num(rows[0]?.duplicate_rows) },
    })
  })

  runSafe(queries[11], (rows) => {
    const c = num(rows[0]?.out_of_range_count)
    findings.push({
      category: 'invalid',
      check: 'out_of_range_rates_home_loans',
      passed: c === 0,
      count: c,
      detail: { bounds: '0.5-25', out_of_range_count: c },
    })
  })
  runSafe(queries[12], (rows) => {
    const c = num(rows[0]?.out_of_range_count)
    findings.push({
      category: 'invalid',
      check: 'out_of_range_rates_savings',
      passed: c === 0,
      count: c,
      detail: { bounds: '0-15', out_of_range_count: c },
    })
  })
  runSafe(queries[13], (rows) => {
    const c = num(rows[0]?.out_of_range_count)
    findings.push({
      category: 'invalid',
      check: 'out_of_range_rates_term_deposits',
      passed: c === 0,
      count: c,
      detail: { bounds: '0-15', out_of_range_count: c },
    })
  })

  runSafe(queries[14], (rows) => {
    const c = num(rows[0]?.null_count)
    findings.push({
      category: 'invalid',
      check: 'null_required_fields_home_loans',
      passed: c === 0,
      count: c,
      detail: { null_count: c },
    })
  })
  runSafe(queries[15], (rows) => {
    const c = num(rows[0]?.null_count)
    findings.push({
      category: 'invalid',
      check: 'null_required_fields_savings',
      passed: c === 0,
      count: c,
      detail: { null_count: c },
    })
  })
  runSafe(queries[16], (rows) => {
    const c = num(rows[0]?.null_count)
    findings.push({
      category: 'invalid',
      check: 'null_required_fields_term_deposits',
      passed: c === 0,
      count: c,
      detail: { null_count: c },
    })
  })

  runSafe(queries[17], (rows) => {
    const c = num(rows[0]?.orphan_count)
    findings.push({
      category: 'dead',
      check: 'orphan_latest_home_loan_series',
      passed: c === 0,
      count: c,
      detail: { orphan_count: c },
    })
  })
  runSafe(queries[18], (rows) => {
    const c = num(rows[0]?.orphan_count)
    findings.push({
      category: 'dead',
      check: 'orphan_latest_savings_series',
      passed: c === 0,
      count: c,
      detail: { orphan_count: c },
    })
  })
  runSafe(queries[19], (rows) => {
    const c = num(rows[0]?.orphan_count)
    findings.push({
      category: 'dead',
      check: 'orphan_latest_td_series',
      passed: c === 0,
      count: c,
      detail: { orphan_count: c },
    })
  })

  runSafe(queries[20], (rows) => {
    const mismatchCount = (rows || []).filter((r) => num(r.latest_global_mismatch) === 1).length
    findings.push({
      category: 'indicator',
      check: 'latest_vs_global_freshness',
      passed: true,
      detail: { mismatch_dataset_count: mismatchCount, datasets: rows },
    })
  })

  const failed = findings.filter((f) => !f.passed)
  const deadIssues = failed.filter((f) => f.category === 'dead').length
  const invalidIssues = failed.filter((f) => f.category === 'invalid').length
  const duplicateIssues = failed.filter((f) => f.category === 'duplicate').length
  const otherIssues = failed.filter((f) => !['dead', 'invalid', 'duplicate'].includes(f.category)).length

  const report: DataIntegrityReport = {
    ok: failed.length === 0,
    generated_at: new Date().toISOString(),
    target_db: config.db,
    executed_commands: executedCommands,
    retry: retries.length > 0 ? retries : null,
    findings,
    summary: {
      total_checks: findings.length,
      passed: findings.filter((f) => f.passed).length,
      failed: failed.length,
      dead_data_issues: deadIssues,
      invalid_data_issues: invalidIssues,
      duplicate_data_issues: duplicateIssues,
      other_issues: otherIssues,
    },
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
    const report = runDataIntegrityAudit(args)
    process.stdout.write(
      `${JSON.stringify({ ok: report.ok, output_json: config.outputJson, output_md: config.outputMd, generated_at: report.generated_at, failed_count: report.summary.failed })}\n`,
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
  main(process.argv.slice(2))
}
