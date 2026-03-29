/**
 * In-Worker data integrity audit. Runs the same checks as the CLI audit script
 * using D1 directly; used for admin UI and daily cron.
 */

import { runIntegrityChecks } from './integrity-checks'
import { runEconomicCoverageAudit } from './economic-coverage-audit'
import { getHistoricalProvenanceSummary } from './historical-provenance'

export type IntegrityFinding = {
  category: 'dead' | 'invalid' | 'duplicate' | 'erroneous' | 'indicator'
  check: string
  passed: boolean
  count?: number
  detail?: Record<string, unknown>
}

export type IntegrityAuditSummary = {
  total_checks: number
  passed: number
  failed: number
  dead_data_issues: number
  invalid_data_issues: number
  duplicate_data_issues: number
  other_issues: number
}

export type IntegrityAuditResult = {
  ok: boolean
  status: 'green' | 'amber' | 'red'
  checked_at: string
  duration_ms: number
  findings: IntegrityFinding[]
  summary: IntegrityAuditSummary
}

const INFORMATIONAL_CHECKS = new Set([
  'legacy_raw_payload_backlog',
  'latest_vs_global_freshness_indicator',
  'latest_vs_global_freshness',
  'economic_stale_status_rows',
  'recent_persisted_write_activity',
  /** Warn-only economic coverage slices (upstream transport / proxy), not D1 schema or rates integrity. */
  'economic_transient_upstream_transport',
  'economic_proxy_error_status_rows',
  'historical_provenance_legacy_unverifiable_rows',
])

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function runDataIntegrityAudit(
  db: D1Database,
  timezone = 'Australia/Melbourne',
): Promise<IntegrityAuditResult> {
  const startedAt = Date.now()
  const checkedAt = new Date().toISOString()
  const findings: IntegrityFinding[] = []

  let integrity: Awaited<ReturnType<typeof runIntegrityChecks>>
  let economicCoverage: Awaited<ReturnType<typeof runEconomicCoverageAudit>> | null = null
  let provenanceSummary: Awaited<ReturnType<typeof getHistoricalProvenanceSummary>> | null = null
  try {
    integrity = await runIntegrityChecks(db, timezone, { includeAnomalyProbes: true })
  } catch (e) {
    findings.push({
      category: 'erroneous',
      check: 'integrity_checks_run',
      passed: false,
      detail: { error: errorMessage(e), hint: 'runIntegrityChecks failed; check D1 tables and schema.' },
    })
    integrity = { ok: false, checked_at: checkedAt, checks: [] }
  }

  try {
    economicCoverage = await runEconomicCoverageAudit(db, { checkedAt })
  } catch (e) {
    findings.push({
      category: 'erroneous',
      check: 'economic_coverage_run',
      passed: false,
      detail: { error: errorMessage(e), hint: 'economic coverage audit failed; check economic tables and schema.' },
    })
  }

  try {
    provenanceSummary = await getHistoricalProvenanceSummary(db, { lookbackDays: 3650, limit: 20 })
  } catch (e) {
    findings.push({
      category: 'indicator',
      check: 'historical_provenance_summary_run',
      passed: false,
      detail: { error: errorMessage(e), hint: 'Historical provenance summary failed to execute.' },
    })
  }

  for (const c of integrity.checks) {
    const category =
      c.name === 'product_key_consistency'
        ? 'invalid'
        : c.name === 'recent_same_day_series_conflicts' || c.name === 'recent_abrupt_rate_movements'
          ? 'invalid'
        : c.name === 'current_collection_exact_provenance'
          ? 'dead'
        : c.name.startsWith('orphan_') || c.name.includes('linkage') || c.name === 'legacy_raw_payload_backlog'
          ? 'dead'
        : c.name === 'runs_with_no_outputs' ||
              c.name === 'current_collection_expected_product_roster' ||
              c.name === 'recent_lender_dataset_write_mismatches' ||
              c.name === 'recent_blocked_write_contract_violations'
            ? 'erroneous'
            : c.name.includes('freshness') ||
                c.name === 'recent_anomaly_volume' ||
                c.name === 'run_report_status_distribution' ||
                c.name === 'dataset_staleness' ||
                c.name === 'recent_persisted_write_activity'
              ? 'indicator'
              : 'erroneous'
    const detail = (c.detail || {}) as Record<string, unknown>
    const count =
      typeof detail.orphan_count === 'number'
        ? detail.orphan_count
        : typeof detail.runs_with_no_outputs === 'number'
          ? detail.runs_with_no_outputs
          : typeof detail.missing_row_count === 'number'
            ? detail.missing_row_count
            : typeof detail.unresolved_row_count === 'number'
              ? detail.unresolved_row_count
              : typeof detail.mismatched_run_count === 'number'
                ? detail.mismatched_run_count
                : typeof detail.blocked_violation_count === 'number'
                  ? detail.blocked_violation_count
                  : typeof detail.conflict_group_count === 'number'
                    ? detail.conflict_group_count
                    : typeof detail.movement_count === 'number'
                      ? detail.movement_count
                      : typeof detail.unverified_row_count === 'number'
                        ? detail.unverified_row_count
                        : typeof detail.failing_scope_count === 'number'
                          ? detail.failing_scope_count
          : detail.missing_series_key_total != null || detail.mismatched_series_key_total != null
            ? num(detail.missing_series_key_total) + num(detail.mismatched_series_key_total)
            : undefined
    findings.push({
      category,
      check: c.name,
      passed: c.passed,
      count,
      detail: c.detail as Record<string, unknown>,
    })
  }

  try {
    const [orphanLatestHome, orphanLatestSavings, orphanLatestTd] = await Promise.all([
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM latest_home_loan_series l
           LEFT JOIN (SELECT DISTINCT series_key FROM historical_loan_rates) h ON h.series_key = l.series_key WHERE h.series_key IS NULL`,
        )
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM latest_savings_series l
           LEFT JOIN (SELECT DISTINCT series_key FROM historical_savings_rates) h ON h.series_key = l.series_key WHERE h.series_key IS NULL`,
        )
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM latest_td_series l
           LEFT JOIN (SELECT DISTINCT series_key FROM historical_term_deposit_rates) h ON h.series_key = l.series_key WHERE h.series_key IS NULL`,
        )
        .first<{ n: number }>(),
    ])
    for (const [name, row] of [
      ['orphan_latest_home_loan_series', orphanLatestHome],
      ['orphan_latest_savings_series', orphanLatestSavings],
      ['orphan_latest_td_series', orphanLatestTd],
    ] as const) {
      const n = num(row?.n)
      findings.push({
        category: 'dead',
        check: name,
        passed: n === 0,
        count: n,
        detail: { orphan_count: n },
      })
    }
  } catch (e) {
    findings.push({
      category: 'dead',
      check: 'orphan_latest_series_checks',
      passed: false,
      detail: { error: errorMessage(e), hint: 'Tables latest_*_series or historical_*_rates may be missing.' },
    })
  }

  if (economicCoverage) {
    for (const finding of economicCoverage.findings) {
      const category =
        finding.code === 'economic_stale_status_rows'
          ? 'indicator'
          : (
            finding.code === 'economic_unknown_status_rows' ||
            finding.code === 'economic_unknown_observation_rows' ||
            finding.code === 'economic_missing_status_rows' ||
            finding.code === 'economic_missing_observation_rows'
          )
            ? 'dead'
            : (
              finding.code === 'economic_status_field_mismatches' ||
              finding.code === 'economic_observation_field_mismatches' ||
              finding.code === 'economic_status_value_mismatches' ||
              finding.code === 'economic_future_observation_dates' ||
              finding.code === 'economic_release_before_observation'
            )
              ? 'invalid'
              : 'erroneous'

      findings.push({
        category,
        check: finding.code,
        passed: finding.count === 0,
        count: finding.count,
        detail: {
          severity: finding.severity,
          message: finding.message,
          sample: finding.sample,
          summary: economicCoverage.summary,
        },
      })
    }
  }

  if (provenanceSummary?.available) {
    findings.push({
      category: 'dead',
      check: 'historical_provenance_legacy_unverifiable_rows',
      passed: provenanceSummary.legacy_unverifiable_rows === 0,
      count: provenanceSummary.legacy_unverifiable_rows,
      detail: provenanceSummary,
    })
    findings.push({
      category: 'invalid',
      check: 'historical_provenance_quarantined_rows',
      passed: provenanceSummary.quarantined_rows === 0,
      count: provenanceSummary.quarantined_rows,
      detail: provenanceSummary,
    })
  }

  try {
    const [dupHome, dupSavings, dupTd] = await Promise.all([
      db
        .prepare(
          `WITH g AS (SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n FROM historical_loan_rates GROUP BY series_key, collection_date, run_id, interest_rate HAVING COUNT(*) > 1)
           SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS duplicate_rows FROM g`,
        )
        .first<{ duplicate_groups: number; duplicate_rows: number }>(),
      db
        .prepare(
          `WITH g AS (SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n FROM historical_savings_rates GROUP BY series_key, collection_date, run_id, interest_rate HAVING COUNT(*) > 1)
           SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS duplicate_rows FROM g`,
        )
        .first<{ duplicate_groups: number; duplicate_rows: number }>(),
      db
        .prepare(
          `WITH g AS (SELECT series_key, collection_date, run_id, interest_rate, COUNT(*) AS n FROM historical_term_deposit_rates GROUP BY series_key, collection_date, run_id, interest_rate HAVING COUNT(*) > 1)
           SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n), 0) AS duplicate_rows FROM g`,
        )
        .first<{ duplicate_groups: number; duplicate_rows: number }>(),
    ])
    for (const [name, row] of [
      ['exact_duplicate_rows_home_loans', dupHome],
      ['exact_duplicate_rows_savings', dupSavings],
      ['exact_duplicate_rows_term_deposits', dupTd],
    ] as const) {
      const groups = num(row?.duplicate_groups)
      const rows = num(row?.duplicate_rows)
      findings.push({
        category: 'duplicate',
        check: name,
        passed: groups === 0,
        count: rows,
        detail: { duplicate_groups: groups, duplicate_rows: rows },
      })
    }
  } catch (e) {
    findings.push({
      category: 'duplicate',
      check: 'exact_duplicate_rows_checks',
      passed: false,
      detail: { error: errorMessage(e), hint: 'historical_*_rates tables may be missing.' },
    })
  }

  try {
    const [oorHome, oorSavings, oorTd] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS n FROM historical_loan_rates WHERE interest_rate < 0.5 OR interest_rate > 25`).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM historical_savings_rates WHERE interest_rate < 0 OR interest_rate > 15`).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM historical_term_deposit_rates WHERE interest_rate < 0 OR interest_rate > 15`).first<{ n: number }>(),
    ])
    for (const [name, row, bounds] of [
      ['out_of_range_rates_home_loans', oorHome, '0.5-25'],
      ['out_of_range_rates_savings', oorSavings, '0-15'],
      ['out_of_range_rates_term_deposits', oorTd, '0-15'],
    ] as const) {
      const n = num(row?.n)
      findings.push({
        category: 'invalid',
        check: name,
        passed: n === 0,
        count: n,
        detail: { bounds, out_of_range_count: n },
      })
    }
  } catch (e) {
    findings.push({
      category: 'invalid',
      check: 'out_of_range_rates_checks',
      passed: false,
      detail: { error: errorMessage(e), hint: 'historical_*_rates tables may be missing.' },
    })
  }

  try {
    const [nullHome, nullSavings, nullTd] = await Promise.all([
      db
        .prepare(
          `SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name,'')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id,'')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date,'')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS n FROM historical_loan_rates`,
        )
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name,'')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id,'')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date,'')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS n FROM historical_savings_rates`,
        )
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT SUM(CASE WHEN bank_name IS NULL OR TRIM(COALESCE(bank_name,'')) = '' OR product_id IS NULL OR TRIM(COALESCE(product_id,'')) = '' OR collection_date IS NULL OR TRIM(COALESCE(collection_date,'')) = '' OR interest_rate IS NULL THEN 1 ELSE 0 END) AS n FROM historical_term_deposit_rates`,
        )
        .first<{ n: number }>(),
    ])
    for (const [name, row] of [
      ['null_required_fields_home_loans', nullHome],
      ['null_required_fields_savings', nullSavings],
      ['null_required_fields_term_deposits', nullTd],
    ] as const) {
      const n = num(row?.n)
      findings.push({
        category: 'invalid',
        check: name,
        passed: n === 0,
        count: n,
        detail: { null_count: n },
      })
    }
  } catch (e) {
    findings.push({
      category: 'invalid',
      check: 'null_required_fields_checks',
      passed: false,
      detail: { error: errorMessage(e), hint: 'historical_*_rates tables may be missing.' },
    })
  }

  const failed = findings.filter((f) => !f.passed)
  const failedNonInformational = failed.filter((f) => !INFORMATIONAL_CHECKS.has(f.check))
  const deadIssues = failed.filter((f) => f.category === 'dead' && !INFORMATIONAL_CHECKS.has(f.check)).length
  const invalidIssues = failed.filter((f) => f.category === 'invalid').length
  const duplicateIssues = failed.filter((f) => f.category === 'duplicate').length
  const otherIssues = failed.filter(
    (f) => !['dead', 'invalid', 'duplicate'].includes(f.category) && !INFORMATIONAL_CHECKS.has(f.check),
  ).length

  const summary: IntegrityAuditSummary = {
    total_checks: findings.length,
    passed: findings.filter((f) => f.passed).length,
    failed: failed.length,
    dead_data_issues: deadIssues,
    invalid_data_issues: invalidIssues,
    duplicate_data_issues: duplicateIssues,
    other_issues: otherIssues,
  }

  let status: 'green' | 'amber' | 'red' = 'green'
  if (failedNonInformational.length > 0) status = 'red'
  else if (failed.length > 0) status = 'amber'

  const durationMs = Date.now() - startedAt

  return {
    ok: failedNonInformational.length === 0,
    status,
    checked_at: checkedAt,
    duration_ms: durationMs,
    findings,
    summary,
  }
}
