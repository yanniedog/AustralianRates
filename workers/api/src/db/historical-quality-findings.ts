import type { DatasetKind } from '../../../../packages/shared/src'
import { datasetConfigForScope, stableFindingKey } from './historical-quality-common'
import { HISTORICAL_QUALITY_SEVERITY_WEIGHTS } from './historical-quality-metrics'
import type {
  HistoricalQualityDatasetScope,
  HistoricalQualityOriginClass,
  HistoricalQualitySeverity,
} from './historical-quality-types'

type Finding = {
  stableFindingKey: string
  datasetKind: DatasetKind | null
  criterionCode: string
  subjectKind: 'day' | 'product' | 'series' | 'product_family' | 'lender_dataset'
  severity: HistoricalQualitySeverity
  severityWeight: number
  originClass: HistoricalQualityOriginClass
  originConfidence: number
  bankName?: string | null
  lenderCode?: string | null
  productId?: string | null
  productName?: string | null
  seriesKey?: string | null
  summary: string
  explanation: string
  metrics: Record<string, unknown>
  evidence: Record<string, unknown>
  drilldownSql: Record<string, unknown>
}

export type HistoricalQualityFindingsResult = {
  findings: Finding[]
  explainedAppearances: number
  unexplainedAppearances: number
  explainedDisappearances: number
  unexplainedDisappearances: number
  weightedAffectedSeries: number
  weightedRateFlowFlags: number
}

type NumberRow = Record<string, string | number | null>

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function severityFromCount(count: number): HistoricalQualitySeverity {
  if (count >= 20) return 'severe'
  if (count >= 10) return 'high'
  if (count >= 5) return 'medium'
  return 'low'
}

function severityFromDeltaBps(deltaBps: number): HistoricalQualitySeverity {
  const magnitude = Math.abs(deltaBps)
  if (magnitude >= 75) return 'severe'
  if (magnitude >= 45) return 'high'
  if (magnitude >= 20) return 'medium'
  return 'low'
}

function lenderWhere(
  scope: HistoricalQualityDatasetScope,
  lenderCode?: string | null,
  alias = 'rates',
  lenderParamIndex = 2,
  collectionDateExpression = `${alias}.collection_date`,
): string {
  if (!lenderCode) return ''
  return ` AND EXISTS (
    SELECT 1
    FROM lender_dataset_runs ldr
    WHERE ldr.collection_date = ${collectionDateExpression}
      AND ldr.dataset_kind = '${scope}'
      AND ldr.bank_name = ${alias}.bank_name
      AND ldr.lender_code = ?${lenderParamIndex}
  )`
}

async function collectAppearanceFindings(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
  previousDate: string | null,
  nextDate: string | null,
  healthyFinalized: boolean,
  lenderCode?: string | null,
): Promise<{ findings: Finding[]; explained: number; unexplained: number }> {
  if (!previousDate) return { findings: [], explained: 0, unexplained: 0 }
  const config = datasetConfigForScope(scope)
  const binds = lenderCode ? [collectionDate, lenderCode] : [collectionDate]
  const rows = await db
    .prepare(
      `WITH current_rows AS (
         SELECT rates.bank_name, rates.product_id, rates.product_name, rates.series_key
         FROM ${config.table} rates
         WHERE rates.collection_date = ?1${lenderWhere(scope, lenderCode, 'rates', 2)}
       )
       SELECT current_rows.bank_name,
              COUNT(*) AS appearance_count,
              SUM(CASE WHEN next_rows.series_key IS NOT NULL THEN 1 ELSE 0 END) AS reappearing_count
       FROM current_rows
       LEFT JOIN ${config.table} prev_rows
         ON prev_rows.collection_date = '${previousDate}'
        AND prev_rows.series_key = current_rows.series_key
       LEFT JOIN ${config.table} next_rows
         ON next_rows.collection_date = '${nextDate ?? ''}'
        AND next_rows.series_key = current_rows.series_key
       WHERE prev_rows.series_key IS NULL
       GROUP BY current_rows.bank_name
       HAVING COUNT(*) > 0`,
    )
    .bind(...binds)
    .all<NumberRow & { bank_name: string }>()
  const findings = (rows.results ?? []).flatMap((row) => {
    const appearanceCount = num(row.appearance_count)
    const reappearingCount = num(row.reappearing_count)
    const severity = severityFromCount(appearanceCount)
    const base: Finding = {
      stableFindingKey: stableFindingKey([scope, collectionDate, 'appearance', row.bank_name]),
      datasetKind: scope,
      criterionCode: 'appearance_wave',
      subjectKind: 'lender_dataset',
      severity,
      severityWeight: HISTORICAL_QUALITY_SEVERITY_WEIGHTS[severity],
      originClass: healthyFinalized ? 'unknown' : 'internal',
      originConfidence: healthyFinalized ? 0.35 : 0.75,
      bankName: String(row.bank_name || ''),
      lenderCode: lenderCode ?? null,
      summary: `${row.bank_name}: ${appearanceCount} series appeared`,
      explanation: healthyFinalized
        ? 'Series appeared relative to the prior observed date during a healthy finalized run.'
        : 'Series appeared while raw run-state was incomplete or unavailable, so the wave is treated as likely pipeline-observability debt.',
      metrics: { affected_series_count: appearanceCount, reappearing_count: reappearingCount },
      evidence: { previous_date: previousDate, next_date: nextDate, healthy_finalized: healthyFinalized },
      drilldownSql: { table: config.table, collection_date: collectionDate, bank_name: row.bank_name, previous_date: previousDate },
    }
    const extra =
      reappearingCount > 0
        ? [{
            ...base,
            stableFindingKey: stableFindingKey([scope, collectionDate, 'reappearing', row.bank_name]),
            criterionCode: 'reappearing_series',
            summary: `${row.bank_name}: ${reappearingCount} series reappeared after a gap`,
            metrics: { affected_series_count: reappearingCount },
          } satisfies Finding]
        : []
    return [base, ...extra]
  })
  const appearanceTotal = (rows.results ?? []).reduce((sum, row) => sum + num(row.appearance_count), 0)
  return {
    findings,
    explained: healthyFinalized ? 0 : appearanceTotal,
    unexplained: healthyFinalized ? appearanceTotal : 0,
  }
}

async function collectDisappearanceFindings(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
  previousDate: string | null,
  nextDate: string | null,
  healthyFinalized: boolean,
  lenderCode?: string | null,
): Promise<{ findings: Finding[]; explained: number; unexplained: number }> {
  if (!previousDate) return { findings: [], explained: 0, unexplained: 0 }
  const config = datasetConfigForScope(scope)
  const binds = lenderCode ? [collectionDate, lenderCode] : [collectionDate]
  const rows = await db
    .prepare(
      `SELECT prev_rows.bank_name,
              COUNT(*) AS disappearance_count,
              SUM(CASE WHEN next_rows.series_key IS NOT NULL THEN 1 ELSE 0 END) AS returns_next_date
       FROM ${config.table} prev_rows
       LEFT JOIN ${config.table} current_rows
         ON current_rows.collection_date = ?1
        AND current_rows.series_key = prev_rows.series_key
       LEFT JOIN ${config.table} next_rows
         ON next_rows.collection_date = '${nextDate ?? ''}'
        AND next_rows.series_key = prev_rows.series_key
       WHERE prev_rows.collection_date = '${previousDate}'
         ${lenderWhere(scope, lenderCode, 'prev_rows', 2, '?1')}
         AND current_rows.series_key IS NULL
       GROUP BY prev_rows.bank_name
       HAVING COUNT(*) > 0`,
    )
    .bind(...binds)
    .all<NumberRow & { bank_name: string }>()
  const findings = (rows.results ?? []).map((row) => {
    const disappearanceCount = num(row.disappearance_count)
    const returnsNextDate = num(row.returns_next_date)
    const severity = severityFromCount(disappearanceCount)
    return {
      stableFindingKey: stableFindingKey([scope, collectionDate, 'disappearance', row.bank_name]),
      datasetKind: scope,
      criterionCode: returnsNextDate > 0 ? 'disappearance_gap' : 'disappearance_wave',
      subjectKind: 'lender_dataset',
      severity,
      severityWeight: HISTORICAL_QUALITY_SEVERITY_WEIGHTS[severity],
      originClass: healthyFinalized ? 'unknown' : 'internal',
      originConfidence: healthyFinalized ? 0.35 : 0.75,
      bankName: String(row.bank_name || ''),
      summary: `${row.bank_name}: ${disappearanceCount} series disappeared`,
      explanation: returnsNextDate > 0 ? 'Missing on this date and seen again on the next observed date.' : 'Present on the prior date but absent on this date.',
      metrics: { affected_series_count: disappearanceCount, returns_next_date: returnsNextDate },
      evidence: { previous_date: previousDate, next_date: nextDate, healthy_finalized: healthyFinalized },
      drilldownSql: { table: config.table, collection_date: collectionDate, previous_date: previousDate, bank_name: row.bank_name },
    } satisfies Finding
  })
  const disappearanceTotal = (rows.results ?? []).reduce((sum, row) => sum + num(row.disappearance_count), 0)
  return {
    findings,
    explained: healthyFinalized ? 0 : disappearanceTotal,
    unexplained: healthyFinalized ? disappearanceTotal : 0,
  }
}

async function collectRateFlowFindings(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
  lenderCode?: string | null,
): Promise<Finding[]> {
  const config = datasetConfigForScope(scope)
  const binds = lenderCode ? [collectionDate, lenderCode] : [collectionDate]
  const rows = await db
    .prepare(
      `WITH ordered AS (
         SELECT rates.series_key, rates.bank_name, rates.product_id, rates.product_name, rates.interest_rate,
                rates.collection_date,
                LAG(rates.interest_rate) OVER (PARTITION BY rates.series_key ORDER BY rates.collection_date) AS prev_rate,
                LAG(rates.collection_date) OVER (PARTITION BY rates.series_key ORDER BY rates.collection_date) AS prev_date
         FROM ${config.table} rates
         WHERE 1 = 1${lenderWhere(scope, lenderCode, 'rates', 2)}
       )
       SELECT series_key, bank_name, product_id, product_name, prev_date, prev_rate, interest_rate,
              ROUND((interest_rate - prev_rate) * 100.0, 4) AS delta_bps
       FROM ordered
       WHERE prev_date IS NOT NULL
         AND collection_date = ?1
         AND ABS(interest_rate - prev_rate) >= 0.20
       ORDER BY ABS(interest_rate - prev_rate) DESC
       LIMIT 100`,
    )
    .bind(...binds)
    .all<NumberRow & { series_key: string; bank_name: string; product_id: string; product_name: string; prev_date: string }>()
  return (rows.results ?? []).map((row) => {
    const deltaBps = num(row.delta_bps)
    const severity = severityFromDeltaBps(deltaBps)
    return {
      stableFindingKey: stableFindingKey([scope, collectionDate, 'abrupt_move', row.series_key]),
      datasetKind: scope,
      criterionCode: 'abrupt_rate_move',
      subjectKind: 'series',
      severity,
      severityWeight: HISTORICAL_QUALITY_SEVERITY_WEIGHTS[severity],
      originClass: 'unknown',
      originConfidence: 0.5,
      bankName: String(row.bank_name || ''),
      productId: String(row.product_id || ''),
      productName: String(row.product_name || ''),
      seriesKey: String(row.series_key || ''),
      summary: `${row.bank_name}: ${row.product_name} moved ${deltaBps.toFixed(2)} bps`,
      explanation: 'Large single-date movement relative to the prior observed value.',
      metrics: { affected_series_count: 1, delta_bps: deltaBps, previous_rate: num(row.prev_rate), current_rate: num(row.interest_rate) },
      evidence: { previous_date: row.prev_date, collection_date: collectionDate },
      drilldownSql: { table: config.table, series_key: row.series_key, collection_date: collectionDate },
    } satisfies Finding
  })
}

async function collectIdentityChurnFindings(
  db: D1Database,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
  lenderCode?: string | null,
): Promise<Finding[]> {
  const config = datasetConfigForScope(scope)
  const binds = lenderCode ? [collectionDate, lenderCode] : [collectionDate]
  const rows = await db
    .prepare(
      `WITH grouped AS (
         SELECT rates.bank_name, rates.product_name, ${config.dimensionsSql} AS dimension_key,
                COUNT(DISTINCT rates.product_id) AS distinct_product_ids,
                COUNT(DISTINCT ${config.seriesKeySql}) AS affected_series_count
         FROM ${config.table} rates
         GROUP BY rates.bank_name, rates.product_name, dimension_key
         HAVING COUNT(DISTINCT rates.product_id) > 1
       )
       SELECT current_rows.bank_name, current_rows.product_name, current_rows.product_id, current_rows.series_key,
              grouped.distinct_product_ids, grouped.affected_series_count
       FROM ${config.table} current_rows
       JOIN grouped
         ON grouped.bank_name = current_rows.bank_name
        AND grouped.product_name = current_rows.product_name
        AND grouped.dimension_key = ${config.dimensionsSql.replaceAll('rates.', 'current_rows.')}
       WHERE current_rows.collection_date = ?1
         ${lenderWhere(scope, lenderCode, 'current_rows', 2)}`,
    )
    .bind(...binds)
    .all<NumberRow & { bank_name: string; product_name: string; product_id: string; series_key: string }>()
  return (rows.results ?? []).map((row) => {
    const affectedSeriesCount = num(row.affected_series_count)
    const severity = severityFromCount(affectedSeriesCount)
    return {
      stableFindingKey: stableFindingKey([scope, collectionDate, 'product_id_churn', row.series_key]),
      datasetKind: scope,
      criterionCode: 'product_id_churn',
      subjectKind: 'product_family',
      severity,
      severityWeight: HISTORICAL_QUALITY_SEVERITY_WEIGHTS[severity],
      originClass: 'external',
      originConfidence: 0.85,
      bankName: String(row.bank_name || ''),
      productId: String(row.product_id || ''),
      productName: String(row.product_name || ''),
      seriesKey: String(row.series_key || ''),
      summary: `${row.bank_name}: ${row.product_name} shows product_id churn`,
      explanation: 'The same bank, product name, and dimensional fingerprint map to multiple product_ids across history, which is likely upstream identity churn rather than genuine product creation.',
      metrics: { affected_series_count: affectedSeriesCount, distinct_product_ids: num(row.distinct_product_ids) },
      evidence: { collection_date: collectionDate },
      drilldownSql: { table: config.table, bank_name: row.bank_name, product_name: row.product_name, collection_date: collectionDate },
    } satisfies Finding
  })
}

async function collectRbaFindings(db: D1Database, collectionDate: string, lenderCode?: string | null): Promise<Finding[]> {
  const binds = lenderCode ? [collectionDate, lenderCode] : [collectionDate]
  const rows = await db
    .prepare(
      `WITH rba_events AS (
         SELECT effective_date, cash_rate,
                LAG(cash_rate) OVER (ORDER BY effective_date) AS prev_cash_rate
         FROM (
           SELECT effective_date, MAX(cash_rate) AS cash_rate
           FROM rba_cash_rates
           GROUP BY effective_date
         )
       ),
       current_cycle AS (
         SELECT effective_date, cash_rate, prev_cash_rate
         FROM rba_events
         WHERE effective_date <= ?1
         ORDER BY effective_date DESC
         LIMIT 1
       ),
       ordered AS (
         SELECT rates.series_key, rates.bank_name, rates.product_id, rates.product_name, rates.rate_structure,
                rates.collection_date, rates.interest_rate,
                LAG(rates.interest_rate) OVER (PARTITION BY rates.series_key ORDER BY rates.collection_date) AS prev_rate
         FROM historical_loan_rates rates
         WHERE rates.rate_structure = 'variable'
       ),
       changed AS (
         SELECT ordered.*, current_cycle.effective_date AS cycle_effective_date,
                ROUND((ordered.interest_rate - ordered.prev_rate) * 100.0, 4) AS delta_bps,
                ROUND((current_cycle.cash_rate - current_cycle.prev_cash_rate) * 100.0, 4) AS rba_delta_bps,
                (
                  SELECT COUNT(*)
                  FROM ordered history
                  WHERE history.series_key = ordered.series_key
                    AND history.prev_rate IS NOT NULL
                    AND ABS(history.interest_rate - history.prev_rate) > 0.000001
                    AND history.collection_date >= current_cycle.effective_date
                    AND history.collection_date <= ordered.collection_date
                ) AS cycle_move_count
         FROM ordered
         JOIN current_cycle
         WHERE ordered.collection_date = ?1
           AND ordered.prev_rate IS NOT NULL
           AND ABS(ordered.interest_rate - ordered.prev_rate) > 0.000001
           AND current_cycle.prev_cash_rate IS NOT NULL
       )
       SELECT *
       FROM changed
       WHERE 1 = 1${lenderWhere('home_loans', lenderCode, 'changed', 2)}`,
    )
    .bind(...binds)
    .all<NumberRow & { series_key: string; bank_name: string; product_id: string; product_name: string; cycle_effective_date: string }>()
  const findings: Finding[] = []
  for (const row of rows.results ?? []) {
    const deltaBps = num(row.delta_bps)
    const rbaDeltaBps = num(row.rba_delta_bps)
    const cycleMoveCount = num(row.cycle_move_count)
    const base = {
      datasetKind: 'home_loans' as const,
      subjectKind: 'series' as const,
      bankName: String(row.bank_name || ''),
      productId: String(row.product_id || ''),
      productName: String(row.product_name || ''),
      seriesKey: String(row.series_key || ''),
      severity: severityFromDeltaBps(deltaBps),
      originClass: 'unknown' as const,
      originConfidence: 0.6,
      metrics: { affected_series_count: 1, delta_bps: deltaBps, rba_delta_bps: rbaDeltaBps, cycle_move_count: cycleMoveCount },
      evidence: { collection_date: collectionDate, cycle_effective_date: row.cycle_effective_date },
      drilldownSql: { table: 'historical_loan_rates', series_key: row.series_key, collection_date: collectionDate },
    }
    if (Math.sign(deltaBps) !== Math.sign(rbaDeltaBps)) {
      const severity = severityFromDeltaBps(deltaBps)
      findings.push({
        ...base,
        stableFindingKey: stableFindingKey(['home_loans', collectionDate, 'rba_opposite_direction', row.series_key]),
        criterionCode: 'rba_opposite_direction',
        severity,
        severityWeight: HISTORICAL_QUALITY_SEVERITY_WEIGHTS[severity],
        summary: `${row.bank_name}: variable-rate move opposed the RBA cycle`,
        explanation: 'The current variable-rate move is in the opposite direction to the active RBA cash-rate cycle.',
      } satisfies Finding)
    }
    if (Math.abs(deltaBps) > Math.abs(rbaDeltaBps) + 0.01) {
      const severity = severityFromDeltaBps(deltaBps)
      findings.push({
        ...base,
        stableFindingKey: stableFindingKey(['home_loans', collectionDate, 'rba_larger_than_cycle_move', row.series_key]),
        criterionCode: 'rba_larger_than_cycle_move',
        severity,
        severityWeight: HISTORICAL_QUALITY_SEVERITY_WEIGHTS[severity],
        summary: `${row.bank_name}: variable-rate move exceeded the RBA cycle move`,
        explanation: 'The product moved more than the active RBA cash-rate change.',
      } satisfies Finding)
    }
    if (Math.abs(deltaBps) + 0.01 < Math.abs(rbaDeltaBps)) {
      const severity = 'medium'
      findings.push({
        ...base,
        stableFindingKey: stableFindingKey(['home_loans', collectionDate, 'rba_smaller_than_cycle_move', row.series_key]),
        criterionCode: 'rba_smaller_than_cycle_move',
        severity,
        severityWeight: HISTORICAL_QUALITY_SEVERITY_WEIGHTS[severity],
        summary: `${row.bank_name}: variable-rate move lagged the RBA cycle move`,
        explanation: 'The product moved less than the active RBA cash-rate change.',
      } satisfies Finding)
    }
    if (cycleMoveCount > 1) {
      const severity = cycleMoveCount >= 3 ? 'high' : 'medium'
      findings.push({
        ...base,
        stableFindingKey: stableFindingKey(['home_loans', collectionDate, 'multi_move_same_rba_cycle', row.series_key]),
        criterionCode: 'multi_move_same_rba_cycle',
        severity,
        severityWeight: HISTORICAL_QUALITY_SEVERITY_WEIGHTS[severity],
        summary: `${row.bank_name}: variable-rate series moved multiple times in one RBA cycle`,
        explanation: 'The same variable-rate series changed more than once between the current cycle start and this date.',
      } satisfies Finding)
    }
  }
  return findings
}

export async function collectHistoricalQualityFindings(
  db: D1Database,
  input: {
    collectionDate: string
    scope: HistoricalQualityDatasetScope
    previousDate: string | null
    nextDate: string | null
    healthyFinalized: boolean
    lenderCode?: string | null
  },
): Promise<HistoricalQualityFindingsResult> {
  const [appearances, disappearances, rateFlow, identityChurn, rbaFindings] = await Promise.all([
    collectAppearanceFindings(db, input.collectionDate, input.scope, input.previousDate, input.nextDate, input.healthyFinalized, input.lenderCode),
    collectDisappearanceFindings(db, input.collectionDate, input.scope, input.previousDate, input.nextDate, input.healthyFinalized, input.lenderCode),
    collectRateFlowFindings(db, input.collectionDate, input.scope, input.lenderCode),
    collectIdentityChurnFindings(db, input.collectionDate, input.scope, input.lenderCode),
    input.scope === 'home_loans' ? collectRbaFindings(db, input.collectionDate, input.lenderCode) : Promise.resolve([]),
  ])
  const findings = [...appearances.findings, ...disappearances.findings, ...rateFlow, ...identityChurn, ...rbaFindings]
  const weightedAffectedSeries = findings.reduce(
    (sum, finding) => sum + finding.severityWeight * num(finding.metrics.affected_series_count),
    0,
  )
  const weightedRateFlowFlags = [...rateFlow, ...rbaFindings].reduce((sum, finding) => sum + finding.severityWeight, 0)
  return {
    findings,
    explainedAppearances: appearances.explained,
    unexplainedAppearances: appearances.unexplained,
    explainedDisappearances: disappearances.explained,
    unexplainedDisappearances: disappearances.unexplained,
    weightedAffectedSeries,
    weightedRateFlowFlags,
  }
}
