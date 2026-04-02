import type { HistoricalQualityDailyRow, HistoricalQualityFindingRow, HistoricalQualityRunRow, HistoricalQualityScope } from './historical-quality-types'
import { computeHistoricalQualityDailySummary, mergeHistoricalQualityDailySummaries, type HistoricalQualityDailySummary } from './historical-quality-daily-summary'
import { readHistoricalQualityDailySummary } from './historical-quality-daily-payload'

type DailyRowWithRun = HistoricalQualityDailyRow &
  Pick<HistoricalQualityRunRow, 'trigger_source' | 'status' | 'started_at' | 'finished_at'>

export type HistoricalQualityDaySummary = {
  collection_date: string
  audit_run_id: string
  trigger_source: HistoricalQualityRunRow['trigger_source']
  status: HistoricalQualityRunRow['status']
  started_at: string
  finished_at: string | null
  overall: DailyRowWithRun
  summary: HistoricalQualityDailySummary | null
}

export type HistoricalQualityDayParameter = {
  key: string
  label: string
  value: string | number
  text: string
  debug: Record<string, unknown>
}

function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw || '{}') as T
  } catch {
    return {} as T
  }
}

function pct(value: number | null | undefined): string {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`
}

function previousDateFromMetrics(row: Pick<HistoricalQualityDailyRow, 'metrics_json'>): string | null {
  const metrics = parseJson<Record<string, unknown>>(row.metrics_json)
  return typeof metrics.previous_date === 'string' && metrics.previous_date ? metrics.previous_date : null
}

async function resolveScopeSummary(
  db: D1Database,
  row: HistoricalQualityDailyRow,
  findings: HistoricalQualityFindingRow[],
): Promise<HistoricalQualityDailySummary | null> {
  const summary = readHistoricalQualityDailySummary(row)
  if (summary) return summary
  if (row.scope === 'overall') return null
  const previousDate = previousDateFromMetrics(row)
  return computeHistoricalQualityDailySummary(db, {
    collectionDate: row.collection_date,
    scope: row.scope,
    previousDate,
    findings: findings.filter((finding) => finding.scope === row.scope),
  })
}

async function resolveOverallSummary(
  db: D1Database,
  overall: HistoricalQualityDailyRow,
  scopeRows: HistoricalQualityDailyRow[],
  findings: HistoricalQualityFindingRow[],
): Promise<HistoricalQualityDailySummary | null> {
  const summary = readHistoricalQualityDailySummary(overall)
  if (summary) return summary
  const summaries: HistoricalQualityDailySummary[] = []
  for (const row of scopeRows) {
    const scopeSummary = await resolveScopeSummary(db, row, findings)
    if (scopeSummary) summaries.push(scopeSummary)
  }
  return summaries.length ? mergeHistoricalQualityDailySummaries(summaries) : null
}

async function loadRunForDate(db: D1Database, collectionDate: string): Promise<{ audit_run_id: string } | null> {
  const row = await db
    .prepare(
      `WITH ranked AS (
         SELECT d.audit_run_id,
                ROW_NUMBER() OVER (
                  PARTITION BY d.collection_date
                  ORDER BY CASE WHEN r.trigger_source = 'scheduled' THEN 0 ELSE 1 END, r.started_at DESC
                ) AS row_num
         FROM historical_quality_daily d
         JOIN historical_quality_runs r ON r.audit_run_id = d.audit_run_id
         WHERE d.collection_date = ?1
           AND d.scope = 'overall'
       )
       SELECT audit_run_id
       FROM ranked
       WHERE row_num = 1`,
    )
    .bind(collectionDate)
    .first<{ audit_run_id: string }>()
  return row ?? null
}

export async function listLatestHistoricalQualityDays(db: D1Database, limit: number): Promise<HistoricalQualityDaySummary[]> {
  const rows = await db
    .prepare(
      `WITH ranked AS (
         SELECT d.*,
                r.trigger_source,
                r.status,
                r.started_at,
                r.finished_at,
                ROW_NUMBER() OVER (
                  PARTITION BY d.collection_date
                  ORDER BY CASE WHEN r.trigger_source = 'scheduled' THEN 0 ELSE 1 END, r.started_at DESC
                ) AS row_num
         FROM historical_quality_daily d
         JOIN historical_quality_runs r ON r.audit_run_id = d.audit_run_id
         WHERE d.scope = 'overall'
       )
       SELECT *
       FROM ranked
       WHERE row_num = 1
       ORDER BY collection_date DESC
       LIMIT ?1`,
    )
    .bind(Math.max(1, Math.min(365, Math.floor(limit))))
    .all<DailyRowWithRun>()
  return Promise.all((rows.results ?? []).map(async (row) => {
    let summary = readHistoricalQualityDailySummary(row)
    if (!summary) {
      const scopeSet = await db
        .prepare(`SELECT * FROM historical_quality_daily WHERE audit_run_id = ?1 AND collection_date = ?2 AND scope != 'overall' ORDER BY scope ASC`)
        .bind(row.audit_run_id, row.collection_date)
        .all<HistoricalQualityDailyRow>()
      const findingSet = await db
        .prepare(`SELECT * FROM historical_quality_findings WHERE audit_run_id = ?1 AND collection_date = ?2 ORDER BY id ASC`)
        .bind(row.audit_run_id, row.collection_date)
        .all<HistoricalQualityFindingRow>()
      summary = await resolveOverallSummary(db, row, scopeSet.results ?? [], findingSet.results ?? [])
    }
    return {
      collection_date: row.collection_date,
      audit_run_id: row.audit_run_id,
      trigger_source: row.trigger_source,
      status: row.status,
      started_at: row.started_at,
      finished_at: row.finished_at,
      overall: row,
      summary,
    }
  }))
}

function parameter(
  collectionDate: string,
  label: string,
  key: string,
  value: string | number,
  debug: Record<string, unknown>,
): HistoricalQualityDayParameter {
  return {
    key,
    label,
    value,
    text: `${collectionDate} ${label}: ${value}`,
    debug,
  }
}

function findingSummary(findings: HistoricalQualityFindingRow[]): string {
  const counts = findings.reduce<Record<string, number>>((summary, finding) => {
    const key = String(finding.severity || 'unknown')
    summary[key] = (summary[key] ?? 0) + 1
    return summary
  }, {})
  const parts = ['severe', 'high', 'medium', 'low']
    .filter((key) => (counts[key] ?? 0) > 0)
    .map((key) => `${key} ${counts[key]}`)
  return parts.length ? parts.join(' | ') : 'No findings'
}

function parametersForRow(
  collectionDate: string,
  scope: HistoricalQualityScope,
  row: HistoricalQualityDailyRow,
  scopeRows: HistoricalQualityDailyRow[],
  findings: HistoricalQualityFindingRow[],
  summary: HistoricalQualityDailySummary | null,
  scopeSummaries: Record<string, HistoricalQualityDailySummary | null>,
): HistoricalQualityDayParameter[] {
  const scopeMap = Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, candidate]))
  const scopeSummaryMap = scopeSummaries
  const counts = summary?.counts
  const topLenders = summary?.top_degraded_lenders ?? []
  const evidence = parseJson<Record<string, unknown>>(row.evidence_json)
  const metrics = parseJson<Record<string, unknown>>(row.metrics_json)
  return [
    parameter(collectionDate, `${scope} rows`, 'row_count', row.row_count, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, candidate.row_count])) }),
    parameter(collectionDate, `${scope} lenders`, 'bank_count', row.bank_count, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, candidate.bank_count])) }),
    parameter(collectionDate, `${scope} products`, 'product_count', row.product_count, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, candidate.product_count])) }),
    parameter(collectionDate, `${scope} new products`, 'new_product_count', counts?.new_product_count ?? 0, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, scopeSummaryMap[candidate.scope]?.counts.new_product_count ?? 0])) }),
    parameter(collectionDate, `${scope} lost products`, 'lost_product_count', counts?.lost_product_count ?? 0, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, scopeSummaryMap[candidate.scope]?.counts.lost_product_count ?? 0])) }),
    parameter(collectionDate, `${scope} CDR-missing products`, 'cdr_missing_product_count', counts?.cdr_missing_product_count ?? 0, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, scopeSummaryMap[candidate.scope]?.counts.cdr_missing_product_count ?? 0])) }),
    parameter(collectionDate, `${scope} same-ID renamed products`, 'renamed_same_id_count', counts?.renamed_same_id_count ?? 0, { summary: scopeSummaryMap[scope] }),
    parameter(collectionDate, `${scope} same-ID same-name same-rate other-detail changes`, 'same_id_name_same_rate_other_detail_changed_count', counts?.same_id_name_same_rate_other_detail_changed_count ?? 0, { summary: scopeSummaryMap[scope] }),
    parameter(collectionDate, `${scope} changed-ID same-name products`, 'changed_id_same_name_count', counts?.changed_id_same_name_count ?? 0, { summary: scopeSummaryMap[scope] }),
    parameter(collectionDate, `${scope} products with rate increases`, 'increased_rate_product_count', counts?.increased_rate_product_count ?? 0, { series_count: counts?.increased_rate_series_count ?? 0 }),
    parameter(collectionDate, `${scope} products with rate decreases`, 'decreased_rate_product_count', counts?.decreased_rate_product_count ?? 0, { series_count: counts?.decreased_rate_series_count ?? 0 }),
    parameter(collectionDate, `${scope} provenance score`, 'provenance_score_v1', pct(row.provenance_score_v1), { exact: row.provenance_exact_count, reconstructed: row.provenance_reconstructed_count, legacy: row.provenance_legacy_count, quarantined: row.provenance_quarantined_count }),
    parameter(collectionDate, `${scope} structural score`, 'structural_score_v1', pct(row.structural_score_v1), { duplicate_rows: row.duplicate_rows, missing_required_rows: row.missing_required_rows, invalid_value_rows: row.invalid_value_rows, cross_table_conflict_rows: row.cross_table_conflict_rows }),
    parameter(collectionDate, `${scope} coverage score`, 'coverage_score_v1', pct(row.coverage_score_v1), { baseline_bank_count: row.baseline_bank_count, baseline_product_count: row.baseline_product_count, baseline_series_count: row.baseline_series_count, baseline_confidence: row.baseline_confidence }),
    parameter(collectionDate, `${scope} anomaly-pressure score`, 'anomaly_pressure_score_v1', pct(row.anomaly_pressure_score_v1), { weighted_affected_series_v1: metrics.weighted_affected_series_v1 ?? null, finding_count: findings.length }),
    parameter(collectionDate, `${scope} continuity score`, 'continuity_score_v1', pct(row.continuity_score_v1), { explained_appearances: row.explained_appearances, unexplained_appearances: row.unexplained_appearances, explained_disappearances: row.explained_disappearances, unexplained_disappearances: row.unexplained_disappearances }),
    parameter(collectionDate, `${scope} count-stability score`, 'count_stability_score_v1', pct(row.count_stability_score_v1), { series_count: row.series_count, baseline_series_count: row.baseline_series_count }),
    parameter(collectionDate, `${scope} rate-flow score`, 'rate_flow_score_v1', pct(row.rate_flow_score_v1), { changed_series_count: row.changed_series_count, weighted_rate_flow_flags_v1: metrics.weighted_rate_flow_flags_v1 ?? null }),
    parameter(collectionDate, `${scope} transition score`, 'transition_score_v1', pct(row.transition_score_v1), { unexplained_appearances: row.unexplained_appearances, unexplained_disappearances: row.unexplained_disappearances, changed_series_count: row.changed_series_count }),
    parameter(collectionDate, `${scope} run-state observability`, 'run_state_observability_score', pct(row.run_state_observability_score), evidence),
    parameter(collectionDate, `${scope} evidence confidence`, 'evidence_confidence_score_v1', pct(row.evidence_confidence_score_v1), evidence),
    parameter(collectionDate, `${scope} findings summary`, 'finding_summary', findingSummary(findings), { findings: findings.map((finding) => ({ criterion_code: finding.criterion_code, severity: finding.severity, summary: finding.summary })) }),
    parameter(collectionDate, `${scope} top degraded lenders`, 'top_degraded_lenders', topLenders.map((lender) => `${lender.rank}. ${lender.bank_name} (${lender.degradation_score.toFixed(2)})`).join('; ') || 'None', { top_degraded_lenders: topLenders, scope_rows: Object.keys(scopeMap) }),
  ]
}

function buildPlainText(detail: {
  collectionDate: string
  run: HistoricalQualityRunRow
  rows: HistoricalQualityDailyRow[]
  summary: HistoricalQualityDailySummary | null
}): string {
  const overall = detail.rows.find((row) => row.scope === 'overall')
  if (!overall) return `${detail.collectionDate}: no historical quality row found.`
  const counts = detail.summary?.counts
  const lenders = detail.summary?.top_degraded_lenders ?? []
  return [
    `${detail.collectionDate}`,
    `run=${detail.run.audit_run_id} src=${detail.run.trigger_source} status=${detail.run.status}`,
    `rows=${overall.row_count} lenders=${overall.bank_count} products=${overall.product_count} new=${counts?.new_product_count ?? 0} lost=${counts?.lost_product_count ?? 0} cdr_miss=${counts?.cdr_missing_product_count ?? 0}`,
    `rename=${counts?.renamed_same_id_count ?? 0} detail=${counts?.same_id_name_same_rate_other_detail_changed_count ?? 0} id_churn=${counts?.changed_id_same_name_count ?? 0} up=${counts?.increased_rate_product_count ?? 0} down=${counts?.decreased_rate_product_count ?? 0}`,
    `struct=${pct(overall.structural_score_v1)} prov=${pct(overall.provenance_score_v1)} cov=${pct(overall.coverage_score_v1)} anom=${pct(overall.anomaly_pressure_score_v1)} cont=${pct(overall.continuity_score_v1)} stab=${pct(overall.count_stability_score_v1)} flow=${pct(overall.rate_flow_score_v1)} trans=${pct(overall.transition_score_v1)} evid=${pct(overall.evidence_confidence_score_v1)}`,
    lenders.length
      ? `top_lenders=${lenders.map((lender) => `${lender.rank}:${lender.bank_name}(${lender.degradation_score.toFixed(2)})`).join('; ')}`
      : 'top_lenders=none',
  ].join('\n')
}

export async function getHistoricalQualityDayDetail(db: D1Database, collectionDate: string): Promise<{
  run: HistoricalQualityRunRow | null
  rows: HistoricalQualityDailyRow[]
  findings: HistoricalQualityFindingRow[]
  summary: HistoricalQualityDailySummary | null
  plain_text: string
  parameters: HistoricalQualityDayParameter[]
}> {
  const selected = await loadRunForDate(db, collectionDate)
  if (!selected) {
    return { run: null, rows: [], findings: [], summary: null, plain_text: `${collectionDate}: no historical quality run found.`, parameters: [] }
  }
  const [run, rowSet, findingSet] = await Promise.all([
    db.prepare(`SELECT * FROM historical_quality_runs WHERE audit_run_id = ?1`).bind(selected.audit_run_id).first<HistoricalQualityRunRow>(),
    db.prepare(`SELECT * FROM historical_quality_daily WHERE audit_run_id = ?1 AND collection_date = ?2 ORDER BY scope ASC`).bind(selected.audit_run_id, collectionDate).all<HistoricalQualityDailyRow>(),
    db.prepare(`SELECT * FROM historical_quality_findings WHERE audit_run_id = ?1 AND collection_date = ?2 ORDER BY severity_weight DESC, id ASC`).bind(selected.audit_run_id, collectionDate).all<HistoricalQualityFindingRow>(),
  ])
  const rows = rowSet.results ?? []
  const scopeRows = rows.filter((row) => row.scope !== 'overall')
  const overall = rows.find((row) => row.scope === 'overall')
  const findings = findingSet.results ?? []
  const scopeSummaries = Object.fromEntries(
    await Promise.all(scopeRows.map(async (row) => [row.scope, await resolveScopeSummary(db, row, findings)])),
  ) as Record<string, HistoricalQualityDailySummary | null>
  const summary = overall ? await resolveOverallSummary(db, overall, scopeRows, findings) : null
  const parameters = overall ? parametersForRow(collectionDate, 'overall', overall, scopeRows, findings, summary, scopeSummaries) : []
  return {
    run: run ?? null,
    rows,
    findings,
    summary,
    plain_text: run ? buildPlainText({ collectionDate, run, rows, summary }) : `${collectionDate}: no historical quality run found.`,
    parameters,
  }
}
