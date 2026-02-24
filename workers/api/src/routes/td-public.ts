import { Hono } from 'hono'
import { DEFAULT_PUBLIC_CACHE_SECONDS } from '../constants'
import {
  getTdFilters,
  queryLatestTdRates,
  queryTdForExport,
  queryTdRatesPaginated,
  queryTdTimeseries,
} from '../db/td-queries'
import type { AppContext } from '../types'
import { jsonError, withPublicCache } from '../utils/http'

export const tdPublicRoutes = new Hono<AppContext>()

tdPublicRoutes.use('*', async (c, next) => {
  withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS)
  await next()
})

tdPublicRoutes.get('/health', (c) => {
  withPublicCache(c, 30)
  return c.json({ ok: true, service: 'australianrates-term-deposits' })
})

tdPublicRoutes.get('/filters', async (c) => {
  const filters = await getTdFilters(c.env.DB)
  return c.json({ ok: true, filters })
})

tdPublicRoutes.get('/rates', async (c) => {
  const q = c.req.query()
  const dir = String(q.dir || 'desc').toLowerCase()
  const includeManual = q.include_manual === 'true' || q.include_manual === '1'

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
    includeManual,
  })
  return c.json(result)
})

tdPublicRoutes.get('/latest', async (c) => {
  const q = c.req.query()
  const orderByRaw = String(q.order_by || q.orderBy || 'default').toLowerCase()
  const orderBy = orderByRaw === 'rate_asc' || orderByRaw === 'rate_desc' ? orderByRaw : 'default'

  const rows = await queryLatestTdRates(c.env.DB, {
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
    limit: Number(q.limit || 200),
    orderBy,
  })
  return c.json({ ok: true, count: rows.length, rows })
})

tdPublicRoutes.get('/timeseries', async (c) => {
  const q = c.req.query()
  const productKey = q.product_key || q.productKey
  if (!productKey) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'product_key is required for timeseries queries.')
  }

  const rows = await queryTdTimeseries(c.env.DB, {
    bank: q.bank,
    productKey,
    termMonths: q.term_months,
    startDate: q.start_date,
    endDate: q.end_date,
    limit: Number(q.limit || 1000),
  })
  return c.json({ ok: true, count: rows.length, rows })
})

tdPublicRoutes.get('/export', async (c) => {
  const q = c.req.query()
  const format = String(q.format || 'json').toLowerCase()
  if (format !== 'csv' && format !== 'json') {
    return jsonError(c, 400, 'INVALID_FORMAT', 'format must be csv or json')
  }
  const dir = String(q.dir || 'desc').toLowerCase()
  const includeManual = q.include_manual === 'true' || q.include_manual === '1'

  const { data, total } = await queryTdForExport(c.env.DB, {
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
    sort: q.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : 'desc',
    includeManual,
  })

  if (format === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="td-export.csv"')
    return c.body(toCsv(data as Array<Record<string, unknown>>))
  }
  c.header('Content-Type', 'application/json; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="td-export.json"')
  return c.json({ data, total, last_page: 1 })
})

tdPublicRoutes.get('/export.csv', async (c) => {
  const q = c.req.query()
  const dataset = String(q.dataset || 'latest').toLowerCase()

  if (dataset === 'timeseries') {
    const productKey = q.product_key || q.productKey
    if (!productKey) {
      return jsonError(c, 400, 'INVALID_REQUEST', 'product_key is required for timeseries CSV export.')
    }
    const rows = await queryTdTimeseries(c.env.DB, {
      bank: q.bank,
      productKey,
      termMonths: q.term_months,
      startDate: q.start_date,
      endDate: q.end_date,
      limit: Number(q.limit || 5000),
    })
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="td-timeseries.csv"')
    return c.body(toCsv(rows as Array<Record<string, unknown>>))
  }

  const rows = await queryLatestTdRates(c.env.DB, {
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
    limit: Number(q.limit || 1000),
  })
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="td-latest.csv"')
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
