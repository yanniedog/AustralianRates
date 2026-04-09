import type { DatasetKind } from '../../../../packages/shared/src/index.js'
import { queryHomeLoanAnalyticsRows, querySavingsAnalyticsRows, queryTdAnalyticsRows, type HomeLoanAnalyticsInput, type SavingsAnalyticsInput, type TdAnalyticsInput } from '../db/analytics/change-reads'
import { analyticsProjectionReady } from '../db/analytics/readiness'
import { queryRatesPaginated, queryTimeseries } from '../db/queries'
import { querySavingsRatesPaginated, querySavingsTimeseries } from '../db/savings-queries'
import { queryTdRatesPaginated, queryTdTimeseries } from '../db/td-queries'
import type { AnalyticsRepresentation } from './analytics-route-utils'
import {
  CHART_SERIES_RESPONSE_CAP,
  collectPaginatedRatesCapped,
  resolveChartSeriesFetchCap,
  type ChartSeriesFetchContext,
} from '../utils/chart-series-caps'
import { collapseChartSeriesRows } from '../utils/chart-series-collapse'
import { projectChartRows } from '../utils/chart-row-projection'

type DbPair = {
  canonicalDb: D1Database
  analyticsDb: D1Database
}

export type ResolvedAnalyticsRows = {
  requestedRepresentation: AnalyticsRepresentation
  representation: AnalyticsRepresentation
  fallbackReason: 'projection_unavailable' | 'projection_query_failed' | null
  rows: Array<Record<string, unknown>>
}

/**
 * Load up to maxRows from projection tables when rows are ordered newest-first (rowSort: desc).
 * Reverses to ascending collection_date for charts.
 */
async function collectByOffset<T>(
  fetchChunk: (limit: number, offset: number) => Promise<T[]>,
  pageSize: number,
  maxRows: number,
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  while (rows.length < maxRows) {
    const need = maxRows - rows.length
    const lim = Math.min(pageSize, need)
    const chunk = await fetchChunk(lim, offset)
    if (chunk.length === 0) break
    rows.push(...chunk)
    if (chunk.length < lim) break
    offset += chunk.length
  }
  return rows.reverse()
}

function normalizeSignatureValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return String(value)
}

function dedupeAnalyticsRows(
  rows: Array<Record<string, unknown>>,
  fields: string[],
): Array<Record<string, unknown>> {
  const seen = new Set<string>()
  const deduped: Array<Record<string, unknown>> = []
  for (const row of rows) {
    const signature = fields.map((field) => normalizeSignatureValue(row[field])).join('||')
    if (seen.has(signature)) continue
    seen.add(signature)
    deduped.push(row)
  }
  return deduped
}

/** Keep the most recent rows when over the chart cap (data is sorted ascending by date). */
function capRows(
  rows: Array<Record<string, unknown>>,
  disableRowCap?: boolean,
): Array<Record<string, unknown>> {
  if (disableRowCap) return rows
  return rows.length <= CHART_SERIES_RESPONSE_CAP ? rows : rows.slice(-CHART_SERIES_RESPONSE_CAP)
}

async function resolveRepresentationRows(
  dataset: DatasetKind,
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: ChartSeriesFetchContext,
  fetchChangeRows: () => Promise<Array<Record<string, unknown>>>,
  fetchDayRows: () => Promise<Array<Record<string, unknown>>>,
): Promise<ResolvedAnalyticsRows> {
  if (representation !== 'change') {
    const rows = await fetchDayRows()
    const projectedRows = projectChartRows(dataset, 'day', rows)
    const collapsed = collapseChartSeriesRows('day', projectedRows)
    return {
      requestedRepresentation: representation,
      representation: 'day',
      fallbackReason: null,
      rows: capRows(collapsed, filters.disableRowCap),
    }
  }

  const ready = await analyticsProjectionReady(dbs.analyticsDb, dataset)
  if (!ready) {
    const rows = await fetchDayRows()
    const projectedRows = projectChartRows(dataset, 'day', rows)
    const collapsed = collapseChartSeriesRows('day', projectedRows)
    return {
      requestedRepresentation: representation,
      representation: 'day',
      fallbackReason: 'projection_unavailable',
      rows: capRows(collapsed, filters.disableRowCap),
    }
  }

  try {
    const rows = await fetchChangeRows()
    const projectedRows = projectChartRows(dataset, 'change', rows)
    const collapsed = collapseChartSeriesRows('change', projectedRows)
    return {
      requestedRepresentation: representation,
      representation: 'change',
      fallbackReason: null,
      rows: capRows(collapsed, filters.disableRowCap),
    }
  } catch {
    const rows = await fetchDayRows()
    const projectedRows = projectChartRows(dataset, 'day', rows)
    const collapsed = collapseChartSeriesRows('day', projectedRows)
    return {
      requestedRepresentation: representation,
      representation: 'day',
      fallbackReason: 'projection_query_failed',
      rows: capRows(collapsed, filters.disableRowCap),
    }
  }
}

async function collectHomeLoanCanonicalRows(
  dbs: DbPair,
  filters: HomeLoanAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  const maxRaw = resolveChartSeriesFetchCap(filters)
  return collectPaginatedRatesCapped(
    async (page, size) => {
      const result = await queryRatesPaginated(dbs.canonicalDb, {
        page,
        size,
        sort: 'collection_date',
        dir: 'desc',
        startDate: filters.startDate,
        endDate: filters.endDate,
        bank: filters.bank,
        banks: filters.banks,
        securityPurpose: filters.securityPurpose,
        repaymentType: filters.repaymentType,
        rateStructure: filters.rateStructure,
        lvrTier: filters.lvrTier,
        featureSet: filters.featureSet,
        minRate: filters.minRate,
        maxRate: filters.maxRate,
        minComparisonRate: filters.minComparisonRate,
        maxComparisonRate: filters.maxComparisonRate,
        includeRemoved: filters.includeRemoved,
        excludeCompareEdgeCases: filters.excludeCompareEdgeCases,
        mode: filters.mode,
        sourceMode: filters.sourceMode,
      })
      return { rows: result.data as Array<Record<string, unknown>>, lastPage: result.last_page }
    },
    { pageSize: 1000, maxRows: maxRaw },
  )
    .then((rows) => rows.slice().reverse())
    .then((rows) => dedupeAnalyticsRows(rows, [
    'series_key',
    'product_key',
    'collection_date',
    'security_purpose',
    'repayment_type',
    'rate_structure',
    'lvr_tier',
    'feature_set',
    'interest_rate',
    'comparison_rate',
    'annual_fee',
    'is_removed',
  ]))
}

async function collectSavingsCanonicalRows(
  dbs: DbPair,
  filters: SavingsAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  const maxRaw = resolveChartSeriesFetchCap(filters)
  return collectPaginatedRatesCapped(
    async (page, size) => {
      const result = await querySavingsRatesPaginated(dbs.canonicalDb, {
        page,
        size,
        sort: 'collection_date',
        dir: 'desc',
        startDate: filters.startDate,
        endDate: filters.endDate,
        bank: filters.bank,
        banks: filters.banks,
        accountType: filters.accountType,
        rateType: filters.rateType,
        depositTier: filters.depositTier,
        balanceMin: filters.balanceMin,
        balanceMax: filters.balanceMax,
        minRate: filters.minRate,
        maxRate: filters.maxRate,
        includeRemoved: filters.includeRemoved,
        excludeCompareEdgeCases: filters.excludeCompareEdgeCases,
        mode: filters.mode,
        sourceMode: filters.sourceMode,
      })
      return { rows: result.data as Array<Record<string, unknown>>, lastPage: result.last_page }
    },
    { pageSize: 1000, maxRows: maxRaw },
  )
    .then((rows) => rows.slice().reverse())
    .then((rows) => dedupeAnalyticsRows(rows, [
    'series_key',
    'product_key',
    'collection_date',
    'account_type',
    'rate_type',
    'deposit_tier',
    'interest_rate',
    'min_balance',
    'max_balance',
    'conditions',
    'monthly_fee',
    'is_removed',
  ]))
}

async function collectTdCanonicalRows(
  dbs: DbPair,
  filters: TdAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  const maxRaw = resolveChartSeriesFetchCap(filters)
  return collectPaginatedRatesCapped(
    async (page, size) => {
      const result = await queryTdRatesPaginated(dbs.canonicalDb, {
        page,
        size,
        sort: 'collection_date',
        dir: 'desc',
        startDate: filters.startDate,
        endDate: filters.endDate,
        bank: filters.bank,
        banks: filters.banks,
        termMonths: filters.termMonths,
        depositTier: filters.depositTier,
        balanceMin: filters.balanceMin,
        balanceMax: filters.balanceMax,
        interestPayment: filters.interestPayment,
        minRate: filters.minRate,
        maxRate: filters.maxRate,
        includeRemoved: filters.includeRemoved,
        excludeCompareEdgeCases: filters.excludeCompareEdgeCases,
        mode: filters.mode,
        sourceMode: filters.sourceMode,
      })
      return { rows: result.data as Array<Record<string, unknown>>, lastPage: result.last_page }
    },
    { pageSize: 1000, maxRows: maxRaw },
  )
    .then((rows) => rows.slice().reverse())
    .then((rows) => dedupeAnalyticsRows(rows, [
    'series_key',
    'product_key',
    'collection_date',
    'term_months',
    'deposit_tier',
    'interest_payment',
    'interest_rate',
    'min_deposit',
    'max_deposit',
    'is_removed',
  ]))
}

export async function collectHomeLoanAnalyticsRowsResolved(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: HomeLoanAnalyticsInput,
): Promise<ResolvedAnalyticsRows> {
  return resolveRepresentationRows(
    'home_loans',
    dbs,
    representation,
    filters,
    () =>
      collectByOffset(
        (limit, offset) =>
          queryHomeLoanAnalyticsRows(dbs.analyticsDb, { ...filters, limit, offset, rowSort: 'desc' }),
        5000,
        resolveChartSeriesFetchCap(filters),
      ),
    () => collectHomeLoanCanonicalRows(dbs, filters),
  )
}

export async function collectHomeLoanAnalyticsRows(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: HomeLoanAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  return (await collectHomeLoanAnalyticsRowsResolved(dbs, representation, filters)).rows
}

export async function collectSavingsAnalyticsRowsResolved(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: SavingsAnalyticsInput,
): Promise<ResolvedAnalyticsRows> {
  return resolveRepresentationRows(
    'savings',
    dbs,
    representation,
    filters,
    () =>
      collectByOffset(
        (limit, offset) =>
          querySavingsAnalyticsRows(dbs.analyticsDb, { ...filters, limit, offset, rowSort: 'desc' }),
        5000,
        resolveChartSeriesFetchCap(filters),
      ),
    () => collectSavingsCanonicalRows(dbs, filters),
  )
}

export async function collectSavingsAnalyticsRows(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: SavingsAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  return (await collectSavingsAnalyticsRowsResolved(dbs, representation, filters)).rows
}

export async function collectTdAnalyticsRowsResolved(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: TdAnalyticsInput,
): Promise<ResolvedAnalyticsRows> {
  return resolveRepresentationRows(
    'term_deposits',
    dbs,
    representation,
    filters,
    () =>
      collectByOffset(
        (limit, offset) =>
          queryTdAnalyticsRows(dbs.analyticsDb, { ...filters, limit, offset, rowSort: 'desc' }),
        5000,
        resolveChartSeriesFetchCap(filters),
      ),
    () => collectTdCanonicalRows(dbs, filters),
  )
}

export async function collectTdAnalyticsRows(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: TdAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  return (await collectTdAnalyticsRowsResolved(dbs, representation, filters)).rows
}

export async function queryHomeLoanRepresentationTimeseriesResolved(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: HomeLoanAnalyticsInput,
): Promise<ResolvedAnalyticsRows> {
  return resolveRepresentationRows(
    'home_loans',
    dbs,
    representation,
    filters,
    () => queryHomeLoanAnalyticsRows(dbs.analyticsDb, filters),
    async () => dedupeAnalyticsRows(await queryTimeseries(dbs.canonicalDb, filters), [
      'series_key',
      'product_key',
      'collection_date',
      'security_purpose',
      'repayment_type',
      'rate_structure',
      'lvr_tier',
      'feature_set',
      'interest_rate',
      'comparison_rate',
      'annual_fee',
      'is_removed',
    ]),
  )
}

export async function queryHomeLoanRepresentationTimeseries(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: HomeLoanAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  return (await queryHomeLoanRepresentationTimeseriesResolved(dbs, representation, filters)).rows
}

export async function querySavingsRepresentationTimeseriesResolved(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: SavingsAnalyticsInput,
): Promise<ResolvedAnalyticsRows> {
  return resolveRepresentationRows(
    'savings',
    dbs,
    representation,
    filters,
    () => querySavingsAnalyticsRows(dbs.analyticsDb, filters),
    async () => dedupeAnalyticsRows(await querySavingsTimeseries(dbs.canonicalDb, filters), [
      'series_key',
      'product_key',
      'collection_date',
      'account_type',
      'rate_type',
      'deposit_tier',
      'interest_rate',
      'min_balance',
      'max_balance',
      'conditions',
      'monthly_fee',
      'is_removed',
    ]),
  )
}

export async function querySavingsRepresentationTimeseries(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: SavingsAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  return (await querySavingsRepresentationTimeseriesResolved(dbs, representation, filters)).rows
}

export async function queryTdRepresentationTimeseriesResolved(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: TdAnalyticsInput,
): Promise<ResolvedAnalyticsRows> {
  return resolveRepresentationRows(
    'term_deposits',
    dbs,
    representation,
    filters,
    () => queryTdAnalyticsRows(dbs.analyticsDb, filters),
    async () => dedupeAnalyticsRows(await queryTdTimeseries(dbs.canonicalDb, filters), [
      'series_key',
      'product_key',
      'collection_date',
      'term_months',
      'deposit_tier',
      'interest_payment',
      'interest_rate',
      'min_deposit',
      'max_deposit',
      'is_removed',
    ]),
  )
}

export async function queryTdRepresentationTimeseries(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: TdAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  return (await queryTdRepresentationTimeseriesResolved(dbs, representation, filters)).rows
}
