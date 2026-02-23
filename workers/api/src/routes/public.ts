import { Hono } from 'hono'
import { API_BASE_PATH, DEFAULT_PUBLIC_CACHE_SECONDS, MELBOURNE_TIMEZONE } from '../constants'
import { getFilters, getLenderStaleness, getQualityDiagnostics, queryLatestRates, queryRatesForExport, queryRatesPaginated, queryTimeseries } from '../db/queries'
import { getLastManualRunStartedAt } from '../db/run-reports'
import { triggerDailyRun } from '../pipeline/bootstrap-jobs'
import type { AppContext } from '../types'
import { jsonError, withPublicCache } from '../utils/http'
import { log } from '../utils/logger'
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

publicRoutes.get('/staleness', async (c) => {
  withPublicCache(c, 60)
  const staleness = await getLenderStaleness(c.env.DB)
  const staleLenders = staleness.filter((l) => l.stale)
  return c.json({
    ok: true,
    stale_count: staleLenders.length,
    lenders: staleness,
  })
})

publicRoutes.post('/trigger-run', async (c) => {
  const DEFAULT_COOLDOWN_SECONDS = 60 // 1 minute lockout between manual runs
  const cooldownSeconds = parseIntegerEnv(c.env.MANUAL_RUN_COOLDOWN_SECONDS, DEFAULT_COOLDOWN_SECONDS)
  const cooldownMs = cooldownSeconds * 1000

  const lastStartedAt = await getLastManualRunStartedAt(c.env.DB)
  if (lastStartedAt) {
    const elapsed = Date.now() - Date.parse(lastStartedAt)
    if (elapsed < cooldownMs) {
      const retryAfter = Math.ceil((cooldownMs - elapsed) / 1000)
      return c.json(
        { ok: false, reason: 'rate_limited', retry_after_seconds: retryAfter },
        429,
      )
    }
  }

  log.info('api', 'Public manual run triggered')
  const result = await triggerDailyRun(c.env, { source: 'manual', force: true })
  return c.json({ ok: true, result })
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

publicRoutes.get('/rates', async (c) => {
  const query = c.req.query()
  const dir = String(query.dir || 'desc').toLowerCase()
  const includeManual = query.include_manual === 'true' || query.include_manual === '1'

  const result = await queryRatesPaginated(c.env.DB, {
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
    sort: query.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : 'desc',
    includeManual,
  })

  return c.json(result)
})

publicRoutes.get('/export', async (c) => {
  const query = c.req.query()
  const format = String(query.format || 'json').toLowerCase()
  if (format !== 'csv' && format !== 'json') {
    return jsonError(c, 400, 'INVALID_FORMAT', 'format must be csv or json')
  }
  const dir = String(query.dir || 'desc').toLowerCase()
  const includeManual = query.include_manual === 'true' || query.include_manual === '1'

  const { data, total } = await queryRatesForExport(c.env.DB, {
    startDate: query.start_date,
    endDate: query.end_date,
    bank: query.bank,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    sort: query.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : 'desc',
    includeManual,
    limit: 10000,
  })

  if (format === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="rates-export.csv"')
    return c.body(toCsv(data as Array<Record<string, unknown>>))
  }

  c.header('Content-Type', 'application/json; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="rates-export.json"')
  return c.json({ data, total, last_page: 1 })
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