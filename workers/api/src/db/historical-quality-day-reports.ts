import type { HistoricalQualityDailyRow, HistoricalQualityFindingRow, HistoricalQualityRunRow, HistoricalQualityScope } from './historical-quality-types'
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
  return (rows.results ?? []).map((row) => ({
    collection_date: row.collection_date,
    audit_run_id: row.audit_run_id,
    trigger_source: row.trigger_source,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    overall: row,
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

function parametersForRow(collectionDate: string, scope: HistoricalQualityScope, row: HistoricalQualityDailyRow, scopeRows: HistoricalQualityDailyRow[]): HistoricalQualityDayParameter[] {
  const summary = readHistoricalQualityDailySummary(row)
  const scopeMap = Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, candidate]))
  const scopeSummaryMap = Object.fromEntries(
    scopeRows.map((candidate) => [candidate.scope, readHistoricalQualityDailySummary(candidate)]),
  )
  const counts = summary?.counts
  const topLenders = summary?.top_degraded_lenders ?? []
  return [
    parameter(collectionDate, `${scope} rows`, 'row_count', row.row_count, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, candidate.row_count])) }),
    parameter(collectionDate, `${scope} lenders`, 'bank_count', row.bank_count, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, candidate.bank_count])) }),
    parameter(collectionDate, `${scope} products`, 'product_count', row.product_count, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, candidate.product_count])) }),
    parameter(collectionDate, `${scope} new products`, 'new_product_count', counts?.new_product_count ?? 0, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, readHistoricalQualityDailySummary(candidate)?.counts.new_product_count ?? 0])) }),
    parameter(collectionDate, `${scope} lost products`, 'lost_product_count', counts?.lost_product_count ?? 0, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, readHistoricalQualityDailySummary(candidate)?.counts.lost_product_count ?? 0])) }),
    parameter(collectionDate, `${scope} CDR-missing products`, 'cdr_missing_product_count', counts?.cdr_missing_product_count ?? 0, { by_scope: Object.fromEntries(scopeRows.map((candidate) => [candidate.scope, readHistoricalQualityDailySummary(candidate)?.counts.cdr_missing_product_count ?? 0])) }),
    parameter(collectionDate, `${scope} same-ID renamed products`, 'renamed_same_id_count', counts?.renamed_same_id_count ?? 0, { summary: scopeSummaryMap[scope] }),
    parameter(collectionDate, `${scope} same-ID same-name same-rate other-detail changes`, 'same_id_name_same_rate_other_detail_changed_count', counts?.same_id_name_same_rate_other_detail_changed_count ?? 0, { summary: scopeSummaryMap[scope] }),
    parameter(collectionDate, `${scope} changed-ID same-name products`, 'changed_id_same_name_count', counts?.changed_id_same_name_count ?? 0, { summary: scopeSummaryMap[scope] }),
    parameter(collectionDate, `${scope} products with rate increases`, 'increased_rate_product_count', counts?.increased_rate_product_count ?? 0, { series_count: counts?.increased_rate_series_count ?? 0 }),
    parameter(collectionDate, `${scope} products with rate decreases`, 'decreased_rate_product_count', counts?.decreased_rate_product_count ?? 0, { series_count: counts?.decreased_rate_series_count ?? 0 }),
    parameter(collectionDate, `${scope} provenance score`, 'provenance_score_v1', pct(row.provenance_score_v1), { exact: row.provenance_exact_count, reconstructed: row.provenance_reconstructed_count, legacy: row.provenance_legacy_count, quarantined: row.provenance_quarantined_count }),
    parameter(collectionDate, `${scope} structural score`, 'structural_score_v1', pct(row.structural_score_v1), { duplicate_rows: row.duplicate_rows, missing_required_rows: row.missing_required_rows, invalid_value_rows: row.invalid_value_rows, cross_table_conflict_rows: row.cross_table_conflict_rows }),
    parameter(collectionDate, `${scope} transition score`, 'transition_score_v1', pct(row.transition_score_v1), { unexplained_appearances: row.unexplained_appearances, unexplained_disappearances: row.unexplained_disappearances, changed_series_count: row.changed_series_count }),
    parameter(collectionDate, `${scope} evidence confidence`, 'evidence_confidence_score_v1', pct(row.evidence_confidence_score_v1), parseJson<Record<string, unknown>>(row.evidence_json)),
    parameter(collectionDate, `${scope} top degraded lenders`, 'top_degraded_lenders', topLenders.map((lender) => `${lender.rank}. ${lender.bank_name} (${lender.degradation_score.toFixed(2)})`).join('; ') || 'None', { top_degraded_lenders: topLenders, scope_rows: Object.keys(scopeMap) }),
  ]
}

function buildPlainText(detail: {
  collectionDate: string
  run: HistoricalQualityRunRow
  rows: HistoricalQualityDailyRow[]
}): string {
  const overall = detail.rows.find((row) => row.scope === 'overall')
  if (!overall) return `${detail.collectionDate}: no historical quality row found.`
  const summary = readHistoricalQualityDailySummary(overall)
  const counts = summary?.counts
  const lenders = summary?.top_degraded_lenders ?? []
  return [
    `Historical quality day report for ${detail.collectionDate}`,
    `Run: ${detail.run.audit_run_id} (${detail.run.trigger_source}, ${detail.run.status})`,
    `Rows ${overall.row_count} | lenders ${overall.bank_count} | products ${overall.product_count}`,
    `New ${counts?.new_product_count ?? 0} | lost ${counts?.lost_product_count ?? 0} | CDR-missing ${counts?.cdr_missing_product_count ?? 0}`,
    `Renamed same ID ${counts?.renamed_same_id_count ?? 0} | same ID/name/rate other-detail ${counts?.same_id_name_same_rate_other_detail_changed_count ?? 0} | changed ID same name ${counts?.changed_id_same_name_count ?? 0}`,
    `Rate increases ${counts?.increased_rate_product_count ?? 0} | rate decreases ${counts?.decreased_rate_product_count ?? 0}`,
    `Structural ${pct(overall.structural_score_v1)} | provenance ${pct(overall.provenance_score_v1)} | transition ${pct(overall.transition_score_v1)} | evidence ${pct(overall.evidence_confidence_score_v1)}`,
    lenders.length
      ? `Top degraded lenders: ${lenders.map((lender) => `${lender.rank}. ${lender.bank_name} (${lender.degradation_score.toFixed(2)})`).join('; ')}`
      : 'Top degraded lenders: none',
  ].join('\n')
}

export async function getHistoricalQualityDayDetail(db: D1Database, collectionDate: string): Promise<{
  run: HistoricalQualityRunRow | null
  rows: HistoricalQualityDailyRow[]
  findings: HistoricalQualityFindingRow[]
  plain_text: string
  parameters: HistoricalQualityDayParameter[]
}> {
  const selected = await loadRunForDate(db, collectionDate)
  if (!selected) {
    return { run: null, rows: [], findings: [], plain_text: `${collectionDate}: no historical quality run found.`, parameters: [] }
  }
  const [run, rowSet, findingSet] = await Promise.all([
    db.prepare(`SELECT * FROM historical_quality_runs WHERE audit_run_id = ?1`).bind(selected.audit_run_id).first<HistoricalQualityRunRow>(),
    db.prepare(`SELECT * FROM historical_quality_daily WHERE audit_run_id = ?1 AND collection_date = ?2 ORDER BY scope ASC`).bind(selected.audit_run_id, collectionDate).all<HistoricalQualityDailyRow>(),
    db.prepare(`SELECT * FROM historical_quality_findings WHERE audit_run_id = ?1 AND collection_date = ?2 ORDER BY severity_weight DESC, id ASC`).bind(selected.audit_run_id, collectionDate).all<HistoricalQualityFindingRow>(),
  ])
  const rows = rowSet.results ?? []
  const scopeRows = rows.filter((row) => row.scope !== 'overall')
  const overall = rows.find((row) => row.scope === 'overall')
  const parameters = overall ? parametersForRow(collectionDate, 'overall', overall, scopeRows) : []
  return {
    run: run ?? null,
    rows,
    findings: findingSet.results ?? [],
    plain_text: run ? buildPlainText({ collectionDate, run, rows }) : `${collectionDate}: no historical quality run found.`,
    parameters,
  }
}
