import { Hono } from 'hono'
import { DEFAULT_PUBLIC_CACHE_SECONDS } from '../constants'
import {
  getTdFilters,
  getTdQualityDiagnostics,
  getTdStaleness,
  queryLatestAllTdRates,
  queryLatestTdRates,
  queryLatestTdRatesCount,
  queryTdForExport,
  queryTdRatesPaginated,
  queryTdTimeseries,
} from '../db/td-queries'
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
import { queryTdRateChangeIntegrity, queryTdRateChanges } from '../db/rate-change-log'
import { registerDebugLogRoutes } from './debug-log'
import { registerTdAnalyticsRoutes } from './td-analytics'
import { parseAnalyticsRepresentation } from './analytics-route-utils'
import { queryTdRepresentationTimeseriesResolved } from './analytics-data'
import { queryChangesWithFallback, queryIntegritySafely } from './change-route-utils'
import { getLandingOverview } from '../db/landing-overview'
import { registerCpiRoutes } from './cpi-routes'
import { registerRbaRoutes } from './rba-routes'
import { queryExecutiveSummaryReport } from '../db/executive-summary'
import { registerTdExportRoutes } from './td-exports'
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
import {
  parseCsvList,
  parseExcludeCompareEdgeCases,
  parseIncludeRemoved,
  parseOptionalNumber,
  parsePublicMode,
  parseRateOrderBy,
  parseSortDirection,
} from './public-query'
import { registerTdChartDataRoute } from './chart-data/term-deposits'
import { registerSiteUiPublicRoute } from './site-ui-public'

export const tdPublicRoutes = new Hono<AppContext>()

tdPublicRoutes.use('*', async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS)
  else withNoStore(c)
  await next()
})

registerTdExportRoutes(tdPublicRoutes)
registerDebugLogRoutes(tdPublicRoutes)
registerTdAnalyticsRoutes(tdPublicRoutes)
registerRbaRoutes(tdPublicRoutes)
registerCpiRoutes(tdPublicRoutes)
registerTdChartDataRoute(tdPublicRoutes)
registerSiteUiPublicRoute(tdPublicRoutes)

tdPublicRoutes.get('/overview', async (c) => {
  withPublicCache(c, 60)
  const overview = await getLandingOverview(getReadDb(c), 'term_deposits')
  return c.json({ ok: true, ...overview })
})

tdPublicRoutes.get('/health', (c) => {
  withPublicCache(c, 30)
  return c.json({ ok: true, service: 'australianrates-term-deposits' })
})

tdPublicRoutes.get('/staleness', async (c) => {
  withPublicCache(c, 60)
  const staleness = await getTdStaleness(getReadDb(c))
  const staleLenders = staleness.filter((l) => l.stale)
  return c.json({ ok: true, stale_count: staleLenders.length, lenders: staleness })
})

tdPublicRoutes.get('/quality/diagnostics', async (c) => {
  const diagnostics = await getTdQualityDiagnostics(getReadDb(c))
  return c.json({ ok: true, diagnostics })
})

tdPublicRoutes.get('/executive-summary', async (c) => {
  withPublicCache(c, 120)
  const requestedWindowDays = Number(c.req.query('window_days') || 30)
  const report = await queryExecutiveSummaryReport(getReadDb(c), {
    windowDays: requestedWindowDays,
  })
  return c.json({
    ok: true,
    ...report,
  })
})

tdPublicRoutes.get('/changes', async (c) => {
  withPublicCache(c, 120)
  const q = c.req.query()
  const limit = Number(q.limit || 200)
  const offset = Number(q.offset || 0)
  const [changeResult, integrity] = await Promise.all([
    queryChangesWithFallback(getReadDb(c), getReadDb(c), 'term_deposits', { limit, offset }, queryTdRateChanges),
    queryIntegritySafely('term_deposits', () => queryTdRateChangeIntegrity(getReadDb(c))),
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

tdPublicRoutes.post('/trigger-run', async (c) => {
  const guard = guardPublicTriggerRun(c)
  if (guard) return guard

  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  if (hasDeprecatedHistoricalTriggerPayload(body)) {
    return jsonError(c, 410, HISTORICAL_TRIGGER_DEPRECATION_CODE, HISTORICAL_TRIGGER_DEPRECATION_MESSAGE)
  }

  const result = await handlePublicTriggerRun(c.env, 'term-deposits')
  return c.json(result.body, result.status)
})

tdPublicRoutes.get('/run-status/:runId', handlePublicRunStatus)

tdPublicRoutes.post('/historical/pull', async (c) => {
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

tdPublicRoutes.get('/historical/pull/:runId', async (c) => {
  const detail = await getHistoricalPullDetail(c.env, c.req.param('runId'), 'public')
  if (!detail.ok) {
    return jsonError(c, detail.status as 400 | 401 | 403 | 404 | 409 | 429 | 500, detail.code, detail.message, detail.details)
  }
  return c.json({ ok: true, ...detail.value })
})

tdPublicRoutes.get('/filters', async (c) => {
  const { cacheKey, response: cachedResponse } = await matchPublicReadCache(c, shouldBypassPublicReadCache(c, false))
  if (cachedResponse) {
    return cachedResponse
  }

  const filters = await getTdFilters(getReadDb(c))
  const response = c.json({ ok: true, filters })
  storePublicReadCache(c, cacheKey, response)
  return response
})

tdPublicRoutes.get('/rates', async (c) => {
  const { cacheKey, response: cachedResponse } = await matchPublicReadCache(c, shouldBypassPublicReadCache(c, false))
  if (cachedResponse) {
    return cachedResponse
  }

  const q = c.req.query()
  const dir = parseSortDirection(q.dir)
  const mode = parsePublicMode(q.mode)
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const banks = parseCsvList(q.banks)
  const includeRemoved = parseIncludeRemoved(q.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases)

  const result = await queryTdRatesPaginated(getReadDb(c), {
    page: Number(q.page || 1),
    size: Number(q.size || 50),
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    banks,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    balanceMin: parseOptionalNumber(q.balance_min),
    balanceMax: parseOptionalNumber(q.balance_max),
    interestPayment: q.interest_payment,
    minRate: parseOptionalNumber(q.min_rate),
    maxRate: parseOptionalNumber(q.max_rate),
    includeRemoved,
    excludeCompareEdgeCases,
    sort: q.sort,
    dir,
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

tdPublicRoutes.get('/latest', async (c) => {
  const debugTiming = await shouldEnableAdminDebugTiming(c)
  const { cacheKey, response: cachedResponse } = await matchLatestCache(c, shouldBypassLatestCache(c, debugTiming))
  if (cachedResponse) {
    return cachedResponse
  }

  const totalStartedAt = Date.now()
  const q = c.req.query()
  const mode = parsePublicMode(q.mode)
  const orderBy = parseRateOrderBy(q.order_by, q.orderBy)
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const limit = Number(q.limit || 1000)
  const banks = parseCsvList(q.banks)
  const includeRemoved = parseIncludeRemoved(q.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases)

  const filters = {
    bank: q.bank,
    banks,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    balanceMin: parseOptionalNumber(q.balance_min),
    balanceMax: parseOptionalNumber(q.balance_max),
    interestPayment: q.interest_payment,
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
    queryLatestTdRates(getReadDb(c), filters, latestTiming),
    (async () => {
      const countStartedAt = Date.now()
      const value = await queryLatestTdRatesCount(getReadDb(c), filters)
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

tdPublicRoutes.get('/latest-all', async (c) => {
  const debugTiming = await shouldEnableAdminDebugTiming(c)
  const { cacheKey, response: cachedResponse } = await matchLatestCache(c, shouldBypassLatestCache(c, debugTiming))
  if (cachedResponse) {
    return cachedResponse
  }

  const totalStartedAt = Date.now()
  const q = c.req.query()
  const mode = parsePublicMode(q.mode)
  const orderBy = parseRateOrderBy(q.order_by, q.orderBy)
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const limit = Number(q.limit || 1000)
  const banks = parseCsvList(q.banks)
  const includeRemoved = parseIncludeRemoved(q.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases)

  const latestTiming: { dbMainMs?: number; detailHydrateMs?: number } = {}
  const rows = await queryLatestAllTdRates(getReadDb(c), {
    bank: q.bank,
    banks,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    balanceMin: parseOptionalNumber(q.balance_min),
    balanceMax: parseOptionalNumber(q.balance_max),
    interestPayment: q.interest_payment,
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

tdPublicRoutes.get('/timeseries', async (c) => {
  const q = c.req.query()
  const productKey = q.product_key || q.productKey
  const seriesKey = q.series_key
  const mode = parsePublicMode(q.mode)
  const representation = parseAnalyticsRepresentation(q.representation)
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const pageSize = parsePageSize(String(q.page_size || q.limit || ''), 1000, 1000)
  const cursor = parseCursorOffset(q.cursor)
  const banks = parseCsvList(q.banks)
  if (!productKey && !seriesKey) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'product_key or series_key is required for timeseries queries.')
  }

  const result = await queryTdRepresentationTimeseriesResolved(
    { canonicalDb: getReadDb(c), analyticsDb: getReadDb(c) },
    representation,
    {
    bank: q.bank,
    banks,
    productKey,
    seriesKey,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    balanceMin: parseOptionalNumber(q.balance_min),
    balanceMax: parseOptionalNumber(q.balance_max),
    interestPayment: q.interest_payment,
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

tdPublicRoutes.get('/coverage', async (c) => {
  withPublicCache(c, 60)
  const coverage = await getLenderDatasetCoverage(getReadDb(c), 'term_deposits', {
    lenderCode: c.req.query('lender_code') || undefined,
    collectionDate: c.req.query('collection_date') || undefined,
    limit: Number(c.req.query('limit') || 200),
  })
  return c.json({ ok: true, ...coverage })
})

tdPublicRoutes.get('/export', async (c) => {
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
  const dir = parseSortDirection(q.dir)
  const mode = parsePublicMode(q.mode)
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const banks = parseCsvList(q.banks)
  const includeRemoved = parseIncludeRemoved(q.include_removed)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases)

  const { data, total, source_mix } = await queryTdForExport(getReadDb(c), {
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    banks,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    balanceMin: parseOptionalNumber(q.balance_min),
    balanceMax: parseOptionalNumber(q.balance_max),
    interestPayment: q.interest_payment,
    minRate: parseOptionalNumber(q.min_rate),
    maxRate: parseOptionalNumber(q.max_rate),
    includeRemoved,
    excludeCompareEdgeCases,
    sort: q.sort,
    dir,
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
    c.header('Content-Disposition', 'attachment; filename="td-export.csv"')
    setCsvMetaHeaders(c, meta)
    const response = c.body(toCsv(data as Array<Record<string, unknown>>))
    storePublicReadCache(c, cacheKey, response)
    return response
  }
  c.header('Content-Type', 'application/json; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="td-export.json"')
  const response = c.json({ data, total, last_page: 1, meta })
  storePublicReadCache(c, cacheKey, response)
  return response
})

tdPublicRoutes.get('/export.csv', async (c) => {
  const q = c.req.query()
  const dataset = String(q.dataset || 'latest').toLowerCase()
  const mode = parsePublicMode(q.mode)
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const excludeCompareEdgeCases = parseExcludeCompareEdgeCases(q.exclude_compare_edge_cases)

  if (dataset === 'timeseries') {
    const productKey = q.product_key || q.productKey
    const seriesKey = q.series_key
    if (!productKey && !seriesKey) {
      return jsonError(c, 400, 'INVALID_REQUEST', 'product_key or series_key is required for timeseries CSV export.')
    }
  const rows = await queryTdTimeseries(getReadDb(c), {
      bank: q.bank,
      banks: parseCsvList(q.banks),
      productKey,
      seriesKey,
      termMonths: q.term_months,
      depositTier: q.deposit_tier,
      balanceMin: parseOptionalNumber(q.balance_min),
      balanceMax: parseOptionalNumber(q.balance_max),
      interestPayment: q.interest_payment,
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
    c.header('Content-Disposition', 'attachment; filename="td-timeseries.csv"')
    setCsvMetaHeaders(c, meta)
    return c.body(toCsv(rows as Array<Record<string, unknown>>))
  }

  const rows = await queryLatestTdRates(getReadDb(c), {
    bank: q.bank,
    banks: parseCsvList(q.banks),
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    balanceMin: parseOptionalNumber(q.balance_min),
    balanceMax: parseOptionalNumber(q.balance_max),
    interestPayment: q.interest_payment,
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
  c.header('Content-Disposition', 'attachment; filename="td-latest.csv"')
  setCsvMetaHeaders(c, meta)
  return c.body(toCsv(rows as Array<Record<string, unknown>>))
})

