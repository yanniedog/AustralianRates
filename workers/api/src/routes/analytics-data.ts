import { queryHomeLoanAnalyticsRows, querySavingsAnalyticsRows, queryTdAnalyticsRows, type HomeLoanAnalyticsInput, type SavingsAnalyticsInput, type TdAnalyticsInput } from '../db/analytics/change-reads'
import { queryRatesPaginated, queryTimeseries } from '../db/queries'
import { querySavingsRatesPaginated, querySavingsTimeseries } from '../db/savings-queries'
import { queryTdRatesPaginated, queryTdTimeseries } from '../db/td-queries'
import type { AnalyticsRepresentation } from './analytics-route-utils'
import { collectAllPages } from './analytics-route-utils'

type DbPair = {
  canonicalDb: D1Database
  analyticsDb: D1Database
}

async function collectByOffset<T>(
  fetchChunk: (limit: number, offset: number) => Promise<T[]>,
  pageSize = 5000,
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  while (true) {
    const chunk = await fetchChunk(pageSize, offset)
    rows.push(...chunk)
    if (chunk.length < pageSize) break
    offset += chunk.length
  }
  return rows
}

export async function collectHomeLoanAnalyticsRows(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: HomeLoanAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  if (representation === 'change') {
    return collectByOffset((limit, offset) => queryHomeLoanAnalyticsRows(dbs.analyticsDb, { ...filters, limit, offset }))
  }
  return collectAllPages(async (page, size) => {
    const result = await queryRatesPaginated(dbs.canonicalDb, {
      page,
      size,
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
      mode: filters.mode,
      sourceMode: filters.sourceMode,
    })
    return { rows: result.data as Array<Record<string, unknown>>, lastPage: result.last_page }
  })
}

export async function collectSavingsAnalyticsRows(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: SavingsAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  if (representation === 'change') {
    return collectByOffset((limit, offset) => querySavingsAnalyticsRows(dbs.analyticsDb, { ...filters, limit, offset }))
  }
  return collectAllPages(async (page, size) => {
    const result = await querySavingsRatesPaginated(dbs.canonicalDb, {
      page,
      size,
      startDate: filters.startDate,
      endDate: filters.endDate,
      bank: filters.bank,
      banks: filters.banks,
      accountType: filters.accountType,
      rateType: filters.rateType,
      depositTier: filters.depositTier,
      minRate: filters.minRate,
      maxRate: filters.maxRate,
      includeRemoved: filters.includeRemoved,
      mode: filters.mode,
      sourceMode: filters.sourceMode,
    })
    return { rows: result.data as Array<Record<string, unknown>>, lastPage: result.last_page }
  })
}

export async function collectTdAnalyticsRows(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: TdAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  if (representation === 'change') {
    return collectByOffset((limit, offset) => queryTdAnalyticsRows(dbs.analyticsDb, { ...filters, limit, offset }))
  }
  return collectAllPages(async (page, size) => {
    const result = await queryTdRatesPaginated(dbs.canonicalDb, {
      page,
      size,
      startDate: filters.startDate,
      endDate: filters.endDate,
      bank: filters.bank,
      banks: filters.banks,
      termMonths: filters.termMonths,
      depositTier: filters.depositTier,
      interestPayment: filters.interestPayment,
      minRate: filters.minRate,
      maxRate: filters.maxRate,
      includeRemoved: filters.includeRemoved,
      mode: filters.mode,
      sourceMode: filters.sourceMode,
    })
    return { rows: result.data as Array<Record<string, unknown>>, lastPage: result.last_page }
  })
}

export async function queryHomeLoanRepresentationTimeseries(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: HomeLoanAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  if (representation === 'change') {
    return queryHomeLoanAnalyticsRows(dbs.analyticsDb, filters)
  }
  return queryTimeseries(dbs.canonicalDb, filters)
}

export async function querySavingsRepresentationTimeseries(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: SavingsAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  if (representation === 'change') {
    return querySavingsAnalyticsRows(dbs.analyticsDb, filters)
  }
  return querySavingsTimeseries(dbs.canonicalDb, filters)
}

export async function queryTdRepresentationTimeseries(
  dbs: DbPair,
  representation: AnalyticsRepresentation,
  filters: TdAnalyticsInput,
): Promise<Array<Record<string, unknown>>> {
  if (representation === 'change') {
    return queryTdAnalyticsRows(dbs.analyticsDb, filters)
  }
  return queryTdTimeseries(dbs.canonicalDb, filters)
}
