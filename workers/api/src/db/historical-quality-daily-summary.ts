import { provenanceScore, structuralScore } from './historical-quality-metrics'
import { datasetConfigForScope } from './historical-quality-common'
import type { HistoricalQualityFindingRow, HistoricalQualityScope, HistoricalQualitySeverity } from './historical-quality-types'

type NumberRow = Record<string, string | number | null>

type SeverityWeightMap = Record<HistoricalQualitySeverity, number>

export type HistoricalQualityDegradedLender = {
  rank: number
  bank_name: string
  degradation_score: number
  row_count: number
  provenance_score: number
  structural_score: number
  finding_weight: number
  reasons: string[]
}

export type HistoricalQualityDailySummary = {
  version: 'v1'
  counts: {
    new_product_count: number
    lost_product_count: number
    cdr_missing_product_count: number
    renamed_same_id_count: number
    same_id_name_same_rate_other_detail_changed_count: number
    changed_id_same_name_count: number
    increased_rate_product_count: number
    decreased_rate_product_count: number
    increased_rate_series_count: number
    decreased_rate_series_count: number
  }
  top_degraded_lenders: HistoricalQualityDegradedLender[]
}

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function replaceAlias(sql: string, alias: string): string {
  return sql.replaceAll('rates.', `${alias}.`)
}

function safeParseMetrics(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

function lenderWhere(scope: Exclude<HistoricalQualityScope, 'overall'>, lenderCode?: string | null, alias = 'rates', lenderParamIndex = 3): string {
  if (!lenderCode) return ''
  return ` AND EXISTS (
    SELECT 1
    FROM lender_dataset_runs ldr
    WHERE ldr.collection_date = ${alias}.collection_date
      AND ldr.dataset_kind = '${scope}'
      AND ldr.bank_name = ${alias}.bank_name
      AND ldr.lender_code = ?${lenderParamIndex}
  )`
}

async function loadSummaryCounts(
  db: D1Database,
  collectionDate: string,
  scope: Exclude<HistoricalQualityScope, 'overall'>,
  previousDate: string | null,
  lenderCode?: string | null,
): Promise<HistoricalQualityDailySummary['counts']> {
  const config = datasetConfigForScope(scope)
  if (!previousDate) {
    return {
      new_product_count: 0,
      lost_product_count: 0,
      cdr_missing_product_count: 0,
      renamed_same_id_count: 0,
      same_id_name_same_rate_other_detail_changed_count: 0,
      changed_id_same_name_count: 0,
      increased_rate_product_count: 0,
      decreased_rate_product_count: 0,
      increased_rate_series_count: 0,
      decreased_rate_series_count: 0,
    }
  }
  const detailSql = replaceAlias(config.detailFingerprintSql, 'curr')
  const dimSql = replaceAlias(config.dimensionsSql, 'curr')
  const binds = lenderCode ? [collectionDate, previousDate, lenderCode] : [collectionDate, previousDate]
  const row = await db
    .prepare(
      `WITH current_products AS (
         SELECT DISTINCT bank_name, product_id, product_name FROM ${config.table} rates
         WHERE rates.collection_date = ?1${lenderWhere(scope, lenderCode, 'rates', 3)}
       ),
       previous_products AS (
         SELECT DISTINCT bank_name, product_id, product_name FROM ${config.table} rates
         WHERE rates.collection_date = ?2${lenderWhere(scope, lenderCode, 'rates', 3)}
       ),
       current_rows AS (
         SELECT curr.bank_name, curr.product_id, curr.product_name, curr.interest_rate,
                ${dimSql} AS dimension_key,
                ${detailSql} AS detail_fingerprint
         FROM ${config.table} curr
         WHERE curr.collection_date = ?1${lenderWhere(scope, lenderCode, 'curr', 3)}
       ),
       previous_rows AS (
         SELECT prev.bank_name, prev.product_id, prev.product_name, prev.interest_rate,
                ${replaceAlias(config.dimensionsSql, 'prev')} AS dimension_key,
                ${replaceAlias(config.detailFingerprintSql, 'prev')} AS detail_fingerprint
         FROM ${config.table} prev
         WHERE prev.collection_date = ?2${lenderWhere(scope, lenderCode, 'prev', 3)}
       ),
       ordered AS (
         SELECT rates.series_key, rates.bank_name, rates.product_id, rates.interest_rate, rates.collection_date,
                LAG(rates.interest_rate) OVER (PARTITION BY rates.series_key ORDER BY rates.collection_date) AS prev_rate
         FROM ${config.table} rates
         WHERE 1 = 1${lenderWhere(scope, lenderCode, 'rates', 2)}
       ),
       current_run_state AS (
         SELECT bank_name,
                MAX(CASE WHEN finalized_at IS NOT NULL THEN 1 ELSE 0 END) AS finalized_ok,
                MAX(CASE WHEN index_fetch_succeeded = 1 THEN 1 ELSE 0 END) AS index_ok
         FROM lender_dataset_runs
         WHERE collection_date = ?1
           AND dataset_kind = '${scope}'
           ${lenderCode ? 'AND lender_code = ?3' : ''}
         GROUP BY bank_name
       )
       SELECT
         (SELECT COUNT(*) FROM current_products curr
          LEFT JOIN previous_products prev
            ON prev.bank_name = curr.bank_name AND prev.product_id = curr.product_id
          WHERE prev.product_id IS NULL) AS new_product_count,
         (SELECT COUNT(*) FROM previous_products prev
          LEFT JOIN current_products curr
            ON curr.bank_name = prev.bank_name AND curr.product_id = prev.product_id
          WHERE curr.product_id IS NULL) AS lost_product_count,
         (SELECT COUNT(*) FROM previous_products prev
          LEFT JOIN current_run_state rs ON rs.bank_name = prev.bank_name
          WHERE COALESCE(rs.finalized_ok, 0) = 0 OR COALESCE(rs.index_ok, 0) = 0) AS cdr_missing_product_count,
         (SELECT COUNT(*) FROM current_products curr
          JOIN previous_products prev
            ON prev.bank_name = curr.bank_name AND prev.product_id = curr.product_id
          WHERE TRIM(COALESCE(curr.product_name, '')) != TRIM(COALESCE(prev.product_name, ''))) AS renamed_same_id_count,
         (SELECT COUNT(DISTINCT curr.bank_name || '|' || curr.product_id)
          FROM current_rows curr
          JOIN previous_rows prev
            ON prev.bank_name = curr.bank_name
           AND prev.product_id = curr.product_id
           AND prev.dimension_key = curr.dimension_key
          WHERE TRIM(COALESCE(curr.product_name, '')) = TRIM(COALESCE(prev.product_name, ''))
            AND ABS(COALESCE(curr.interest_rate, 0) - COALESCE(prev.interest_rate, 0)) <= 0.000001
            AND curr.detail_fingerprint != prev.detail_fingerprint) AS same_id_name_same_rate_other_detail_changed_count,
         (SELECT COUNT(DISTINCT curr.bank_name || '|' || curr.product_id || '|' || curr.dimension_key)
          FROM current_rows curr
          JOIN previous_rows prev
            ON prev.bank_name = curr.bank_name
           AND TRIM(COALESCE(prev.product_name, '')) = TRIM(COALESCE(curr.product_name, ''))
           AND prev.dimension_key = curr.dimension_key
          WHERE prev.product_id != curr.product_id) AS changed_id_same_name_count,
         (SELECT COUNT(DISTINCT CASE WHEN interest_rate > prev_rate THEN bank_name || '|' || product_id END) FROM ordered WHERE collection_date = ?1) AS increased_rate_product_count,
         (SELECT COUNT(DISTINCT CASE WHEN interest_rate < prev_rate THEN bank_name || '|' || product_id END) FROM ordered WHERE collection_date = ?1) AS decreased_rate_product_count,
         (SELECT COUNT(*) FROM ordered WHERE collection_date = ?1 AND interest_rate > prev_rate) AS increased_rate_series_count,
         (SELECT COUNT(*) FROM ordered WHERE collection_date = ?1 AND interest_rate < prev_rate) AS decreased_rate_series_count`,
    )
    .bind(...binds)
    .first<NumberRow>()
  return {
    new_product_count: num(row?.new_product_count),
    lost_product_count: num(row?.lost_product_count),
    cdr_missing_product_count: num(row?.cdr_missing_product_count),
    renamed_same_id_count: num(row?.renamed_same_id_count),
    same_id_name_same_rate_other_detail_changed_count: num(row?.same_id_name_same_rate_other_detail_changed_count),
    changed_id_same_name_count: num(row?.changed_id_same_name_count),
    increased_rate_product_count: num(row?.increased_rate_product_count),
    decreased_rate_product_count: num(row?.decreased_rate_product_count),
    increased_rate_series_count: num(row?.increased_rate_series_count),
    decreased_rate_series_count: num(row?.decreased_rate_series_count),
  }
}

async function loadTopDegradedLenders(
  db: D1Database,
  collectionDate: string,
  scope: Exclude<HistoricalQualityScope, 'overall'>,
  findings: HistoricalQualityFindingRow[],
): Promise<HistoricalQualityDegradedLender[]> {
  const config = datasetConfigForScope(scope)
  const rowSet = await db
    .prepare(
      `WITH classified AS (
         SELECT rates.bank_name,
                COUNT(*) AS row_count,
                SUM(CASE WHEN rates.product_id IS NULL OR TRIM(rates.product_id) = '' OR rates.product_name IS NULL OR TRIM(rates.product_name) = '' OR rates.series_key IS NULL OR TRIM(rates.series_key) = '' OR rates.source_url IS NULL OR TRIM(rates.source_url) = '' THEN 1 ELSE 0 END) AS missing_required_rows,
                SUM(CASE WHEN rates.interest_rate IS NULL OR rates.interest_rate < ?2 OR rates.interest_rate > ?3 THEN 1 ELSE 0 END) AS invalid_value_rows,
                SUM(CASE WHEN fe.id IS NOT NULL AND ro.content_hash IS NOT NULL AND ((rates.cdr_product_detail_hash IS NOT NULL AND TRIM(rates.cdr_product_detail_hash) != '' AND rates.cdr_product_detail_hash = fe.content_hash) OR (rates.source_url IS NOT NULL AND TRIM(rates.source_url) != '' AND rates.source_url = fe.source_url)) THEN 1 ELSE 0 END) AS exact_count,
                SUM(CASE WHEN fe.id IS NOT NULL AND ro.content_hash IS NOT NULL AND fe.product_id IS NOT NULL AND TRIM(fe.product_id) != '' AND rates.product_id IS NOT NULL AND TRIM(rates.product_id) != '' AND fe.product_id != rates.product_id THEN 1 ELSE 0 END) AS quarantined_count,
                SUM(CASE WHEN fe.id IS NOT NULL AND ro.content_hash IS NOT NULL AND NOT ((rates.cdr_product_detail_hash IS NOT NULL AND TRIM(rates.cdr_product_detail_hash) != '' AND rates.cdr_product_detail_hash = fe.content_hash) OR (rates.source_url IS NOT NULL AND TRIM(rates.source_url) != '' AND rates.source_url = fe.source_url)) AND NOT (fe.product_id IS NOT NULL AND TRIM(fe.product_id) != '' AND rates.product_id IS NOT NULL AND TRIM(rates.product_id) != '' AND fe.product_id != rates.product_id) THEN 1 ELSE 0 END) AS reconstructed_count
         FROM ${config.table} rates
         LEFT JOIN fetch_events fe ON fe.id = rates.fetch_event_id
         LEFT JOIN raw_objects ro ON ro.content_hash = fe.content_hash
         WHERE rates.collection_date = ?1
         GROUP BY rates.bank_name
       )
       SELECT bank_name, row_count, missing_required_rows, invalid_value_rows, exact_count, reconstructed_count, quarantined_count
       FROM classified
       ORDER BY bank_name ASC`,
    )
    .bind(collectionDate, config.rateMin, config.rateMax)
    .all<NumberRow & { bank_name: string }>()
  const findingWeights = new Map<string, number>()
  for (const finding of findings) {
    const bank = String(finding.bank_name || '').trim()
    if (!bank) continue
    const metrics = safeParseMetrics(finding.metrics_json)
    findingWeights.set(bank, (findingWeights.get(bank) ?? 0) + num(finding.severity_weight) * Math.max(1, num(metrics.affected_series_count)))
  }
  const ranked = (rowSet.results ?? []).map((row) => {
    const rowCount = Math.max(1, num(row.row_count))
    const structural = structuralScore({
      rowCount,
      duplicateRows: 0,
      missingRequiredRows: num(row.missing_required_rows),
      invalidValueRows: num(row.invalid_value_rows),
      crossTableConflictRows: 0,
    })
    const provenance = provenanceScore({
      exact: num(row.exact_count),
      reconstructed: num(row.reconstructed_count),
      legacy: 0,
      quarantined: num(row.quarantined_count),
      unclassified: 0,
    })
    const findingWeight = findingWeights.get(String(row.bank_name || '').trim()) ?? 0
    const degradationScore = Number(
      (((1 - provenance) * 2) + (1 - structural.score) + findingWeight / Math.max(rowCount, 5)).toFixed(4),
    )
    const reasons: string[] = []
    if (num(row.quarantined_count) > 0) reasons.push('quarantined provenance')
    if (num(row.missing_required_rows) > 0) reasons.push('missing required fields')
    if (num(row.invalid_value_rows) > 0) reasons.push('invalid values')
    if (findingWeight > 0) reasons.push('high anomaly pressure')
    return {
      bank_name: String(row.bank_name || '').trim(),
      degradation_score: degradationScore,
      row_count: rowCount,
      provenance_score: Number(provenance.toFixed(4)),
      structural_score: Number(structural.score.toFixed(4)),
      finding_weight: Number(findingWeight.toFixed(4)),
      reasons: reasons.slice(0, 3),
    }
  })
  return ranked
    .sort((a, b) => b.degradation_score - a.degradation_score || b.finding_weight - a.finding_weight || a.bank_name.localeCompare(b.bank_name))
    .slice(0, 5)
    .map((row, index) => ({ rank: index + 1, ...row }))
}

export async function computeHistoricalQualityDailySummary(
  db: D1Database,
  input: {
    collectionDate: string
    scope: Exclude<HistoricalQualityScope, 'overall'>
    previousDate: string | null
    findings: HistoricalQualityFindingRow[]
    lenderCode?: string | null
  },
): Promise<HistoricalQualityDailySummary> {
  const [counts, topDegradedLenders] = await Promise.all([
    loadSummaryCounts(db, input.collectionDate, input.scope, input.previousDate, input.lenderCode),
    loadTopDegradedLenders(db, input.collectionDate, input.scope, input.findings),
  ])
  return {
    version: 'v1',
    counts,
    top_degraded_lenders: topDegradedLenders,
  }
}

export function mergeHistoricalQualityDailySummaries(summaries: HistoricalQualityDailySummary[]): HistoricalQualityDailySummary {
  const counts = summaries.reduce<HistoricalQualityDailySummary['counts']>(
    (total, summary) => ({
      new_product_count: total.new_product_count + summary.counts.new_product_count,
      lost_product_count: total.lost_product_count + summary.counts.lost_product_count,
      cdr_missing_product_count: total.cdr_missing_product_count + summary.counts.cdr_missing_product_count,
      renamed_same_id_count: total.renamed_same_id_count + summary.counts.renamed_same_id_count,
      same_id_name_same_rate_other_detail_changed_count:
        total.same_id_name_same_rate_other_detail_changed_count + summary.counts.same_id_name_same_rate_other_detail_changed_count,
      changed_id_same_name_count: total.changed_id_same_name_count + summary.counts.changed_id_same_name_count,
      increased_rate_product_count: total.increased_rate_product_count + summary.counts.increased_rate_product_count,
      decreased_rate_product_count: total.decreased_rate_product_count + summary.counts.decreased_rate_product_count,
      increased_rate_series_count: total.increased_rate_series_count + summary.counts.increased_rate_series_count,
      decreased_rate_series_count: total.decreased_rate_series_count + summary.counts.decreased_rate_series_count,
    }),
    {
      new_product_count: 0,
      lost_product_count: 0,
      cdr_missing_product_count: 0,
      renamed_same_id_count: 0,
      same_id_name_same_rate_other_detail_changed_count: 0,
      changed_id_same_name_count: 0,
      increased_rate_product_count: 0,
      decreased_rate_product_count: 0,
      increased_rate_series_count: 0,
      decreased_rate_series_count: 0,
    },
  )
  const lenders = new Map<string, HistoricalQualityDegradedLender>()
  for (const lender of summaries.flatMap((summary) => summary.top_degraded_lenders)) {
    const existing = lenders.get(lender.bank_name)
    if (!existing) {
      lenders.set(lender.bank_name, { ...lender })
      continue
    }
    existing.degradation_score = Number((existing.degradation_score + lender.degradation_score).toFixed(4))
    existing.finding_weight = Number((existing.finding_weight + lender.finding_weight).toFixed(4))
    existing.row_count += lender.row_count
    existing.reasons = Array.from(new Set([...existing.reasons, ...lender.reasons])).slice(0, 3)
  }
  return {
    version: 'v1',
    counts,
    top_degraded_lenders: Array.from(lenders.values())
      .sort((a, b) => b.degradation_score - a.degradation_score || a.bank_name.localeCompare(b.bank_name))
      .slice(0, 5)
      .map((lender, index) => ({ ...lender, rank: index + 1 })),
  }
}
