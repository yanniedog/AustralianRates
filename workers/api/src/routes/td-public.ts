import { Hono } from 'hono'
import { DEFAULT_PUBLIC_CACHE_SECONDS } from '../constants'
import {
  getTdFilters,
  getTdQualityDiagnostics,
  getTdStaleness,
  queryLatestAllTdRates,
  queryLatestTdRates,
  queryTdForExport,
  queryTdRatesPaginated,
  queryTdTimeseries,
} from '../db/td-queries'
import { getHistoricalPullDetail, startHistoricalPullRun } from '../pipeline/client-historical'
import { HISTORICAL_TRIGGER_DEPRECATION_CODE, HISTORICAL_TRIGGER_DEPRECATION_MESSAGE, hasDeprecatedHistoricalTriggerPayload } from './historical-deprecation'
import { handlePublicTriggerRun } from './trigger-run'
import type { AppContext } from '../types'
import { jsonError, withPublicCache } from '../utils/http'
import { buildListMeta, setCsvMetaHeaders, sourceMixFromRows } from '../utils/response-meta'
import { parseSourceMode } from '../utils/source-mode'
import { handlePublicRunStatus } from './public-run-status'

export const tdPublicRoutes = new Hono<AppContext>()

tdPublicRoutes.use('*', async (c, next) => {
  withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS)
  await next()
})

tdPublicRoutes.get('/health', (c) => {
  withPublicCache(c, 30)
  return c.json({ ok: true, service: 'australianrates-term-deposits' })
})

tdPublicRoutes.get('/staleness', async (c) => {
  withPublicCache(c, 60)
  const staleness = await getTdStaleness(c.env.DB)
  const staleLenders = staleness.filter((l) => l.stale)
  return c.json({ ok: true, stale_count: staleLenders.length, lenders: staleness })
})

tdPublicRoutes.get('/quality/diagnostics', async (c) => {
  const diagnostics = await getTdQualityDiagnostics(c.env.DB)
  return c.json({ ok: true, diagnostics })
})

tdPublicRoutes.post('/trigger-run', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  if (hasDeprecatedHistoricalTriggerPayload(body)) {
    return jsonError(c, 410, HISTORICAL_TRIGGER_DEPRECATION_CODE, HISTORICAL_TRIGGER_DEPRECATION_MESSAGE)
  }

  const result = await handlePublicTriggerRun(c.env, 'term-deposits')
  return c.json(result.body, result.status)
})

tdPublicRoutes.get('/run-status/:runId', handlePublicRunStatus)

tdPublicRoutes.post('/historical/pull', async (c) => {
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
  const filters = await getTdFilters(c.env.DB)
  return c.json({ ok: true, filters })
})

tdPublicRoutes.get('/rates', async (c) => {
  const q = c.req.query()
  const dir = String(q.dir || 'desc').toLowerCase()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)

  const result = await queryTdRatesPaginated(c.env.DB, {
    page: Number(q.page || 1),
    size: Number(q.size || 50),
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
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
  })
  return c.json({ ...result, meta })
})

tdPublicRoutes.get('/latest', async (c) => {
  const q = c.req.query()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const orderByRaw = String(q.order_by || q.orderBy || 'default').toLowerCase()
  const orderBy = orderByRaw === 'rate_asc' || orderByRaw === 'rate_desc' ? orderByRaw : 'default'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const limit = Number(q.limit || 200)

  const rows = await queryLatestTdRates(c.env.DB, {
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
    mode,
    sourceMode,
    limit,
    orderBy,
  })
  const meta = buildListMeta({
    sourceMode,
    totalRows: rows.length,
    returnedRows: rows.length,
    sourceMix: sourceMixFromRows(rows as Array<Record<string, unknown>>),
    limited: rows.length >= Math.max(1, Math.floor(limit)),
  })
  return c.json({ ok: true, count: rows.length, rows, meta })
})

tdPublicRoutes.get('/latest-all', async (c) => {
  const q = c.req.query()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const orderByRaw = String(q.order_by || q.orderBy || 'default').toLowerCase()
  const orderBy = orderByRaw === 'rate_asc' || orderByRaw === 'rate_desc' ? orderByRaw : 'default'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const limit = Number(q.limit || 200)

  const rows = await queryLatestAllTdRates(c.env.DB, {
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
    mode,
    sourceMode,
    limit,
    orderBy,
  })
  const meta = buildListMeta({
    sourceMode,
    totalRows: rows.length,
    returnedRows: rows.length,
    sourceMix: sourceMixFromRows(rows as Array<Record<string, unknown>>),
    limited: rows.length >= Math.max(1, Math.floor(limit)),
  })
  return c.json({ ok: true, count: rows.length, rows, meta })
})

tdPublicRoutes.get('/timeseries', async (c) => {
  const q = c.req.query()
  const productKey = q.product_key || q.productKey
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const limit = Number(q.limit || 1000)
  if (!productKey) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'product_key is required for timeseries queries.')
  }

  const rows = await queryTdTimeseries(c.env.DB, {
    bank: q.bank,
    productKey,
    termMonths: q.term_months,
    mode,
    sourceMode,
    startDate: q.start_date,
    endDate: q.end_date,
    limit,
  })
  const meta = buildListMeta({
    sourceMode,
    totalRows: rows.length,
    returnedRows: rows.length,
    sourceMix: sourceMixFromRows(rows as Array<Record<string, unknown>>),
    limited: rows.length >= Math.max(1, Math.floor(limit)),
  })
  return c.json({ ok: true, count: rows.length, rows, meta })
})

tdPublicRoutes.get('/export', async (c) => {
  const q = c.req.query()
  const format = String(q.format || 'json').toLowerCase()
  if (format !== 'csv' && format !== 'json') {
    return jsonError(c, 400, 'INVALID_FORMAT', 'format must be csv or json')
  }
  const dir = String(q.dir || 'desc').toLowerCase()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)

  const { data, total, source_mix } = await queryTdForExport(c.env.DB, {
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
    sort: q.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : 'desc',
    mode,
    sourceMode,
  })
  const meta = buildListMeta({
    sourceMode,
    totalRows: total,
    returnedRows: data.length,
    sourceMix: source_mix,
    limited: total > data.length,
  })

  if (format === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="td-export.csv"')
    setCsvMetaHeaders(c, meta)
    return c.body(toCsv(data as Array<Record<string, unknown>>))
  }
  c.header('Content-Type', 'application/json; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="td-export.json"')
  return c.json({ data, total, last_page: 1, meta })
})

tdPublicRoutes.get('/export.csv', async (c) => {
  const q = c.req.query()
  const dataset = String(q.dataset || 'latest').toLowerCase()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)

  if (dataset === 'timeseries') {
    const productKey = q.product_key || q.productKey
    if (!productKey) {
      return jsonError(c, 400, 'INVALID_REQUEST', 'product_key is required for timeseries CSV export.')
    }
    const rows = await queryTdTimeseries(c.env.DB, {
      bank: q.bank,
      productKey,
      termMonths: q.term_months,
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

  const rows = await queryLatestTdRates(c.env.DB, {
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
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
  })
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="td-latest.csv"')
  setCsvMetaHeaders(c, meta)
  return c.body(toCsv(rows as Array<Record<string, unknown>>))
})

function csvEscape(value: unknown): string {
  if (value == null) return ''
  const raw = String(value)
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`
  return raw
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','))
  }
  return lines.join('\n')
}
