import { Hono } from 'hono'
import { DEFAULT_PUBLIC_CACHE_SECONDS } from '../constants'
import type { RatesPaginatedFilters } from '../db/queries'
import { getFilters, queryLatestAllRates, queryLatestRates, queryLatestRatesCount, queryRatesForExport, queryRatesPaginated, queryTimeseries } from '../db/queries'
import { getLenderDatasetCoverage } from '../db/lender-coverage'
import { getHistoricalPullDetail, startHistoricalPullRun } from '../pipeline/client-historical'
import { HISTORICAL_TRIGGER_DEPRECATION_CODE, HISTORICAL_TRIGGER_DEPRECATION_MESSAGE, hasDeprecatedHistoricalTriggerPayload } from './historical-deprecation'
import { guardPublicHistoricalPull, guardPublicTriggerRun } from './public-write-gates'
import { handlePublicTriggerRun } from './trigger-run'
import type { AppContext } from '../types'
import { jsonError, withNoStore, withPublicCache } from '../utils/http'
import { log } from '../utils/logger'
import { buildListMeta, setCsvMetaHeaders, sourceMixFromRows } from '../utils/response-meta'
import { paginateRows, parseCursorOffset, parsePageSize } from '../utils/cursor-pagination'
import { parseSourceMode } from '../utils/source-mode'
import { handlePublicRunStatus } from './public-run-status'
import { registerHomeLoanExportRoutes } from './home-loan-exports'
import { HOME_LOAN_COMPARISON_RATE_DISCLOSURE } from './home-loan-disclosures'
import { matchLatestCache, setServerTimingHeader, shouldBypassLatestCache, shouldEnableAdminDebugTiming, storeLatestCache } from './latest-response'
import { toCsv } from '../utils/csv'
import { parseCsvList, parseIncludeRemoved, parseOptionalNumber } from './public-query'
import { registerPublicCoreRoutes } from './public-core-routes'

export const publicRoutes = new Hono<AppContext>()

publicRoutes.use('*', async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS)
  else withNoStore(c)
  await next()
})

registerHomeLoanExportRoutes(publicRoutes)
registerPublicCoreRoutes(publicRoutes)

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
  const filters = await getFilters(c.env.DB)
  return c.json({
    ok: true,
    filters,
  })
})

publicRoutes.get('/rates', async (c) => {
  const query = c.req.query()
  const dir = String(query.dir || 'desc').toLowerCase()
  const modeRaw = String(query.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)
  const banks = parseCsvList(query.banks)
  const includeRemoved = parseIncludeRemoved(query.include_removed)

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
    sort: query.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : 'desc',
    mode,
    sourceMode,
  }

  let result: Awaited<ReturnType<typeof queryRatesPaginated>>
  try {
    result = await queryRatesPaginated(c.env.DB, filters)
  } catch (err) {
    log.error('public', 'rates paginated failed, returning empty', {
      context: (err as Error)?.message ?? String(err),
    })
    result = {
      last_page: 1,
      total: 0,
      data: [],
      source_mix: { scheduled: 0, manual: 0 },
    }
  }

  const meta = buildListMeta({
    sourceMode,
    totalRows: result.total,
    returnedRows: result.data.length,
    sourceMix: result.source_mix,
    limited: result.total > result.data.length,
    disclosures: HOME_LOAN_COMPARISON_RATE_DISCLOSURE,
  })

  return c.json({ ...result, meta })
})

publicRoutes.get('/export', async (c) => {
  const query = c.req.query()
  const format = String(query.format || 'json').toLowerCase()
  if (format !== 'csv' && format !== 'json') {
    return jsonError(c, 400, 'INVALID_FORMAT', 'format must be csv or json')
  }
  const exportLimit = parsePageSize(String(query.limit || ''), 10000, 10000)
  const dir = String(query.dir || 'desc').toLowerCase()
  const modeRaw = String(query.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)
  const banks = parseCsvList(query.banks)
  const includeRemoved = parseIncludeRemoved(query.include_removed)

  const { data, total, source_mix } = await queryRatesForExport(c.env.DB, {
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
    sort: query.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : 'desc',
    mode,
    sourceMode,
    limit: exportLimit,
  })
  const meta = buildListMeta({
    sourceMode,
    totalRows: total,
    returnedRows: data.length,
    sourceMix: source_mix,
    limited: total > data.length,
    disclosures: HOME_LOAN_COMPARISON_RATE_DISCLOSURE,
  })

  if (format === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="rates-export.csv"')
    setCsvMetaHeaders(c, meta)
    return c.body(toCsv(data as Array<Record<string, unknown>>))
  }

  c.header('Content-Type', 'application/json; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="rates-export.json"')
  return c.json({ data, total, last_page: 1, meta })
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
  const modeRaw = String(query.mode || 'all').toLowerCase()
  const mode: 'daily' | 'historical' | 'all' = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const orderByRaw = String(query.order_by || query.orderBy || 'default').toLowerCase()
  const orderBy: 'default' | 'rate_asc' | 'rate_desc' = orderByRaw === 'rate_asc' || orderByRaw === 'rate_desc' ? orderByRaw : 'default'
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)
  const banks = parseCsvList(query.banks)
  const includeRemoved = parseIncludeRemoved(query.include_removed)

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
    mode,
    sourceMode,
    limit,
    orderBy,
  }
  const latestTiming: { dbMainMs?: number; detailHydrateMs?: number } = {}
  let dbCountMs = 0
  const [rows, total] = await Promise.all([
    queryLatestRates(c.env.DB, filters, latestTiming),
    (async () => {
      const countStartedAt = Date.now()
      const value = await queryLatestRatesCount(c.env.DB, filters)
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
  const modeRaw = String(query.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const orderByRaw = String(query.order_by || query.orderBy || 'default').toLowerCase()
  const orderBy = orderByRaw === 'rate_asc' || orderByRaw === 'rate_desc' ? orderByRaw : 'default'
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)
  const banks = parseCsvList(query.banks)
  const includeRemoved = parseIncludeRemoved(query.include_removed)

  const latestTiming: { dbMainMs?: number; detailHydrateMs?: number } = {}
  const rows = await queryLatestAllRates(c.env.DB, {
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
  const modeRaw = String(query.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)
  const pageSize = parsePageSize(String(query.page_size || query.limit || ''), 1000, 1000)
  const cursor = parseCursorOffset(query.cursor)
  const banks = parseCsvList(query.banks)

  if (!productKey) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'product_key or series_key is required for timeseries queries.')
  }

  const rows = await queryTimeseries(c.env.DB, {
    bank: query.bank,
    banks,
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
    limit: pageSize + 1,
    offset: cursor,
  })
  const paged = paginateRows(rows, cursor, pageSize)
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
    count: paged.rows.length,
    rows: paged.rows,
    next_cursor: paged.nextCursor,
    partial: paged.partial,
    meta,
  })
})

publicRoutes.get('/coverage', async (c) => {
  withPublicCache(c, 60)
  const coverage = await getLenderDatasetCoverage(c.env.DB, 'home_loans', {
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
  const modeRaw = String(query.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(query.source_mode, query.include_manual)

  if (dataset === 'timeseries') {
    const productKey = query.product_key || query.productKey || query.series_key
    if (!productKey) {
      return jsonError(c, 400, 'INVALID_REQUEST', 'product_key or series_key is required for timeseries CSV export.')
    }
    const rows = await queryTimeseries(c.env.DB, {
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

  const rows = await queryLatestRates(c.env.DB, {
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
    disclosures: HOME_LOAN_COMPARISON_RATE_DISCLOSURE,
  })

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="latest-${mode}.csv"`)
  setCsvMetaHeaders(c, meta)
  return c.body(toCsv(rows as Array<Record<string, unknown>>))
})
