import { Hono } from 'hono'
import { DEFAULT_PUBLIC_CACHE_SECONDS } from '../constants'
import {
  getSavingsFilters,
  queryLatestSavingsRates,
  querySavingsForExport,
  querySavingsRatesPaginated,
  querySavingsTimeseries,
} from '../db/savings-queries'
import type { AppContext } from '../types'
import { jsonError, withPublicCache } from '../utils/http'

export const savingsPublicRoutes = new Hono<AppContext>()

savingsPublicRoutes.use('*', async (c, next) => {
  withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS)
  await next()
})

savingsPublicRoutes.get('/health', (c) => {
  withPublicCache(c, 30)
  return c.json({ ok: true, service: 'australianrates-savings' })
})

savingsPublicRoutes.get('/filters', async (c) => {
  const filters = await getSavingsFilters(c.env.DB)
  return c.json({ ok: true, filters })
})

savingsPublicRoutes.get('/rates', async (c) => {
  const q = c.req.query()
  const dir = String(q.dir || 'desc').toLowerCase()
  const includeManual = q.include_manual === 'true' || q.include_manual === '1'

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
    includeManual,
  })
  return c.json(result)
})

savingsPublicRoutes.get('/latest', async (c) => {
  const q = c.req.query()
  const orderByRaw = String(q.order_by || q.orderBy || 'default').toLowerCase()
  const orderBy = orderByRaw === 'rate_asc' || orderByRaw === 'rate_desc' ? orderByRaw : 'default'

  const rows = await queryLatestSavingsRates(c.env.DB, {
    bank: q.bank,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    limit: Number(q.limit || 200),
    orderBy,
  })
  return c.json({ ok: true, count: rows.length, rows })
})

savingsPublicRoutes.get('/timeseries', async (c) => {
  const q = c.req.query()
  const productKey = q.product_key || q.productKey
  if (!productKey) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'product_key is required for timeseries queries.')
  }

  const rows = await querySavingsTimeseries(c.env.DB, {
    bank: q.bank,
    productKey,
    accountType: q.account_type,
    rateType: q.rate_type,
    startDate: q.start_date,
    endDate: q.end_date,
    limit: Number(q.limit || 1000),
  })
  return c.json({ ok: true, count: rows.length, rows })
})

savingsPublicRoutes.get('/export', async (c) => {
  const q = c.req.query()
  const format = String(q.format || 'json').toLowerCase()
  if (format !== 'csv' && format !== 'json') {
    return jsonError(c, 400, 'INVALID_FORMAT', 'format must be csv or json')
  }
  const dir = String(q.dir || 'desc').toLowerCase()
  const includeManual = q.include_manual === 'true' || q.include_manual === '1'

  const { data, total } = await querySavingsForExport(c.env.DB, {
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    sort: q.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : 'desc',
    includeManual,
  })

  if (format === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="savings-export.csv"')
    return c.body(toCsv(data as Array<Record<string, unknown>>))
  }
  c.header('Content-Type', 'application/json; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="savings-export.json"')
  return c.json({ data, total, last_page: 1 })
})

savingsPublicRoutes.get('/export.csv', async (c) => {
  const q = c.req.query()
  const dataset = String(q.dataset || 'latest').toLowerCase()

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
      startDate: q.start_date,
      endDate: q.end_date,
      limit: Number(q.limit || 5000),
    })
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="savings-timeseries.csv"')
    return c.body(toCsv(rows as Array<Record<string, unknown>>))
  }

  const rows = await queryLatestSavingsRates(c.env.DB, {
    bank: q.bank,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    limit: Number(q.limit || 1000),
  })
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="savings-latest.csv"')
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
