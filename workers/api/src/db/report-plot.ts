import type { ChartWindow } from '../utils/chart-window'
import { getMelbourneNowParts } from '../utils/time'
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
import { withReportPlotRefreshLock } from './report-plot-refresh-lock'

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
type BandSourceRow = {
  bank_name: string
  series_key: string
  date: string
  interest_rate: number
}
type SectionConfig = {
  deltaTable: string
  historyTable: string
  refreshSql: string
}

// Write-optimisation skips unchanged-rate rows indefinitely; fill the entire practical query window.
const BAND_PRODUCT_GAP_FILL_MAX_DAYS = 365
export const REPORT_BANDS_SOURCE_VERSION = 5

function rateBoundsForReportSection(section: ReportPlotSection): { min: number; max: number } {
  switch (section) {
    case 'home_loans':
      return { min: HOME_MIN_PUBLIC_RATE, max: HOME_MAX_PUBLIC_RATE }
    case 'savings':
      return { min: SAVINGS_MIN_PUBLIC_RATE, max: SAVINGS_MAX_PUBLIC_RATE }
    case 'term_deposits':
      return { min: TD_MIN_PUBLIC_RATE, max: TD_MAX_PUBLIC_RATE }
    default:
      return { min: 0, max: 100 }
  }
}

function isValidBandPoint(
  lo: number,
  hi: number,
  mean: number,
  bounds: { min: number; max: number },
): boolean {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(mean)) return false
  if (lo > hi + 1e-9) return false
  if (lo < bounds.min - 1e-9 || hi > bounds.max + 1e-9) return false
  return true
}

/** ISO date only; used for window end and band point keys. */
const YMD_ISO = /^\d{4}-\d{2}-\d{2}$/

function addCalendarDaysUtcYmd(ymd: string, deltaDays: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + deltaDays * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * When newer calendar days fall inside the resolved query window but a bank has no new qualifying rows
 * (sparse ingest timing), replicate the last computed band forward so ribbons align with meta.end_date
 * and neighbouring banks rather than disappearing at the trailing edge.
 */
export function forwardFillReportBandSeriesToWindowEnd(
  seriesList: ReportBandSeries[],
  windowEndYmd: string | undefined,
): ReportBandSeries[] {
  if (!windowEndYmd?.trim()) return seriesList
  const end = windowEndYmd.trim().slice(0, 10)
  if (!YMD_ISO.test(end)) return seriesList
  return seriesList.map((s) => {
    const pts = s.points
    if (!pts.length) return s
    const last = pts[pts.length - 1]
    const lastD = String(last.date || '').slice(0, 10)
    if (!YMD_ISO.test(lastD) || lastD >= end) return s
    const out: ReportBandPoint[] = [...pts]
    let d = addCalendarDaysUtcYmd(lastD, 1)
    while (d <= end) {
      out.push({
        date: d,
        min_rate: last.min_rate,
        max_rate: last.max_rate,
        mean_rate: last.mean_rate,
      })
      d = addCalendarDaysUtcYmd(d, 1)
    }
    return { ...s, points: out }
  })
}

const TD_TERM_PREFERENCE = [12, 6, 24, 3, 18, 36, 9, 2, 1]

export const reportPlotTestState = {
  refreshCountBySection: new Map<ReportPlotSection, number>(),
}

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
    ...(mode === 'bands' ? { band_source_version: REPORT_BANDS_SOURCE_VERSION } : {}),
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
  where.push(`NOT EXISTS (
    SELECT 1
    FROM historical_loan_rates q
    WHERE q.series_key = d.series_key
      AND q.collection_date = d.collection_date
      AND q.quarantine_reason IS NOT NULL
      AND TRIM(q.quarantine_reason) != ''
  )`)
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
  where.push(`NOT EXISTS (
    SELECT 1
    FROM historical_savings_rates q
    WHERE q.series_key = d.series_key
      AND q.collection_date = d.collection_date
      AND q.quarantine_reason IS NOT NULL
      AND TRIM(q.quarantine_reason) != ''
  )`)
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
  where.push(`NOT EXISTS (
    SELECT 1
    FROM historical_term_deposit_rates q
    WHERE q.series_key = d.series_key
      AND q.collection_date = d.collection_date
      AND q.quarantine_reason IS NOT NULL
      AND TRIM(q.quarantine_reason) != ''
  )`)
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

async function tableHasColumn(db: D1Database, table: string, column: string): Promise<boolean> {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  return (result.results || []).some((row) => row.name === column)
}

export async function refreshReportDeltaTable(
  db: D1Database,
  section: ReportPlotSection,
): Promise<void> {
  const config = SECTION_CONFIG[section]
  reportPlotTestState.refreshCountBySection.set(
    section,
    (reportPlotTestState.refreshCountBySection.get(section) ?? 0) + 1,
  )
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
  await withReportPlotRefreshLock(db, {
    section,
    table: config.deltaTable,
    task: async () => {
      const latest = await db
        .prepare(`SELECT COUNT(*) AS n FROM ${config.deltaTable}`)
        .first<{ n: number }>()
      if (Number(latest?.n || 0) > 0) return
      await refreshReportDeltaTable(db, section)
    },
  })
}

async function resolveTdTermMonths(
  db: D1Database,
  filters: TdReportFilters,
  table = 'td_report_deltas',
): Promise<number | null> {
  const explicit = normalizeTermMonths(filters.termMonths)
  if (explicit != null) return explicit
  const where = buildTdWhere(filters, { termMonths: null })
  const result = await db
    .prepare(
      `SELECT DISTINCT d.term_months
       FROM ${table} d
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
  section: ReportPlotSection,
  windowEndYmd: string | undefined,
): Promise<ReportBandSeries[]> {
  const result = await db
    .prepare(
      `SELECT
         d.bank_name,
         COALESCE(NULLIF(TRIM(d.series_key), ''), d.bank_name || '|' || d.product_id) AS series_key,
         d.collection_date AS date,
         d.interest_rate
       FROM ${table} d
       ${where.clause}
       ORDER BY LOWER(d.bank_name) ASC, d.collection_date ASC, series_key ASC`,
    )
    .bind(...where.binds)
    .all<BandSourceRow>()

  const bounds = rateBoundsForReportSection(section)
  const byBankRows = new Map<string, BandSourceRow[]>()
  for (const row of result.results || []) {
    const bankName = String(row.bank_name || '').trim()
    if (!bankName) continue
    const value = Number(row.interest_rate)
    if (!Number.isFinite(value) || value <= 0 || value < bounds.min || value > bounds.max) continue
    const sourceRow = {
      bank_name: bankName,
      series_key: String(row.series_key || '').trim() || `${bankName}|unknown`,
      date: String(row.date || '').slice(0, 10),
      interest_rate: value,
    }
    if (!sourceRow.date) continue
    const rows = byBankRows.get(bankName) || []
    rows.push(sourceRow)
    byBankRows.set(bankName, rows)
  }

  // Fetch the earliest date each series was marked removed so carry-forward stops at removal.
  // A removed product's is_removed=1 rows are filtered from the main query, so without this
  // the 365-day fill would keep stale rates in the band long after a product was discontinued.
  const seriesRemovedAt = new Map<string, string>()
  try {
    const removedResult = await db
      .prepare(
        `SELECT
           COALESCE(NULLIF(TRIM(series_key), ''), bank_name || '|' || product_id) AS sk,
           MIN(collection_date) AS removed_at
         FROM ${table}
         WHERE COALESCE(is_removed, 0) = 1
         GROUP BY COALESCE(NULLIF(TRIM(series_key), ''), bank_name || '|' || product_id)`,
      )
      .all<{ sk: string; removed_at: string }>()
    for (const row of removedResult.results ?? []) {
      if (row.sk && row.removed_at) seriesRemovedAt.set(String(row.sk), String(row.removed_at).slice(0, 10))
    }
  } catch {
    // is_removed column absent on older schema versions — skip removal gating
  }

  const out: ReportBandSeries[] = []
  for (const [bankName, rows] of byBankRows.entries()) {
    const dates = Array.from(new Set(rows.map((row) => row.date))).sort((left, right) => left.localeCompare(right))
    const valuesBySeries = new Map<string, Map<string, number>>()
    for (const row of rows) {
      const byDate = valuesBySeries.get(row.series_key) || new Map<string, number>()
      byDate.set(row.date, row.interest_rate)
      valuesBySeries.set(row.series_key, byDate)
    }

    const lastKnown = new Map<string, { date: string; value: number }>()
    const points: ReportBandPoint[] = []
    for (const date of dates) {
      const values: number[] = []
      for (const [seriesKey, byDate] of valuesBySeries.entries()) {
        const exact = byDate.get(date)
        if (exact != null) {
          values.push(exact)
          lastKnown.set(seriesKey, { date, value: exact })
          continue
        }
        const previous = lastKnown.get(seriesKey)
        if (!previous) continue
        const removedAt = seriesRemovedAt.get(seriesKey)
        if (removedAt && date >= removedAt) continue
        const gapDays = Math.round(
          (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86400000,
        )
        if (gapDays > 0 && gapDays <= BAND_PRODUCT_GAP_FILL_MAX_DAYS) values.push(previous.value)
      }
      if (!values.length) continue
      const lo = Math.min(...values)
      const hi = Math.max(...values)
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      if (!isValidBandPoint(lo, hi, mean, bounds)) continue
      const point: ReportBandPoint = {
        date,
        min_rate: lo,
        max_rate: hi,
        mean_rate: mean,
      }
      points.push(point)
    }
    if (points.length) out.push({ bank_name: bankName, color_key: bankName.toLowerCase(), points })
  }
  return forwardFillReportBandSeriesToWindowEnd(out, windowEndYmd)
}

export async function queryReportPlotPayload(
  db: D1Database,
  section: ReportPlotSection,
  mode: ReportPlotMode,
  filters: ReportFilters,
): Promise<ReportPlotPayload> {
  const config = SECTION_CONFIG[section]

  if (mode === 'moves') {
    await ensureReportDeltaTableReady(db, section)
    const resolvedTermMonths =
      section === 'term_deposits'
        ? await resolveTdTermMonths(db, filters as TdReportFilters)
        : null
    const where = buildWhere(section, filters, { termMonths: resolvedTermMonths })
    const points = await queryMovesRows(db, config.deltaTable, where)
    const payload: ReportMovesPayload = {
      mode,
      meta: meta(section, mode, filters, resolvedTermMonths),
      points,
    }
    return payload
  }

  const historyFilters = (await tableHasColumn(db, config.historyTable, 'is_removed'))
    ? filters
    : { ...filters, includeRemoved: true }
  const resolvedTermMonths =
    section === 'term_deposits'
      ? await resolveTdTermMonths(db, historyFilters as TdReportFilters, config.historyTable)
      : null
  const where = buildWhere(section, historyFilters, { termMonths: resolvedTermMonths })
  // Default to Melbourne today so forward-fill always extends the ribbon to the current local date
  // even when no rows were written (write-optimisation skipped unchanged rates or ingest hasn't run yet).
  const windowEndYmd =
    typeof historyFilters.endDate === 'string' && historyFilters.endDate.trim()
      ? historyFilters.endDate.trim().slice(0, 10)
      : getMelbourneNowParts().date
  const series = await queryBandSeries(db, config.historyTable, where, section, windowEndYmd)
  const payload: ReportBandsPayload = {
    mode,
    meta: meta(section, mode, filters, resolvedTermMonths),
    series,
  }
  return payload
}
