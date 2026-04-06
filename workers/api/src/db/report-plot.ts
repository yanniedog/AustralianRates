import type { ChartWindow } from '../utils/chart-window'
import { runSourceWhereClause, type SourceMode } from '../utils/source-mode'
import {
  addBalanceBandOverlapWhere,
  addBankWhere,
  addDatasetModeWhere,
  addRateBoundsWhere,
  addSingleColumnRateBoundsWhere,
  type DatasetMode,
} from './query-common'
import {
  applyHomeLoanCompareEdgeExclusions,
  applySavingsCompareEdgeExclusions,
  applyTdCompareEdgeExclusions,
} from './compare-edge-exclusions'
import {
  MAX_PUBLIC_RATE as HOME_MAX_PUBLIC_RATE,
  MIN_CONFIDENCE_ALL as HOME_MIN_CONFIDENCE_ALL,
  MIN_CONFIDENCE_DAILY as HOME_MIN_CONFIDENCE_DAILY,
  MIN_CONFIDENCE_HISTORICAL as HOME_MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE as HOME_MIN_PUBLIC_RATE,
} from './home-loans/shared'
import {
  MAX_PUBLIC_RATE as SAVINGS_MAX_PUBLIC_RATE,
  MIN_CONFIDENCE as SAVINGS_MIN_CONFIDENCE,
  MIN_CONFIDENCE_HISTORICAL as SAVINGS_MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE as SAVINGS_MIN_PUBLIC_RATE,
} from './savings/shared'
import {
  MAX_PUBLIC_RATE as TD_MAX_PUBLIC_RATE,
  MIN_CONFIDENCE as TD_MIN_CONFIDENCE,
  MIN_CONFIDENCE_HISTORICAL as TD_MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE as TD_MIN_PUBLIC_RATE,
} from './term-deposits/shared'
import type {
  HomeLoanAnalyticsInput,
  SavingsAnalyticsInput,
  TdAnalyticsInput,
} from './analytics/change-reads'
import type {
  ReportBandPoint,
  ReportBandSeries,
  ReportBandsPayload,
  ReportMovesPayload,
  ReportPlotMode,
  ReportPlotPayload,
  ReportPlotSection,
} from './report-plot-types'

type ReportFiltersBase = {
  startDate?: string
  endDate?: string
  chartWindow?: ChartWindow | null
}

type HomeLoanReportFilters = HomeLoanAnalyticsInput & ReportFiltersBase
type SavingsReportFilters = SavingsAnalyticsInput & ReportFiltersBase
type TdReportFilters = TdAnalyticsInput & ReportFiltersBase
type ReportFilters = HomeLoanReportFilters | SavingsReportFilters | TdReportFilters

type WhereClause = { clause: string; binds: Array<string | number> }
type SectionConfig = {
  deltaTable: string
  historyTable: string
  refreshSql: string
}

const TD_TERM_PREFERENCE = [12, 6, 24, 3, 18, 36, 9, 2, 1]
const pendingReportDeltaRefreshes = new Map<ReportPlotSection, Promise<void>>()

const SECTION_CONFIG: Record<ReportPlotSection, SectionConfig> = {
  home_loans: {
    deltaTable: 'home_loan_report_deltas',
    historyTable: 'historical_loan_rates',
    refreshSql: `
      INSERT OR REPLACE INTO home_loan_report_deltas (
        series_key, product_key, bank_name, product_name, collection_date, previous_collection_date,
        interest_rate, previous_interest_rate, delta_bps, delta_sign,
        security_purpose, repayment_type, rate_structure, lvr_tier, feature_set, has_offset_account,
        comparison_rate, annual_fee, data_quality_flag, confidence_score, retrieval_type, run_source, is_removed
      )
      WITH ranked AS (
        SELECT
          COALESCE(NULLIF(TRIM(h.series_key), ''), h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure) AS series_key,
          h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
          h.bank_name,
          h.product_name,
          h.collection_date,
          h.interest_rate,
          h.security_purpose,
          h.repayment_type,
          h.rate_structure,
          h.lvr_tier,
          h.feature_set,
          h.has_offset_account,
          h.comparison_rate,
          h.annual_fee,
          h.data_quality_flag,
          h.confidence_score,
          h.retrieval_type,
          COALESCE(h.run_source, 'scheduled') AS run_source,
          COALESCE(pps.is_removed, 0) AS is_removed,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(TRIM(h.series_key), ''), h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure), h.collection_date
            ORDER BY CASE WHEN COALESCE(h.run_source, 'scheduled') = 'scheduled' THEN 0 ELSE 1 END, h.parsed_at DESC
          ) AS row_num
        FROM historical_loan_rates h
        LEFT JOIN product_presence_status pps
          ON pps.section = 'home_loans'
          AND pps.bank_name = h.bank_name
          AND pps.product_id = h.product_id
      ),
      deduped AS (
        SELECT * FROM ranked WHERE row_num = 1
      ),
      ordered AS (
        SELECT
          series_key, product_key, bank_name, product_name, collection_date,
          LAG(collection_date) OVER (PARTITION BY series_key ORDER BY collection_date ASC) AS previous_collection_date,
          interest_rate,
          LAG(interest_rate) OVER (PARTITION BY series_key ORDER BY collection_date ASC) AS previous_interest_rate,
          security_purpose, repayment_type, rate_structure, lvr_tier, feature_set, has_offset_account,
          comparison_rate, annual_fee, data_quality_flag, confidence_score, retrieval_type, run_source, is_removed
        FROM deduped
      )
      SELECT
        series_key, product_key, bank_name, product_name, collection_date, previous_collection_date,
        interest_rate, previous_interest_rate,
        CAST(ROUND((interest_rate - previous_interest_rate) * 100.0, 0) AS INTEGER) AS delta_bps,
        CASE WHEN interest_rate > previous_interest_rate THEN 1 WHEN interest_rate < previous_interest_rate THEN -1 ELSE 0 END AS delta_sign,
        security_purpose, repayment_type, rate_structure, lvr_tier, feature_set, has_offset_account,
        comparison_rate, annual_fee, data_quality_flag, confidence_score, retrieval_type, run_source, is_removed
      FROM ordered
      WHERE previous_collection_date IS NOT NULL
    `,
  },
  savings: {
    deltaTable: 'savings_report_deltas',
    historyTable: 'historical_savings_rates',
    refreshSql: `
      INSERT OR REPLACE INTO savings_report_deltas (
        series_key, product_key, bank_name, product_name, collection_date, previous_collection_date,
        interest_rate, previous_interest_rate, delta_bps, delta_sign,
        account_type, rate_type, deposit_tier, min_balance, max_balance, monthly_fee,
        data_quality_flag, confidence_score, retrieval_type, run_source, is_removed
      )
      WITH ranked AS (
        SELECT
          COALESCE(NULLIF(TRIM(h.series_key), ''), h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier) AS series_key,
          h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key,
          h.bank_name,
          h.product_name,
          h.collection_date,
          h.interest_rate,
          h.account_type,
          h.rate_type,
          h.deposit_tier,
          h.min_balance,
          h.max_balance,
          h.monthly_fee,
          h.data_quality_flag,
          h.confidence_score,
          h.retrieval_type,
          COALESCE(h.run_source, 'scheduled') AS run_source,
          COALESCE(pps.is_removed, 0) AS is_removed,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(TRIM(h.series_key), ''), h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier), h.collection_date
            ORDER BY CASE WHEN COALESCE(h.run_source, 'scheduled') = 'scheduled' THEN 0 ELSE 1 END, h.parsed_at DESC
          ) AS row_num
        FROM historical_savings_rates h
        LEFT JOIN product_presence_status pps
          ON pps.section = 'savings'
          AND pps.bank_name = h.bank_name
          AND pps.product_id = h.product_id
      ),
      deduped AS (
        SELECT * FROM ranked WHERE row_num = 1
      ),
      ordered AS (
        SELECT
          series_key, product_key, bank_name, product_name, collection_date,
          LAG(collection_date) OVER (PARTITION BY series_key ORDER BY collection_date ASC) AS previous_collection_date,
          interest_rate,
          LAG(interest_rate) OVER (PARTITION BY series_key ORDER BY collection_date ASC) AS previous_interest_rate,
          account_type, rate_type, deposit_tier, min_balance, max_balance, monthly_fee,
          data_quality_flag, confidence_score, retrieval_type, run_source, is_removed
        FROM deduped
      )
      SELECT
        series_key, product_key, bank_name, product_name, collection_date, previous_collection_date,
        interest_rate, previous_interest_rate,
        CAST(ROUND((interest_rate - previous_interest_rate) * 100.0, 0) AS INTEGER) AS delta_bps,
        CASE WHEN interest_rate > previous_interest_rate THEN 1 WHEN interest_rate < previous_interest_rate THEN -1 ELSE 0 END AS delta_sign,
        account_type, rate_type, deposit_tier, min_balance, max_balance, monthly_fee,
        data_quality_flag, confidence_score, retrieval_type, run_source, is_removed
      FROM ordered
      WHERE previous_collection_date IS NOT NULL
    `,
  },
  term_deposits: {
    deltaTable: 'td_report_deltas',
    historyTable: 'historical_term_deposit_rates',
    refreshSql: `
      INSERT OR REPLACE INTO td_report_deltas (
        series_key, product_key, bank_name, product_name, collection_date, previous_collection_date,
        interest_rate, previous_interest_rate, delta_bps, delta_sign,
        term_months, deposit_tier, min_deposit, max_deposit, interest_payment,
        data_quality_flag, confidence_score, retrieval_type, run_source, is_removed
      )
      WITH ranked AS (
        SELECT
          COALESCE(NULLIF(TRIM(h.series_key), ''), h.bank_name || '|' || h.product_id || '|' || CAST(h.term_months AS TEXT) || '|' || h.deposit_tier || '|' || h.interest_payment) AS series_key,
          h.bank_name || '|' || h.product_id || '|' || CAST(h.term_months AS TEXT) || '|' || h.deposit_tier || '|' || h.interest_payment AS product_key,
          h.bank_name,
          h.product_name,
          h.collection_date,
          h.interest_rate,
          h.term_months,
          h.deposit_tier,
          h.min_deposit,
          h.max_deposit,
          h.interest_payment,
          h.data_quality_flag,
          h.confidence_score,
          h.retrieval_type,
          COALESCE(h.run_source, 'scheduled') AS run_source,
          COALESCE(pps.is_removed, 0) AS is_removed,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(TRIM(h.series_key), ''), h.bank_name || '|' || h.product_id || '|' || CAST(h.term_months AS TEXT) || '|' || h.deposit_tier || '|' || h.interest_payment), h.collection_date
            ORDER BY CASE WHEN COALESCE(h.run_source, 'scheduled') = 'scheduled' THEN 0 ELSE 1 END, h.parsed_at DESC
          ) AS row_num
        FROM historical_term_deposit_rates h
        LEFT JOIN product_presence_status pps
          ON pps.section = 'term_deposits'
          AND pps.bank_name = h.bank_name
          AND pps.product_id = h.product_id
      ),
      deduped AS (
        SELECT * FROM ranked WHERE row_num = 1
      ),
      ordered AS (
        SELECT
          series_key, product_key, bank_name, product_name, collection_date,
          LAG(collection_date) OVER (PARTITION BY series_key ORDER BY collection_date ASC) AS previous_collection_date,
          interest_rate,
          LAG(interest_rate) OVER (PARTITION BY series_key ORDER BY collection_date ASC) AS previous_interest_rate,
          term_months, deposit_tier, min_deposit, max_deposit, interest_payment,
          data_quality_flag, confidence_score, retrieval_type, run_source, is_removed
        FROM deduped
      )
      SELECT
        series_key, product_key, bank_name, product_name, collection_date, previous_collection_date,
        interest_rate, previous_interest_rate,
        CAST(ROUND((interest_rate - previous_interest_rate) * 100.0, 0) AS INTEGER) AS delta_bps,
        CASE WHEN interest_rate > previous_interest_rate THEN 1 WHEN interest_rate < previous_interest_rate THEN -1 ELSE 0 END AS delta_sign,
        term_months, deposit_tier, min_deposit, max_deposit, interest_payment,
        data_quality_flag, confidence_score, retrieval_type, run_source, is_removed
      FROM ordered
      WHERE previous_collection_date IS NOT NULL
    `,
  },
}

function meta(
  section: ReportPlotSection,
  mode: ReportPlotMode,
  filters: ReportFilters,
  resolvedTermMonths: number | null,
) {
  return {
    section,
    mode,
    start_date: String(filters.startDate || ''),
    end_date: String(filters.endDate || ''),
    chart_window: filters.chartWindow ? String(filters.chartWindow) : null,
    resolved_term_months: resolvedTermMonths,
  }
}

function normalizeTermMonths(termMonths: string | undefined): number | null {
  if (!termMonths || String(termMonths).trim() === '') return null
  const parsed = Number(termMonths)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

function buildHomeLoanWhere(filters: HomeLoanReportFilters): WhereClause {
  const where: string[] = []
  const binds: Array<string | number> = []
  where.push('d.interest_rate BETWEEN ? AND ?')
  binds.push(HOME_MIN_PUBLIC_RATE, HOME_MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'd.interest_rate', 'd.comparison_rate', filters)
  where.push(runSourceWhereClause('d.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("d.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('d.confidence_score >= ?')
    binds.push(HOME_MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("d.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('d.confidence_score >= ?')
    binds.push(HOME_MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('d.confidence_score >= ?')
    binds.push(HOME_MIN_CONFIDENCE_ALL)
  }
  addBankWhere(where, binds, 'd.bank_name', filters.bank, filters.banks)
  if (filters.securityPurpose) { where.push('d.security_purpose = ?'); binds.push(filters.securityPurpose) }
  if (filters.repaymentType) { where.push('d.repayment_type = ?'); binds.push(filters.repaymentType) }
  if (filters.rateStructure) { where.push('d.rate_structure = ?'); binds.push(filters.rateStructure) }
  if (filters.lvrTier) { where.push('d.lvr_tier = ?'); binds.push(filters.lvrTier) }
  if (filters.featureSet) { where.push('d.feature_set = ?'); binds.push(filters.featureSet) }
  if (filters.startDate) { where.push('d.collection_date >= ?'); binds.push(filters.startDate) }
  if (filters.endDate) { where.push('d.collection_date <= ?'); binds.push(filters.endDate) }
  if (!filters.includeRemoved) where.push('COALESCE(d.is_removed, 0) = 0')
  applyHomeLoanCompareEdgeExclusions(where, 'd.product_name', filters.excludeCompareEdgeCases)
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', binds }
}

function buildSavingsWhere(filters: SavingsReportFilters): WhereClause {
  const where: string[] = []
  const binds: Array<string | number> = []
  where.push('d.interest_rate BETWEEN ? AND ?')
  binds.push(SAVINGS_MIN_PUBLIC_RATE, SAVINGS_MAX_PUBLIC_RATE)
  addSingleColumnRateBoundsWhere(where, binds, 'd.interest_rate', filters.minRate, filters.maxRate)
  addDatasetModeWhere(
    where,
    binds,
    'd.retrieval_type',
    'd.confidence_score',
    filters.mode,
    SAVINGS_MIN_CONFIDENCE,
    SAVINGS_MIN_CONFIDENCE_HISTORICAL,
  )
  where.push(runSourceWhereClause('d.run_source', filters.sourceMode ?? 'all'))
  addBankWhere(where, binds, 'd.bank_name', filters.bank, filters.banks)
  if (filters.accountType) { where.push('d.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('d.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('d.deposit_tier = ?'); binds.push(filters.depositTier) }
  addBalanceBandOverlapWhere(where, binds, 'd.min_balance', 'd.max_balance', filters.balanceMin, filters.balanceMax)
  if (filters.startDate) { where.push('d.collection_date >= ?'); binds.push(filters.startDate) }
  if (filters.endDate) { where.push('d.collection_date <= ?'); binds.push(filters.endDate) }
  if (!filters.includeRemoved) where.push('COALESCE(d.is_removed, 0) = 0')
  applySavingsCompareEdgeExclusions(where, 'd.product_name', filters.excludeCompareEdgeCases)
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', binds }
}

function buildTdWhere(
  filters: TdReportFilters,
  overrides: { termMonths?: number | null } = {},
): WhereClause {
  const where: string[] = []
  const binds: Array<string | number> = []
  where.push('d.interest_rate BETWEEN ? AND ?')
  binds.push(TD_MIN_PUBLIC_RATE, TD_MAX_PUBLIC_RATE)
  addSingleColumnRateBoundsWhere(where, binds, 'd.interest_rate', filters.minRate, filters.maxRate)
  addDatasetModeWhere(
    where,
    binds,
    'd.retrieval_type',
    'd.confidence_score',
    filters.mode,
    TD_MIN_CONFIDENCE,
    TD_MIN_CONFIDENCE_HISTORICAL,
  )
  where.push(runSourceWhereClause('d.run_source', filters.sourceMode ?? 'all'))
  addBankWhere(where, binds, 'd.bank_name', filters.bank, filters.banks)
  const termMonths = overrides.termMonths !== undefined ? overrides.termMonths : normalizeTermMonths(filters.termMonths)
  if (termMonths != null) { where.push('d.term_months = ?'); binds.push(termMonths) }
  if (filters.depositTier) { where.push('d.deposit_tier = ?'); binds.push(filters.depositTier) }
  addBalanceBandOverlapWhere(where, binds, 'd.min_deposit', 'd.max_deposit', filters.balanceMin, filters.balanceMax)
  if (filters.interestPayment) { where.push('d.interest_payment = ?'); binds.push(filters.interestPayment) }
  if (filters.startDate) { where.push('d.collection_date >= ?'); binds.push(filters.startDate) }
  if (filters.endDate) { where.push('d.collection_date <= ?'); binds.push(filters.endDate) }
  if (!filters.includeRemoved) where.push('COALESCE(d.is_removed, 0) = 0')
  applyTdCompareEdgeExclusions(where, 'd.product_name', 'd.min_deposit', filters.excludeCompareEdgeCases)
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', binds }
}

function buildWhere(section: ReportPlotSection, filters: ReportFilters, overrides: { termMonths?: number | null } = {}): WhereClause {
  if (section === 'home_loans') return buildHomeLoanWhere(filters as HomeLoanReportFilters)
  if (section === 'savings') return buildSavingsWhere(filters as SavingsReportFilters)
  return buildTdWhere(filters as TdReportFilters, overrides)
}

async function historyTableHasRows(db: D1Database, table: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS ok FROM ${table} LIMIT 1`).first<{ ok: number }>()
  return Number(row?.ok || 0) === 1
}

export async function refreshReportDeltaTable(
  db: D1Database,
  section: ReportPlotSection,
): Promise<void> {
  const config = SECTION_CONFIG[section]
  await db.prepare(`DELETE FROM ${config.deltaTable}`).run()
  await db.prepare(config.refreshSql).run()
}

export async function refreshAllReportDeltaTables(db: D1Database): Promise<void> {
  await refreshReportDeltaTable(db, 'home_loans')
  await refreshReportDeltaTable(db, 'savings')
  await refreshReportDeltaTable(db, 'term_deposits')
}

export async function ensureReportDeltaTableReady(
  db: D1Database,
  section: ReportPlotSection,
): Promise<void> {
  const config = SECTION_CONFIG[section]
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${config.deltaTable}`)
    .first<{ n: number }>()
  if (Number(row?.n || 0) > 0) return
  if (!(await historyTableHasRows(db, config.historyTable))) return
  const pending = pendingReportDeltaRefreshes.get(section)
  if (pending) {
    await pending
    return
  }
  const refreshPromise = refreshReportDeltaTable(db, section)
    .finally(() => {
      pendingReportDeltaRefreshes.delete(section)
    })
  pendingReportDeltaRefreshes.set(section, refreshPromise)
  await refreshPromise
}

async function resolveTdTermMonths(
  db: D1Database,
  filters: TdReportFilters,
): Promise<number | null> {
  const explicit = normalizeTermMonths(filters.termMonths)
  if (explicit != null) return explicit
  const where = buildTdWhere(filters, { termMonths: null })
  const result = await db
    .prepare(
      `SELECT DISTINCT d.term_months
       FROM td_report_deltas d
       ${where.clause}
       ORDER BY d.term_months ASC`,
    )
    .bind(...where.binds)
    .all<{ term_months: number }>()
  const terms = (result.results || [])
    .map((row) => Number(row.term_months))
    .filter((value) => Number.isFinite(value))
  for (const preferred of TD_TERM_PREFERENCE) {
    if (terms.includes(preferred)) return preferred
  }
  return null
}

async function queryMovesRows(
  db: D1Database,
  table: string,
  where: WhereClause,
): Promise<ReportMovesPayload['points']> {
  const result = await db
    .prepare(
      `SELECT
         d.collection_date AS date,
         SUM(CASE WHEN d.delta_bps > 0 THEN 1 ELSE 0 END) AS up_count,
         SUM(CASE WHEN d.delta_bps = 0 THEN 1 ELSE 0 END) AS flat_count,
         SUM(CASE WHEN d.delta_bps < 0 THEN 1 ELSE 0 END) AS down_count
       FROM ${table} d
       ${where.clause}
       GROUP BY d.collection_date
       ORDER BY d.collection_date ASC`,
    )
    .bind(...where.binds)
    .all<{ date: string; up_count: number; flat_count: number; down_count: number }>()
  return (result.results || []).map((row) => ({
    date: String(row.date || ''),
    up_count: Number(row.up_count || 0),
    flat_count: Number(row.flat_count || 0),
    down_count: Number(row.down_count || 0),
  }))
}

async function queryBandSeries(
  db: D1Database,
  table: string,
  where: WhereClause,
): Promise<ReportBandSeries[]> {
  const result = await db
    .prepare(
      `SELECT
         d.bank_name,
         d.collection_date AS date,
         MIN(d.delta_bps) AS min_delta_bps,
         MAX(d.delta_bps) AS max_delta_bps,
         CAST(ROUND((MIN(d.delta_bps) + MAX(d.delta_bps)) / 2.0, 0) AS INTEGER) AS mid_delta_bps
       FROM ${table} d
       ${where.clause}
       GROUP BY d.bank_name, d.collection_date
       ORDER BY LOWER(d.bank_name) ASC, d.collection_date ASC`,
    )
    .bind(...where.binds)
    .all<{
      bank_name: string
      date: string
      min_delta_bps: number
      max_delta_bps: number
      mid_delta_bps: number
    }>()

  const byBank = new Map<string, ReportBandSeries>()
  for (const row of result.results || []) {
    const bankName = String(row.bank_name || '').trim()
    if (!bankName) continue
    const point: ReportBandPoint = {
      date: String(row.date || ''),
      min_delta_bps: Number(row.min_delta_bps || 0),
      max_delta_bps: Number(row.max_delta_bps || 0),
      mid_delta_bps: Number(row.mid_delta_bps || 0),
    }
    if (!byBank.has(bankName)) {
      byBank.set(bankName, {
        bank_name: bankName,
        color_key: bankName.toLowerCase(),
        points: [],
      })
    }
    byBank.get(bankName)?.points.push(point)
  }
  return Array.from(byBank.values())
}

export async function queryReportPlotPayload(
  db: D1Database,
  section: ReportPlotSection,
  mode: ReportPlotMode,
  filters: ReportFilters,
): Promise<ReportPlotPayload> {
  await ensureReportDeltaTableReady(db, section)
  const config = SECTION_CONFIG[section]
  const resolvedTermMonths =
    section === 'term_deposits'
      ? await resolveTdTermMonths(db, filters as TdReportFilters)
      : null
  const where = buildWhere(section, filters, { termMonths: resolvedTermMonths })

  if (mode === 'moves') {
    const points = await queryMovesRows(db, config.deltaTable, where)
    const payload: ReportMovesPayload = {
      mode,
      meta: meta(section, mode, filters, resolvedTermMonths),
      points,
    }
    return payload
  }

  const series = await queryBandSeries(db, config.deltaTable, where)
  const payload: ReportBandsPayload = {
    mode,
    meta: meta(section, mode, filters, resolvedTermMonths),
    series,
  }
  return payload
}
