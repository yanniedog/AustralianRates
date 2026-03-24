import { Hono } from 'hono'
import { DEFAULT_PUBLIC_CACHE_SECONDS } from '../constants'
import {
  getSavingsFilters,
  getSavingsQualityDiagnostics,
  getSavingsStaleness,
  queryLatestAllSavingsRates,
  queryLatestSavingsRates,
  queryLatestSavingsRatesCount,
  querySavingsForExport,
  querySavingsRatesPaginated,
  querySavingsTimeseries,
} from '../db/savings-queries'
import { getReadDb } from '../db/read-db'
import { getLenderDatasetCoverage } from '../db/lender-coverage'
import { getHistoricalPullDetail, startHistoricalPullRun } from '../pipeline/client-historical'
import { HISTORICAL_TRIGGER_DEPRECATION_CODE, HISTORICAL_TRIGGER_DEPRECATION_MESSAGE, hasDeprecatedHistoricalTriggerPayload } from './historical-deprecation'
import { guardPublicHistoricalPull, guardPublicTriggerRun } from './public-write-gates'
import { handlePublicTriggerRun } from './trigger-run'
import type { AppContext } from '../types'
import { jsonError, withNoStore, withPublicCache } from '../utils/http'
import { buildListMeta, setCsvMetaHeaders, sourceMixFromRows } from '../utils/response-meta'
import { PUBLIC_EXPORT_MAX_EXPLICIT_LIMIT } from '../constants'
import { paginateRows, parseCursorOffset, parseOptionalExportLimit, parsePageSize } from '../utils/cursor-pagination'
import { parseSourceMode } from '../utils/source-mode'
import { handlePublicRunStatus } from './public-run-status'
import { querySavingsRateChangeIntegrity, querySavingsRateChanges } from '../db/rate-change-log'
import { registerSavingsAnalyticsRoutes } from './savings-analytics'
import { parseAnalyticsRepresentation } from './analytics-route-utils'
import { querySavingsRepresentationTimeseriesResolved } from './analytics-data'
import { queryChangesWithFallback, queryIntegritySafely } from './change-route-utils'
import { getLandingOverview } from '../db/landing-overview'
import { queryExecutiveSummaryReport } from '../db/executive-summary'
import { registerSavingsExportRoutes } from './savings-exports'
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
import { parseCsvList, parseExcludeCompareEdgeCases, parseIncludeRemoved, parseOptionalNumber } from './public-query'
import { registerRbaRoutes } from './rba-routes'
import { registerSavingsChartDataRoute } from './chart-data/savings'

export const savingsPublicRoutes = new Hono<AppContext>()

savingsPublicRoutes.use('*', async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS)
  else withNoStore(c)
  await next()
})

registerSavingsExportRoutes(savingsPublicRoutes)
registerSavingsAnalyticsRoutes(savingsPublicRoutes)
registerRbaRoutes(savingsPublicRoutes)
registerSavingsChartDataRoute(savingsPublicRoutes)

savingsPublicRoutes.get('/overview', async (c) => {
  withPublicCache(c, 60)
  const overview = await getLandingOverview(c.env.DB, 'savings')
  return c.json({ ok: true, ...overview })
})

savingsPublicRoutes.get('/health', (c) => {
  withPublicCache(c, 30)
  return c.json({ ok: true, service: 'australianrates-savings' })
})

savingsPublicRoutes.get('/staleness', async (c) => {
  withPublicCache(c, 60)
  const staleness = await getSavingsStaleness(c.env.DB)
  const staleLenders = staleness.filter((l) => l.stale)
  return c.json({ ok: true, stale_count: staleLenders.length, lenders: staleness })
})

savingsPublicRoutes.get('/quality/diagnostics', async (c) => {
  const diagnostics = await getSavingsQualityDiagnostics(c.env.DB)
  return c.json({ ok: true, diagnostics })
})

savingsPublicRoutes.get('/executive-summary', async (c) => {
  withPublicCache(c, 120)
  const requestedWindowDays = Number(c.req.query('window_days') || 30)
  const report = await queryExecutiveSummaryReport(c.env.DB, {
    windowDays: requestedWindowDays,
  })
  return c.json({
    ok: true,
    ...report,
  })
})

savingsPublicRoutes.get('/changes', async (c) => {
  withPublicCache(c, 120)
  const q = c.req.query()
  const limit = Number(q.limit || 200)
  const offset = Number(q.offset || 0)
  const [changeResult, integrity] = await Promise.all([
    queryChangesWithFallback(c.env.DB, getReadDb(c.env), 'savings', { limit, offset }, querySavingsRateChanges),
    queryIntegritySafely('savings', () => querySavingsRateChangeIntegrity(c.env.DB)),
  ])
  return c.json({
    ok: true,
    source: changeResult.source,
    count: changeResult.result.rows.length,
    total: changeResult.result.total,
    rows: changeResult.result.rows,
    integrity,
  })
})

savingsPublicRoutes.post('/trigger-run', async (c) => {
  const guard = guardPublicTriggerRun(c)
  if (guard) return guard

  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  if (hasDeprecatedHistoricalTriggerPayload(body)) {
    return jsonError(c, 410, HISTORICAL_TRIGGER_DEPRECATION_CODE, HISTORICAL_TRIGGER_DEPRECATION_MESSAGE)
  }

  const result = await handlePublicTriggerRun(c.env, 'savings')
  return c.json(result.body, result.status)
})

savingsPublicRoutes.get('/run-status/:runId', handlePublicRunStatus)

savingsPublicRoutes.post('/historical/pull', async (c) => {
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

savingsPublicRoutes.get('/historical/pull/:runId', async (c) => {
  const detail = await getHistoricalPullDetail(c.env, c.req.param('runId'), 'public')
  if (!detail.ok) {
    return jsonError(c, detail.status as 400 | 401 | 403 | 404 | 409 | 429 | 500, detail.code, detail.message, detail.details)
  }
  return c.json({ ok: true, ...detail.value })
})

savingsPublicRoutes.get('/filters', async (c) => {
  const { cacheKey, response: cachedResponse } = await matchPublicReadCache(c, shouldBypassPublicReadCache(c, false))
  if (cachedResponse) {
    return cachedResponse
  }

  const filters = await getSavingsFilters(c.env.DB)
  const response = c.json({ ok: true, filters })
  storePublicReadCache(c, cacheKey, response)
  return response
})

savingsPublicRoutes.get('/rates', async (c) => {
  const { cacheKey, response: cachedResponse } = await matchPublicReadCache(c, shouldBypassPublicReadCache(c, false))
  if (cachedResponse) {
    return cachedResponse
  }

  const q = c.req.query()
  const dir = String(q.dir || 'desc').toLowerCase()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const banks = parseCsvList(q.banks)
  const includeRemoved = parseIncludeRemoved(q.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases)

  const result = await querySavingsRatesPaginated(c.env.DB, {
    page: Number(q.page || 1),
    size: Number(q.size || 50),
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    banks,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    minRate: parseOptionalNumber(q.min_rate),
    maxRate: parseOptionalNumber(q.max_rate),
    includeRemoved,
    excludeCompareEdgeCases,
    sort: q.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : 'desc',
    mode,
    sourceMode,
  })
  const meta = buildListMeta({
    sourceMode,
    totalRows: result.total,
    returnedRows: result.data.length,
    sourceMix: result.source_mix,
    limited: result.total > result.data.length,
    excludeCompareEdgeCases,
  })
  const response = c.json({ ...result, meta })
  storePublicReadCache(c, cacheKey, response)
  return response
})

savingsPublicRoutes.get('/latest', async (c) => {
  const debugTiming = await shouldEnableAdminDebugTiming(c)
  const { cacheKey, response: cachedResponse } = await matchLatestCache(c, shouldBypassLatestCache(c, debugTiming))
  if (cachedResponse) {
    return cachedResponse
  }

  const totalStartedAt = Date.now()
  const q = c.req.query()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode: 'daily' | 'historical' | 'all' = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const orderByRaw = String(q.order_by || q.orderBy || 'default').toLowerCase()
  const orderBy: 'default' | 'rate_asc' | 'rate_desc' = orderByRaw === 'rate_asc' || orderByRaw === 'rate_desc' ? orderByRaw : 'default'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const limit = Number(q.limit || 1000)
  const banks = parseCsvList(q.banks)
  const includeRemoved = parseIncludeRemoved(q.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases)

  const filters = {
    bank: q.bank,
    banks,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    minRate: parseOptionalNumber(q.min_rate),
    maxRate: parseOptionalNumber(q.max_rate),
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
    queryLatestSavingsRates(c.env.DB, filters, latestTiming),
    (async () => {
      const countStartedAt = Date.now()
      const value = await queryLatestSavingsRatesCount(c.env.DB, filters)
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
  })
  const jsonStartedAt = Date.now()
  const response = c.json({ ok: true, count: rows.length, total, rows, meta })
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

savingsPublicRoutes.get('/latest-all', async (c) => {
  const debugTiming = await shouldEnableAdminDebugTiming(c)
  const { cacheKey, response: cachedResponse } = await matchLatestCache(c, shouldBypassLatestCache(c, debugTiming))
  if (cachedResponse) {
    return cachedResponse
  }

  const totalStartedAt = Date.now()
  const q = c.req.query()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const orderByRaw = String(q.order_by || q.orderBy || 'default').toLowerCase()
  const orderBy = orderByRaw === 'rate_asc' || orderByRaw === 'rate_desc' ? orderByRaw : 'default'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const limit = Number(q.limit || 1000)
  const banks = parseCsvList(q.banks)
  const includeRemoved = parseIncludeRemoved(q.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases)

  const latestTiming: { dbMainMs?: number; detailHydrateMs?: number } = {}
  const rows = await queryLatestAllSavingsRates(c.env.DB, {
    bank: q.bank,
    banks,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    minRate: parseOptionalNumber(q.min_rate),
    maxRate: parseOptionalNumber(q.max_rate),
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
  })
  const jsonStartedAt = Date.now()
  const response = c.json({ ok: true, count: rows.length, rows, meta })
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

savingsPublicRoutes.get('/timeseries', async (c) => {
  const q = c.req.query()
  const productKey = q.product_key || q.productKey || q.series_key
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const representation = parseAnalyticsRepresentation(q.representation)
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const pageSize = parsePageSize(String(q.page_size || q.limit || ''), 1000, 1000)
  const cursor = parseCursorOffset(q.cursor)
  const banks = parseCsvList(q.banks)
  if (!productKey) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'product_key or series_key is required for timeseries queries.')
  }

  const result = await querySavingsRepresentationTimeseriesResolved(
    { canonicalDb: c.env.DB, analyticsDb: getReadDb(c.env) },
    representation,
    {
    bank: q.bank,
    banks,
    productKey,
    seriesKey: q.series_key,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    minRate: parseOptionalNumber(q.min_rate),
    maxRate: parseOptionalNumber(q.max_rate),
    includeRemoved: parseIncludeRemoved(q.include_removed),
    mode,
    sourceMode,
    startDate: q.start_date,
    endDate: q.end_date,
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

savingsPublicRoutes.get('/coverage', async (c) => {
  withPublicCache(c, 60)
  const coverage = await getLenderDatasetCoverage(c.env.DB, 'savings', {
    lenderCode: c.req.query('lender_code') || undefined,
    collectionDate: c.req.query('collection_date') || undefined,
    limit: Number(c.req.query('limit') || 200),
  })
  return c.json({ ok: true, ...coverage })
})

savingsPublicRoutes.get('/export', async (c) => {
  const { cacheKey, response: cachedResponse } = await matchPublicReadCache(c, shouldBypassPublicReadCache(c, false))
  if (cachedResponse) {
    return cachedResponse
  }

  const q = c.req.query()
  const format = String(q.format || 'json').toLowerCase()
  if (format !== 'csv' && format !== 'json') {
    return jsonError(c, 400, 'INVALID_FORMAT', 'format must be csv or json')
  }
  const exportLimit = parseOptionalExportLimit(q.limit, PUBLIC_EXPORT_MAX_EXPLICIT_LIMIT)
  const dir = String(q.dir || 'desc').toLowerCase()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const banks = parseCsvList(q.banks)
  const includeRemoved = parseIncludeRemoved(q.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases)

  const { data, total, source_mix } = await querySavingsForExport(c.env.DB, {
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    banks,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    minRate: parseOptionalNumber(q.min_rate),
    maxRate: parseOptionalNumber(q.max_rate),
    includeRemoved,
    excludeCompareEdgeCases,
    sort: q.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : 'desc',
    mode,
    sourceMode,
    ...(exportLimit != null ? { limit: exportLimit } : {}),
  })
  const meta = buildListMeta({
    sourceMode,
    totalRows: total,
    returnedRows: data.length,
    sourceMix: source_mix,
    limited: total > data.length,
    excludeCompareEdgeCases,
  })

  if (format === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="savings-export.csv"')
    setCsvMetaHeaders(c, meta)
    const response = c.body(toCsv(data as Array<Record<string, unknown>>))
    storePublicReadCache(c, cacheKey, response)
    return response
  }
  c.header('Content-Type', 'application/json; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="savings-export.json"')
  const response = c.json({ data, total, last_page: 1, meta })
  storePublicReadCache(c, cacheKey, response)
  return response
})

savingsPublicRoutes.get('/export.csv', async (c) => {
  const q = c.req.query()
  const dataset = String(q.dataset || 'latest').toLowerCase()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases)

  if (dataset === 'timeseries') {
    const productKey = q.product_key || q.productKey || q.series_key
    if (!productKey) {
      return jsonError(c, 400, 'INVALID_REQUEST', 'product_key or series_key is required for timeseries CSV export.')
    }
  const rows = await querySavingsTimeseries(c.env.DB, {
      bank: q.bank,
      banks: parseCsvList(q.banks),
      productKey,
      seriesKey: q.series_key,
      accountType: q.account_type,
      rateType: q.rate_type,
      minRate: parseOptionalNumber(q.min_rate),
      maxRate: parseOptionalNumber(q.max_rate),
      includeRemoved: parseIncludeRemoved(q.include_removed),
      mode,
      sourceMode,
      startDate: q.start_date,
      endDate: q.end_date,
      limit: Number(q.limit || 5000),
    })
    const meta = buildListMeta({
      sourceMode,
      totalRows: rows.length,
      returnedRows: rows.length,
      sourceMix: sourceMixFromRows(rows as Array<Record<string, unknown>>),
      limited: false,
    })
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="savings-timeseries.csv"')
    setCsvMetaHeaders(c, meta)
    return c.body(toCsv(rows as Array<Record<string, unknown>>))
  }

  const rows = await queryLatestSavingsRates(c.env.DB, {
    bank: q.bank,
    banks: parseCsvList(q.banks),
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    minRate: parseOptionalNumber(q.min_rate),
    maxRate: parseOptionalNumber(q.max_rate),
    includeRemoved: parseIncludeRemoved(q.include_removed),
    excludeCompareEdgeCases,
    mode,
    sourceMode,
    limit: Number(q.limit || 1000),
  })
  const meta = buildListMeta({
    sourceMode,
    totalRows: rows.length,
    returnedRows: rows.length,
    sourceMix: sourceMixFromRows(rows as Array<Record<string, unknown>>),
    limited: false,
    excludeCompareEdgeCases,
  })
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="savings-latest.csv"')
  setCsvMetaHeaders(c, meta)
  return c.body(toCsv(rows as Array<Record<string, unknown>>))
})

