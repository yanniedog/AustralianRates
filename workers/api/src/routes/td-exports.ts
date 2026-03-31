import type { Context, Hono } from 'hono'
import { type ExportFormat, type ExportScope } from '../db/export-jobs'
import { queryTdRatesPaginated } from '../db/td-queries'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import { collectTdAnalyticsRowsResolved, queryTdRepresentationTimeseriesResolved } from './analytics-data'
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

type TdExportFilters = {
  startDate?: string
  endDate?: string
  bank?: string
  banks?: string[]
  termMonths?: string
  depositTier?: string
  interestPayment?: string
  minRate?: number
  maxRate?: number
  includeRemoved?: boolean
  sort?: string
  dir?: 'asc' | 'desc'
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: ReturnType<typeof requestSource>
  productKey?: string
  seriesKey?: string
  representation?: 'day' | 'change'
}

function buildTdFilters(payload: Record<string, unknown>): TdExportFilters {
  return {
    startDate: requestString(payload, 'start_date'),
    endDate: requestString(payload, 'end_date'),
    bank: requestString(payload, 'bank'),
    banks: requestStringArray(payload, 'banks'),
    termMonths: requestString(payload, 'term_months'),
    depositTier: requestString(payload, 'deposit_tier'),
    interestPayment: requestString(payload, 'interest_payment'),
    minRate: requestNumber(payload, 'min_rate'),
    maxRate: requestNumber(payload, 'max_rate'),
    includeRemoved: requestBoolean(payload, 'include_removed'),
    sort: requestString(payload, 'sort'),
    dir: requestDir(payload),
    mode: requestMode(payload),
    sourceMode: requestSource(payload),
    productKey: requestString(payload, 'product_key') ?? requestString(payload, 'productKey'),
    seriesKey: requestString(payload, 'series_key'),
    representation: requestRepresentation(payload),
  }
}

async function buildTdArtifact(
  env: AppContext['Bindings'],
  scope: ExportScope,
  format: ExportFormat,
  filters: TdExportFilters,
): Promise<{ body: string; rowCount: number }> {
  const csvLines: string[] = []
  const jsonRows: string[] = []
  const csvState = { headers: null as string[] | null }
  const jsonState = { firstRow: true }
  let rowCount = 0
  const representation = filters.representation ?? 'day'
  let effectiveRepresentation = representation
  const dbs = { canonicalDb: env.DB, analyticsDb: getReadDb(env) }

  if (scope === 'timeseries') {
    if (!filters.productKey && !filters.seriesKey) {
      throw new Error('product_key_or_series_key_required')
    }
    let offset = 0
    while (true) {
      const result = await queryTdRepresentationTimeseriesResolved(dbs, representation, {
        bank: filters.bank,
        banks: filters.banks,
        productKey: filters.productKey,
        seriesKey: filters.seriesKey,
        termMonths: filters.termMonths,
        depositTier: filters.depositTier,
        interestPayment: filters.interestPayment,
        minRate: filters.minRate,
        maxRate: filters.maxRate,
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
        ? await collectTdAnalyticsRowsResolved(dbs, representation, {
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
        : {
            requestedRepresentation: representation,
            representation: 'day' as const,
            fallbackReason: null,
            rows: await collectPaginatedExportRows((page, size) =>
              queryTdRatesPaginated(env.DB, {
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
    body: buildJsonExportBody('term_deposits', scope, effectiveRepresentation, rowCount, jsonRows),
    rowCount,
  }
}

async function runTdExportJob(
  env: AppContext['Bindings'],
  input: {
    jobId: string
    scope: ExportScope
    format: ExportFormat
    filters: TdExportFilters
  },
): Promise<void> {
  await runDatasetExportJob(env, {
    ...input,
    dataset: 'term_deposits',
    fileNamePrefix: 'term-deposit-rates',
    buildArtifact: buildTdArtifact,
  })
}

export function registerTdExportRoutes(
  routes: Hono<AppContext>,
  options?: {
    routeBase?: string
    pathPrefix?: string
    guardCreateJob?: (c: Context<AppContext>) => Response | null
  },
): void {
  registerExportRoutes(routes, {
    dataset: 'term_deposits',
    buildFilters: buildTdFilters,
    runExportJob: runTdExportJob,
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
