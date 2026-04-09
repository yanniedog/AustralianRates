import type { Context, Hono } from 'hono'
import { type ExportFormat, type ExportScope } from '../db/export-jobs'
import { queryRatesPaginated } from '../db/queries'
import { getReadDbFromEnv } from '../db/read-db'
import type { AppContext } from '../types'
import { collectHomeLoanAnalyticsRowsResolved, queryHomeLoanRepresentationTimeseriesResolved } from './analytics-data'
import { registerExportRoutes, runDatasetExportJob } from './export-route-registration'
import {
  appendCsvChunk,
  appendJsonChunk,
  buildJsonExportBody,
  collectPaginatedExportRows,
  requestBoolean,
  requestDir,
  requestMode,
  requestNumber,
  requestRepresentation,
  requestSource,
  requestString,
  requestStringArray,
} from './export-route-utils'

type HomeLoanExportFilters = {
  startDate?: string
  endDate?: string
  bank?: string
  banks?: string[]
  securityPurpose?: string
  repaymentType?: string
  rateStructure?: string
  lvrTier?: string
  featureSet?: string
  minRate?: number
  maxRate?: number
  minComparisonRate?: number
  maxComparisonRate?: number
  includeRemoved?: boolean
  sort?: string
  dir?: 'asc' | 'desc'
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: ReturnType<typeof requestSource>
  productKey?: string
  seriesKey?: string
  representation?: 'day' | 'change'
}

function buildHomeLoanFilters(payload: Record<string, unknown>): HomeLoanExportFilters {
  return {
    startDate: requestString(payload, 'start_date'),
    endDate: requestString(payload, 'end_date'),
    bank: requestString(payload, 'bank'),
    banks: requestStringArray(payload, 'banks'),
    securityPurpose: requestString(payload, 'security_purpose'),
    repaymentType: requestString(payload, 'repayment_type'),
    rateStructure: requestString(payload, 'rate_structure'),
    lvrTier: requestString(payload, 'lvr_tier'),
    featureSet: requestString(payload, 'feature_set'),
    minRate: requestNumber(payload, 'min_rate'),
    maxRate: requestNumber(payload, 'max_rate'),
    minComparisonRate: requestNumber(payload, 'min_comparison_rate'),
    maxComparisonRate: requestNumber(payload, 'max_comparison_rate'),
    includeRemoved: requestBoolean(payload, 'include_removed'),
    sort: requestString(payload, 'sort'),
    dir: requestDir(payload),
    mode: requestMode(payload),
    sourceMode: requestSource(payload),
    productKey: requestString(payload, 'product_key') ?? requestString(payload, 'productKey') ?? requestString(payload, 'series_key'),
    seriesKey: requestString(payload, 'series_key'),
    representation: requestRepresentation(payload),
  }
}

async function buildHomeLoanArtifact(
  env: AppContext['Bindings'],
  scope: ExportScope,
  format: ExportFormat,
  filters: HomeLoanExportFilters,
): Promise<{ body: string; rowCount: number }> {
  const csvLines: string[] = []
  const jsonRows: string[] = []
  const csvState = { headers: null as string[] | null }
  const jsonState = { firstRow: true }
  let rowCount = 0
  const representation = filters.representation ?? 'day'
  let effectiveRepresentation = representation
  const rd = getReadDbFromEnv(env)
  const dbs = { canonicalDb: rd, analyticsDb: rd }

  if (scope === 'timeseries') {
    if (!filters.productKey && !filters.seriesKey) {
      throw new Error('product_key_or_series_key_required')
    }
    let offset = 0
    while (true) {
      const result = await queryHomeLoanRepresentationTimeseriesResolved(dbs, representation, {
        bank: filters.bank,
        banks: filters.banks,
        productKey: filters.productKey,
        seriesKey: filters.seriesKey,
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
        startDate: filters.startDate,
        endDate: filters.endDate,
        limit: 1000,
        offset,
      })
      const rows = result.rows
      effectiveRepresentation = result.representation
      if (rows.length === 0) break
      rowCount += rows.length
      if (format === 'csv') appendCsvChunk(csvLines, csvState, rows as Array<Record<string, unknown>>)
      else appendJsonChunk(jsonRows, jsonState, rows as Array<Record<string, unknown>>)
      if (rows.length < 1000) break
      offset += rows.length
    }
  } else {
    const result =
      representation === 'change'
        ? await collectHomeLoanAnalyticsRowsResolved(dbs, representation, {
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
        : {
            requestedRepresentation: representation,
            representation: 'day' as const,
            fallbackReason: null,
            rows: await collectPaginatedExportRows((page, size) =>
              queryRatesPaginated(rd, {
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
                sort: filters.sort,
                dir: filters.dir,
                mode: filters.mode,
                sourceMode: filters.sourceMode,
              }),
            ),
          }
    const rows = result.rows
    effectiveRepresentation = result.representation
    rowCount += rows.length
    if (format === 'csv') appendCsvChunk(csvLines, csvState, rows as Array<Record<string, unknown>>)
    else appendJsonChunk(jsonRows, jsonState, rows as Array<Record<string, unknown>>)
  }

  if (format === 'csv') {
    return { body: csvLines.join('\n'), rowCount }
  }

  return {
    body: buildJsonExportBody('home_loans', scope, effectiveRepresentation, rowCount, jsonRows),
    rowCount,
  }
}

async function runHomeLoanExportJob(
  env: AppContext['Bindings'],
  input: {
    jobId: string
    scope: ExportScope
    format: ExportFormat
    filters: HomeLoanExportFilters
  },
): Promise<void> {
  await runDatasetExportJob(env, {
    ...input,
    dataset: 'home_loans',
    fileNamePrefix: 'home-loan-rates',
    buildArtifact: buildHomeLoanArtifact,
  })
}

export function registerHomeLoanExportRoutes(
  routes: Hono<AppContext>,
  options?: {
    routeBase?: string
    pathPrefix?: string
    guardCreateJob?: (c: Context<AppContext>) => Response | null
  },
): void {
  registerExportRoutes(routes, {
    dataset: 'home_loans',
    buildFilters: buildHomeLoanFilters,
    runExportJob: runHomeLoanExportJob,
    routeBase: options?.routeBase,
    pathPrefix: options?.pathPrefix,
    guardCreateJob: options?.guardCreateJob,
    validate: (scope, filters) =>
      scope === 'timeseries' && !filters.productKey && !filters.seriesKey
        ? {
            code: 'INVALID_REQUEST',
            message: 'product_key or series_key is required for timeseries exports.',
          }
        : null,
  })
}
