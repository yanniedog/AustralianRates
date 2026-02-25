import { Hono } from 'hono'
import { DEFAULT_PUBLIC_CACHE_SECONDS } from '../constants'
import {
  getSavingsFilters,
  getSavingsQualityDiagnostics,
  getSavingsStaleness,
  queryLatestAllSavingsRates,
  queryLatestSavingsRates,
  querySavingsForExport,
  querySavingsRatesPaginated,
  querySavingsTimeseries,
} from '../db/savings-queries'
import { getHistoricalPullDetail, startHistoricalPullRun } from '../pipeline/client-historical'
import { handlePublicTriggerRun } from './trigger-run'
import type { AppContext } from '../types'
import { jsonError, withPublicCache } from '../utils/http'
import { buildListMeta, setCsvMetaHeaders, sourceMixFromRows } from '../utils/response-meta'
import { parseSourceMode } from '../utils/source-mode'
import { handlePublicRunStatus } from './public-run-status'

export const savingsPublicRoutes = new Hono<AppContext>()

function parseHistoricalRequest(body: Record<string, unknown>): { enabled: boolean; startDate?: string; endDate?: string } {
  const historicalBody = body.historical
  const nested = historicalBody && typeof historicalBody === 'object' ? (historicalBody as Record<string, unknown>) : {}
  const enabledRaw = nested.enabled ?? body.include_historical ?? body.historical_pull ?? false
  const enabled = String(enabledRaw).toLowerCase() === 'true' || enabledRaw === true || enabledRaw === 1 || enabledRaw === '1'
  const startDate = String(nested.start_date ?? nested.startDate ?? body.start_date ?? body.startDate ?? '').trim()
  const endDate = String(nested.end_date ?? nested.endDate ?? body.end_date ?? body.endDate ?? '').trim()
  return {
    enabled,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  }
}

savingsPublicRoutes.use('*', async (c, next) => {
  withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS)
  await next()
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

savingsPublicRoutes.post('/trigger-run', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const historicalReq = parseHistoricalRequest(body)
  if (historicalReq.enabled && (!historicalReq.startDate || !historicalReq.endDate)) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'Historical pull requires start_date and end_date.')
  }

  const result = await handlePublicTriggerRun(c.env, 'savings')
  if (!historicalReq.enabled || !result.ok) {
    return c.json(result.body, result.status)
  }
  const historical = await startHistoricalPullRun(c.env, {
    triggerSource: 'public',
    requestedBy: 'public_trigger_run',
    startDate: historicalReq.startDate || '',
    endDate: historicalReq.endDate || '',
  })
  if (!historical.ok) {
    return c.json(
      {
        ok: false,
        reason: 'historical_pull_failed',
        message: historical.message,
        details: historical.details,
        daily_result: result.body.result,
      },
      historical.status,
    )
  }
  return c.json(
    {
      ...result.body,
      historical_run_id: historical.value.run_id,
      worker_command: historical.value.worker_command,
      historical_range_days: historical.value.range_days,
    },
    result.status,
  )
})

savingsPublicRoutes.get('/run-status/:runId', handlePublicRunStatus)

savingsPublicRoutes.post('/historical/pull', async (c) => {
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
  const filters = await getSavingsFilters(c.env.DB)
  return c.json({ ok: true, filters })
})

savingsPublicRoutes.get('/rates', async (c) => {
  const q = c.req.query()
  const dir = String(q.dir || 'desc').toLowerCase()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)

  const result = await querySavingsRatesPaginated(c.env.DB, {
    page: Number(q.page || 1),
    size: Number(q.size || 50),
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
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

savingsPublicRoutes.get('/latest', async (c) => {
  const q = c.req.query()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const orderByRaw = String(q.order_by || q.orderBy || 'default').toLowerCase()
  const orderBy = orderByRaw === 'rate_asc' || orderByRaw === 'rate_desc' ? orderByRaw : 'default'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const limit = Number(q.limit || 200)

  const rows = await queryLatestSavingsRates(c.env.DB, {
    bank: q.bank,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
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

savingsPublicRoutes.get('/latest-all', async (c) => {
  const q = c.req.query()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const orderByRaw = String(q.order_by || q.orderBy || 'default').toLowerCase()
  const orderBy = orderByRaw === 'rate_asc' || orderByRaw === 'rate_desc' ? orderByRaw : 'default'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const limit = Number(q.limit || 200)

  const rows = await queryLatestAllSavingsRates(c.env.DB, {
    bank: q.bank,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
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

savingsPublicRoutes.get('/timeseries', async (c) => {
  const q = c.req.query()
  const productKey = q.product_key || q.productKey
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)
  const limit = Number(q.limit || 1000)
  if (!productKey) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'product_key is required for timeseries queries.')
  }

  const rows = await querySavingsTimeseries(c.env.DB, {
    bank: q.bank,
    productKey,
    accountType: q.account_type,
    rateType: q.rate_type,
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

savingsPublicRoutes.get('/export', async (c) => {
  const q = c.req.query()
  const format = String(q.format || 'json').toLowerCase()
  if (format !== 'csv' && format !== 'json') {
    return jsonError(c, 400, 'INVALID_FORMAT', 'format must be csv or json')
  }
  const dir = String(q.dir || 'desc').toLowerCase()
  const modeRaw = String(q.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const sourceMode = parseSourceMode(q.source_mode, q.include_manual)

  const { data, total, source_mix } = await querySavingsForExport(c.env.DB, {
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
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
    c.header('Content-Disposition', 'attachment; filename="savings-export.csv"')
    setCsvMetaHeaders(c, meta)
    return c.body(toCsv(data as Array<Record<string, unknown>>))
  }
  c.header('Content-Type', 'application/json; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="savings-export.json"')
  return c.json({ data, total, last_page: 1, meta })
})

savingsPublicRoutes.get('/export.csv', async (c) => {
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
    const rows = await querySavingsTimeseries(c.env.DB, {
      bank: q.bank,
      productKey,
      accountType: q.account_type,
      rateType: q.rate_type,
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
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
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
  c.header('Content-Disposition', 'attachment; filename="savings-latest.csv"')
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
