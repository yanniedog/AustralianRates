import { Hono } from 'hono'
import { DEFAULT_PUBLIC_CACHE_SECONDS } from '../constants'
import type { RatesPaginatedFilters } from '../db/queries'
import { getFilters, queryLatestAllRates, queryLatestRates, queryLatestRatesCount, queryRatesForExport, queryRatesPaginated, queryTimeseries } from '../db/queries'
import { getReadDb } from '../db/read-db'
import { getLenderDatasetCoverage } from '../db/lender-coverage'
import { getHistoricalPullDetail, startHistoricalPullRun } from '../pipeline/client-historical'
import { HISTORICAL_TRIGGER_DEPRECATION_CODE, HISTORICAL_TRIGGER_DEPRECATION_MESSAGE, hasDeprecatedHistoricalTriggerPayload } from './historical-deprecation'
import { guardPublicHistoricalPull, guardPublicTriggerRun } from './public-write-gates'
import { handlePublicTriggerRun } from './trigger-run'
import type { AppContext } from '../types'
import { jsonError, withNoStore, withPublicCache } from '../utils/http'
import { log } from '../utils/logger'
import { buildListMeta, setCsvMetaHeaders, sourceMixFromRows } from '../utils/response-meta'
import { PUBLIC_EXPORT_MAX_EXPLICIT_LIMIT } from '../constants'
import { paginateRows, parseCursorOffset, parseOptionalExportLimit, parsePageSize } from '../utils/cursor-pagination'
import { parseSourceMode } from '../utils/source-mode'
import { handlePublicRunStatus } from './public-run-status'
import { registerHomeLoanExportRoutes } from './home-loan-exports'
import { registerHomeLoanAnalyticsRoutes } from './home-loan-analytics'
import { HOME_LOAN_COMPARISON_RATE_DISCLOSURE } from './home-loan-disclosures'
import { registerDebugLogRoutes } from './debug-log'
import { handlePublicReadFailure } from './public-read-error'
import {
  matchLatestCache,
  matchPublicReadCache,
  setServerTimingHeader,
  shouldBypassLatestCache,
  shouldBypassPublicReadCache,
  shouldEnableAdminDebugTiming,
  storeLatestCache,
  storePublicReadCache,
} from './latest-response'
import { toCsv } from '../utils/csv'
import { queryHomeLoanRepresentationTimeseriesResolved } from './analytics-data'
import { parseAnalyticsRepresentation } from './analytics-route-utils'
import {
  parseCsvList,
  parseExcludeCompareEdgeCases,
  parseIncludeRemoved,
  parseOptionalNumber,
  parsePublicMode,
  parseRateOrderBy,
  parseSortDirection,
} from './public-query'
import { registerPublicCoreRoutes } from './public-core-routes'
import { registerRbaRoutes } from './rba-routes'
import { registerCpiRoutes } from './cpi-routes'
import { registerHomeLoanChartDataRoute } from './chart-data/home-loans'
import { registerSnapshotRoute } from './snapshot-public'

export const publicRoutes = new Hono<AppContext>()

publicRoutes.use('*', async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS)
  else withNoStore(c)
  await next()
})

registerHomeLoanExportRoutes(publicRoutes)
registerDebugLogRoutes(publicRoutes)
registerHomeLoanAnalyticsRoutes(publicRoutes)
registerPublicCoreRoutes(publicRoutes)
registerRbaRoutes(publicRoutes)
registerCpiRoutes(publicRoutes)
registerHomeLoanChartDataRoute(publicRoutes)
registerSnapshotRoute(publicRoutes, 'home_loans')

publicRoutes.post('/trigger-run', async (c) => {
  const guard = guardPublicTriggerRun(c)
  if (guard) return guard

  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  if (hasDeprecatedHistoricalTriggerPayload(body)) {
    return jsonError(c, 410, HISTORICAL_TRIGGER_DEPRECATION_CODE, HISTORICAL_TRIGGER_DEPRECATION_MESSAGE)
  }

  const result = await handlePublicTriggerRun(c.env, 'home-loans')
  return c.json(result.body, result.status)
})

publicRoutes.get('/run-status/:runId', handlePublicRunStatus)

publicRoutes.post('/historical/pull', async (c) => {
  const guard = guardPublicHistoricalPull(c)
  if (guard) return guard

  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const startDate = String(body.start_date ?? body.startDate ?? '').trim()
  const endDate = String(body.end_date ?? body.endDate ?? '').trim()
  const created = await startHistoricalPullRun(c.env, {
    triggerSource: 'public',
    requestedBy: 'public_historical_pull',
    startDate,
    endDate,
  })
  if (!created.ok) {
    return jsonError(c, created.status as 400 | 401 | 403 | 404 | 409 | 429 | 500, created.code, created.message, created.details)
  }
  return c.json({ ok: true, ...created.value })
})

publicRoutes.get('/historical/pull/:runId', async (c) => {
  const detail = await getHistoricalPullDetail(c.env, c.req.param('runId'), 'public')
  if (!detail.ok) {
    return jsonError(c, detail.status as 400 | 401 | 403 | 404 | 409 | 429 | 500, detail.code, detail.message, detail.details)
  }
  return c.json({ ok: true, ...detail.value })
})

publicRoutes.get('/filters', async (c) => {
  const { cacheKey, response: cachedResponse } = await matchPublicReadCache(c, shouldBypassPublicReadCache(c, false))
  if (cachedResponse) {
    return cachedResponse
  }

  const filters = await getFilters(getReadDb(c))
  const response = c.json({
    ok: true,
    filters,
  })
  storePublicReadCache(c, cacheKey, response)
  return response
})

publicRoutes.get('/rates', async (c) => {
  const { cacheKey, response: cachedResponse } = await matchPublicReadCache(c, shouldBypassPublicReadCache(c, false))
  if (cachedResponse) {
    return cachedResponse
  }

  const query = c.req.query()
  const dir = parseSortDirection(query.dir)
  const mode = parsePublicMode(query.mode)
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)
  const banks = parseCsvList(query.banks)
  const includeRemoved = parseIncludeRemoved(query.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(query.exclude_compare_edge_cases)

  const filters: RatesPaginatedFilters = {
    page: Number(query.page || 1),
    size: Number(query.size || 50),
    startDate: query.start_date,
    endDate: query.end_date,
    bank: query.bank,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    banks,
    minRate: parseOptionalNumber(query.min_rate),
    maxRate: parseOptionalNumber(query.max_rate),
    minComparisonRate: parseOptionalNumber(query.min_comparison_rate),
    maxComparisonRate: parseOptionalNumber(query.max_comparison_rate),
      includeRemoved,
      excludeCompareEdgeCases,
      sort: query.sort,
      dir,
      mode,
      sourceMode,
    }

  let result: Awaited<ReturnType<typeof queryRatesPaginated>>
  try {
    result = await queryRatesPaginated(getReadDb(c), filters)
  } catch (err) {
    return handlePublicReadFailure(
      c,
      'home_loan_rates_query_failed',
      'PUBLIC_RATES_QUERY_FAILED',
      'Failed to query home loan rates.',
      err,
    )
  }

  const meta = buildListMeta({
    sourceMode,
    totalRows: result.total,
    returnedRows: result.data.length,
    sourceMix: result.source_mix,
    limited: result.total > result.data.length,
    excludeCompareEdgeCases,
    disclosures: HOME_LOAN_COMPARISON_RATE_DISCLOSURE,
  })

  const response = c.json({ ...result, meta })
  storePublicReadCache(c, cacheKey, response)
  return response
})

publicRoutes.get('/export', async (c) => {
  const { cacheKey, response: cachedResponse } = await matchPublicReadCache(c, shouldBypassPublicReadCache(c, false))
  if (cachedResponse) {
    return cachedResponse
  }

  const query = c.req.query()
  const format = String(query.format || 'json').toLowerCase()
  if (format !== 'csv' && format !== 'json') {
    return jsonError(c, 400, 'INVALID_FORMAT', 'format must be csv or json')
  }
  const exportLimit = parseOptionalExportLimit(query.limit, PUBLIC_EXPORT_MAX_EXPLICIT_LIMIT)
  const dir = parseSortDirection(query.dir)
  const mode = parsePublicMode(query.mode)
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)
  const banks = parseCsvList(query.banks)
  const includeRemoved = parseIncludeRemoved(query.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(query.exclude_compare_edge_cases)

  let result: Awaited<ReturnType<typeof queryRatesForExport>>
  try {
    result = await queryRatesForExport(getReadDb(c), {
      startDate: query.start_date,
      endDate: query.end_date,
      bank: query.bank,
      securityPurpose: query.security_purpose,
      repaymentType: query.repayment_type,
      rateStructure: query.rate_structure,
      lvrTier: query.lvr_tier,
      featureSet: query.feature_set,
      banks,
      minRate: parseOptionalNumber(query.min_rate),
      maxRate: parseOptionalNumber(query.max_rate),
      minComparisonRate: parseOptionalNumber(query.min_comparison_rate),
      maxComparisonRate: parseOptionalNumber(query.max_comparison_rate),
      includeRemoved,
      excludeCompareEdgeCases,
      sort: query.sort,
      dir,
      mode,
      sourceMode,
      ...(exportLimit != null ? { limit: exportLimit } : {}),
    })
  } catch (err) {
    return handlePublicReadFailure(
      c,
      'home_loan_export_query_failed',
      'PUBLIC_EXPORT_QUERY_FAILED',
      'Failed to export home loan rates.',
      err,
    )
  }
  const meta = buildListMeta({
    sourceMode,
    totalRows: result.total,
    returnedRows: result.data.length,
    sourceMix: result.source_mix,
    limited: result.total > result.data.length,
    excludeCompareEdgeCases,
    disclosures: HOME_LOAN_COMPARISON_RATE_DISCLOSURE,
  })

  if (format === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="rates-export.csv"')
    setCsvMetaHeaders(c, meta)
    const response = c.body(toCsv(result.data as Array<Record<string, unknown>>))
    storePublicReadCache(c, cacheKey, response)
    return response
  }

  c.header('Content-Type', 'application/json; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="rates-export.json"')
  const response = c.json({ data: result.data, total: result.total, last_page: 1, meta })
  storePublicReadCache(c, cacheKey, response)
  return response
})

publicRoutes.get('/latest', async (c) => {
  const debugTiming = await shouldEnableAdminDebugTiming(c)
  const { cacheKey, response: cachedResponse } = await matchLatestCache(c, shouldBypassLatestCache(c, debugTiming))
  if (cachedResponse) {
    return cachedResponse
  }

  const totalStartedAt = Date.now()
  const query = c.req.query()
  const limit = Number(query.limit || 1000)
  const mode = parsePublicMode(query.mode)
  const orderBy = parseRateOrderBy(query.order_by, query.orderBy)
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)
  const banks = parseCsvList(query.banks)
  const includeRemoved = parseIncludeRemoved(query.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(query.exclude_compare_edge_cases)

  const filters = {
    bank: query.bank,
    banks,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    minRate: parseOptionalNumber(query.min_rate),
    maxRate: parseOptionalNumber(query.max_rate),
    minComparisonRate: parseOptionalNumber(query.min_comparison_rate),
    maxComparisonRate: parseOptionalNumber(query.max_comparison_rate),
    includeRemoved,
    excludeCompareEdgeCases,
    mode,
    sourceMode,
    limit,
    orderBy,
  }
  const latestTiming: { dbMainMs?: number; detailHydrateMs?: number } = {}
  let dbCountMs = 0
  const [rows, total] = await Promise.all([
    queryLatestRates(getReadDb(c), filters, latestTiming),
    (async () => {
      const countStartedAt = Date.now()
      const value = await queryLatestRatesCount(getReadDb(c), filters)
      dbCountMs = Date.now() - countStartedAt
      return value
    })(),
  ])
  const meta = buildListMeta({
    sourceMode,
    totalRows: rows.length,
    returnedRows: rows.length,
    sourceMix: sourceMixFromRows(rows as Array<Record<string, unknown>>),
    limited: rows.length >= Math.max(1, Math.floor(limit)),
    excludeCompareEdgeCases,
    disclosures: HOME_LOAN_COMPARISON_RATE_DISCLOSURE,
  })
  const jsonStartedAt = Date.now()
  const response = c.json({
    ok: true,
    count: rows.length,
    total,
    rows,
    meta,
  })
  const jsonMs = Date.now() - jsonStartedAt
  if (debugTiming) {
    setServerTimingHeader(response, {
      dbMainMs: latestTiming.dbMainMs,
      dbCountMs,
      detailHydrateMs: latestTiming.detailHydrateMs,
      jsonMs,
      totalMs: Date.now() - totalStartedAt,
    })
  }
  storeLatestCache(c, cacheKey, response)
  return response
})

publicRoutes.get('/latest-all', async (c) => {
  const debugTiming = await shouldEnableAdminDebugTiming(c)
  const { cacheKey, response: cachedResponse } = await matchLatestCache(c, shouldBypassLatestCache(c, debugTiming))
  if (cachedResponse) {
    return cachedResponse
  }

  const totalStartedAt = Date.now()
  const query = c.req.query()
  const limit = Number(query.limit || 1000)
  const mode = parsePublicMode(query.mode)
  const orderBy = parseRateOrderBy(query.order_by, query.orderBy)
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)
  const banks = parseCsvList(query.banks)
  const includeRemoved = parseIncludeRemoved(query.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(query.exclude_compare_edge_cases)

  const latestTiming: { dbMainMs?: number; detailHydrateMs?: number } = {}
  const rows = await queryLatestAllRates(getReadDb(c), {
    bank: query.bank,
    banks,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    minRate: parseOptionalNumber(query.min_rate),
    maxRate: parseOptionalNumber(query.max_rate),
    minComparisonRate: parseOptionalNumber(query.min_comparison_rate),
    maxComparisonRate: parseOptionalNumber(query.max_comparison_rate),
    includeRemoved,
    excludeCompareEdgeCases,
    mode,
    sourceMode,
    limit,
    orderBy,
  }, latestTiming)
  const meta = buildListMeta({
    sourceMode,
    totalRows: rows.length,
    returnedRows: rows.length,
    sourceMix: sourceMixFromRows(rows as Array<Record<string, unknown>>),
    limited: rows.length >= Math.max(1, Math.floor(limit)),
    excludeCompareEdgeCases,
    disclosures: HOME_LOAN_COMPARISON_RATE_DISCLOSURE,
  })
  const jsonStartedAt = Date.now()
  const response = c.json({
    ok: true,
    count: rows.length,
    rows,
    meta,
  })
  const jsonMs = Date.now() - jsonStartedAt
  if (debugTiming) {
    setServerTimingHeader(response, {
      dbMainMs: latestTiming.dbMainMs,
      detailHydrateMs: latestTiming.detailHydrateMs,
      jsonMs,
      totalMs: Date.now() - totalStartedAt,
    })
  }
  storeLatestCache(c, cacheKey, response)
  return response
})

publicRoutes.get('/timeseries', async (c) => {
  const query = c.req.query()
  const productKey = query.product_key || query.productKey || query.series_key
  const mode = parsePublicMode(query.mode)
  const representation = parseAnalyticsRepresentation(query.representation)
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)
  const pageSize = parsePageSize(String(query.page_size || query.limit || ''), 1000, 1000)
  const cursor = parseCursorOffset(query.cursor)
  const banks = parseCsvList(query.banks)

  if (!productKey) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'product_key or series_key is required for timeseries queries.')
  }

  const result = await queryHomeLoanRepresentationTimeseriesResolved(
    { canonicalDb: getReadDb(c), analyticsDb: getReadDb(c) },
    representation,
    {
    bank: query.bank,
    banks,
    productKey,
    seriesKey: query.series_key,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    minRate: parseOptionalNumber(query.min_rate),
    maxRate: parseOptionalNumber(query.max_rate),
    minComparisonRate: parseOptionalNumber(query.min_comparison_rate),
    maxComparisonRate: parseOptionalNumber(query.max_comparison_rate),
    includeRemoved: parseIncludeRemoved(query.include_removed),
    mode,
    sourceMode,
    startDate: query.start_date,
    endDate: query.end_date,
    limit: pageSize + 1,
    offset: cursor,
    },
  )
  const paged = paginateRows(result.rows, cursor, pageSize)
  const meta = buildListMeta({
    sourceMode,
    totalRows: paged.rows.length,
    returnedRows: paged.rows.length,
    sourceMix: sourceMixFromRows(paged.rows as Array<Record<string, unknown>>),
    limited: paged.partial,
    disclosures: HOME_LOAN_COMPARISON_RATE_DISCLOSURE,
  })

  return c.json({
    ok: true,
    representation: result.representation,
    requested_representation: result.requestedRepresentation,
    fallback_reason: result.fallbackReason,
    count: paged.rows.length,
    rows: paged.rows,
    next_cursor: paged.nextCursor,
    partial: paged.partial,
    meta,
  })
})

publicRoutes.get('/coverage', async (c) => {
  withPublicCache(c, 60)
  const coverage = await getLenderDatasetCoverage(getReadDb(c), 'home_loans', {
    lenderCode: c.req.query('lender_code') || undefined,
    collectionDate: c.req.query('collection_date') || undefined,
    limit: Number(c.req.query('limit') || 200),
  })
  return c.json({ ok: true, ...coverage })
})

publicRoutes.get('/logs/stats', async (c) => {
  withNoStore(c)
  return jsonError(
    c,
    403,
    'PUBLIC_LOGS_DISABLED',
    'Public system log access is disabled. Use admin log endpoints with admin authentication.',
    {
      admin_path: '/api/home-loan-rates/admin/logs/system/stats',
    },
  )
})

publicRoutes.get('/logs', async (c) => {
  withNoStore(c)
  return jsonError(
    c,
    403,
    'PUBLIC_LOGS_DISABLED',
    'Public system log access is disabled. Use admin log endpoints with admin authentication.',
    {
      admin_path: '/api/home-loan-rates/admin/logs/system',
    },
  )
})

publicRoutes.get('/export.csv', async (c) => {
  const query = c.req.query()
  const dataset = String(query.dataset || 'latest').toLowerCase()
  const mode = parsePublicMode(query.mode)
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(query.exclude_compare_edge_cases)

  if (dataset === 'timeseries') {
    const productKey = query.product_key || query.productKey || query.series_key
    if (!productKey) {
      return jsonError(c, 400, 'INVALID_REQUEST', 'product_key or series_key is required for timeseries CSV export.')
    }
    const rows = await queryTimeseries(getReadDb(c), {
      bank: query.bank,
      banks: parseCsvList(query.banks),
      productKey,
      seriesKey: query.series_key,
      securityPurpose: query.security_purpose,
      repaymentType: query.repayment_type,
      featureSet: query.feature_set,
      minRate: parseOptionalNumber(query.min_rate),
      maxRate: parseOptionalNumber(query.max_rate),
      minComparisonRate: parseOptionalNumber(query.min_comparison_rate),
      maxComparisonRate: parseOptionalNumber(query.max_comparison_rate),
      includeRemoved: parseIncludeRemoved(query.include_removed),
      mode,
      sourceMode,
      startDate: query.start_date,
      endDate: query.end_date,
      limit: Number(query.limit || 5000),
    })
    const meta = buildListMeta({
      sourceMode,
      totalRows: rows.length,
      returnedRows: rows.length,
      sourceMix: sourceMixFromRows(rows as Array<Record<string, unknown>>),
      limited: false,
      disclosures: HOME_LOAN_COMPARISON_RATE_DISCLOSURE,
    })
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="timeseries-${mode}.csv"`)
    setCsvMetaHeaders(c, meta)
    return c.body(toCsv(rows as Array<Record<string, unknown>>))
  }

  const rows = await queryLatestRates(getReadDb(c), {
    bank: query.bank,
    banks: parseCsvList(query.banks),
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    minRate: parseOptionalNumber(query.min_rate),
    maxRate: parseOptionalNumber(query.max_rate),
    minComparisonRate: parseOptionalNumber(query.min_comparison_rate),
    maxComparisonRate: parseOptionalNumber(query.max_comparison_rate),
    includeRemoved: parseIncludeRemoved(query.include_removed),
    excludeCompareEdgeCases,
    mode,
    sourceMode,
    limit: Number(query.limit || 1000),
  })
  const meta = buildListMeta({
    sourceMode,
    totalRows: rows.length,
    returnedRows: rows.length,
    sourceMix: sourceMixFromRows(rows as Array<Record<string, unknown>>),
    limited: false,
    excludeCompareEdgeCases,
    disclosures: HOME_LOAN_COMPARISON_RATE_DISCLOSURE,
  })

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="latest-${mode}.csv"`)
  setCsvMetaHeaders(c, meta)
  return c.body(toCsv(rows as Array<Record<string, unknown>>))
})
