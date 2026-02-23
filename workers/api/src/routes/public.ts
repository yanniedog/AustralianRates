import { Hono } from 'hono'
import { API_BASE_PATH, DEFAULT_PUBLIC_CACHE_SECONDS, MELBOURNE_TIMEZONE } from '../constants'
import { getFilters, getQualityDiagnostics, queryLatestRates, queryTimeseries } from '../db/queries'
import type { AppContext } from '../types'
import { jsonError, withPublicCache } from '../utils/http'
import type { LogLevel } from '../utils/logger'
import { getLogStats, queryLogs } from '../utils/logger'
import { getMelbourneNowParts, parseIntegerEnv } from '../utils/time'

export const publicRoutes = new Hono<AppContext>()

publicRoutes.use('*', async (c, next) => {
  withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS)
  await next()
})

publicRoutes.get('/health', async (c) => {
  withPublicCache(c, 30)

  const melbourne = getMelbourneNowParts(new Date(), c.env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE)
  const targetHour = parseIntegerEnv(c.env.MELBOURNE_TARGET_HOUR, 6)

  return c.json({
    ok: true,
    service: 'australianrates-api',
    phase: 'phase1',
    version: c.env.WORKER_VERSION || 'dev',
    api_base_path: c.env.PUBLIC_API_BASE_PATH || API_BASE_PATH,
    melbourne,
    scheduled_target_hour: targetHour,
    features: {
      prospective: String(c.env.FEATURE_PROSPECTIVE_ENABLED || 'true').toLowerCase() === 'true',
      backfill: String(c.env.FEATURE_BACKFILL_ENABLED || 'true').toLowerCase() === 'true',
    },
    bindings: {
      db: Boolean(c.env.DB),
      raw_bucket: Boolean(c.env.RAW_BUCKET),
      ingest_queue: Boolean(c.env.INGEST_QUEUE),
      run_lock_do: Boolean(c.env.RUN_LOCK_DO),
    },
  })
})

publicRoutes.get('/filters', async (c) => {
  const filters = await getFilters(c.env.DB)
  return c.json({
    ok: true,
    filters,
  })
})

publicRoutes.get('/quality/diagnostics', async (c) => {
  const diagnostics = await getQualityDiagnostics(c.env.DB)
  return c.json({
    ok: true,
    diagnostics,
  })
})

publicRoutes.get('/latest', async (c) => {
  const query = c.req.query()
  const limit = Number(query.limit || 200)
  const modeRaw = String(query.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'
  const orderByRaw = String(query.order_by || query.orderBy || 'default').toLowerCase()
  const orderBy = orderByRaw === 'rate_asc' || orderByRaw === 'rate_desc' ? orderByRaw : 'default'

  const rows = await queryLatestRates(c.env.DB, {
    bank: query.bank,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    mode,
    limit,
    orderBy,
  })

  return c.json({
    ok: true,
    count: rows.length,
    rows,
  })
})

publicRoutes.get('/timeseries', async (c) => {
  const query = c.req.query()
  const productKey = query.product_key || query.productKey
  const modeRaw = String(query.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'

  if (!productKey) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'product_key is required for timeseries queries.')
  }

  const rows = await queryTimeseries(c.env.DB, {
    bank: query.bank,
    productKey,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    featureSet: query.feature_set,
    mode,
    startDate: query.start_date,
    endDate: query.end_date,
    limit: Number(query.limit || 1000),
  })

  return c.json({
    ok: true,
    count: rows.length,
    rows,
  })
})

publicRoutes.get('/logs/stats', async (c) => {
  withPublicCache(c, 30)
  const stats = await getLogStats(c.env.DB)
  return c.json({ ok: true, ...stats })
})

publicRoutes.get('/logs', async (c) => {
  withPublicCache(c, 15)
  const query = c.req.query()
  const level = query.level as LogLevel | undefined
  const source = query.source
  const limit = Number(query.limit || 5000)
  const offset = Number(query.offset || 0)
  const format = String(query.format || 'text').toLowerCase()

  const { entries, total } = await queryLogs(c.env.DB, { level, source, limit, offset })

  if (format === 'json') {
    return c.json({ ok: true, total, count: entries.length, entries })
  }

  const lines = entries.map((e) => {
    const parts = [
      String(e.ts ?? ''),
      `[${String(e.level ?? 'info').toUpperCase()}]`,
      `[${String(e.source ?? 'api')}]`,
      String(e.message ?? ''),
    ]
    if (e.run_id) parts.push(`run=${e.run_id}`)
    if (e.lender_code) parts.push(`lender=${e.lender_code}`)
    if (e.context) parts.push(String(e.context))
    return parts.join(' ')
  })

  c.header('Content-Type', 'text/plain; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="australianrates-log.txt"')
  return c.body(`# AustralianRates Global Log (${total} entries total, showing ${entries.length})\n# Downloaded at ${new Date().toISOString()}\n\n${lines.join('\n')}\n`)
})

function csvEscape(value: unknown): string {
  if (value == null) return ''
  const raw = String(value)
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return ''
  }
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','))
  }
  return lines.join('\n')
}

publicRoutes.get('/export.csv', async (c) => {
  const query = c.req.query()
  const dataset = String(query.dataset || 'latest').toLowerCase()
  const modeRaw = String(query.mode || 'all').toLowerCase()
  const mode = modeRaw === 'daily' || modeRaw === 'historical' ? modeRaw : 'all'

  if (dataset === 'timeseries') {
    const productKey = query.product_key || query.productKey
    if (!productKey) {
      return jsonError(c, 400, 'INVALID_REQUEST', 'product_key is required for timeseries CSV export.')
    }
    const rows = await queryTimeseries(c.env.DB, {
      bank: query.bank,
      productKey,
      securityPurpose: query.security_purpose,
      repaymentType: query.repayment_type,
      featureSet: query.feature_set,
      mode,
      startDate: query.start_date,
      endDate: query.end_date,
      limit: Number(query.limit || 5000),
    })
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="timeseries-${mode}.csv"`)
    return c.body(toCsv(rows as Array<Record<string, unknown>>))
  }

  const rows = await queryLatestRates(c.env.DB, {
    bank: query.bank,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    mode,
    limit: Number(query.limit || 1000),
  })

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="latest-${mode}.csv"`)
  return c.body(toCsv(rows as Array<Record<string, unknown>>))
})