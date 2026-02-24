import { INTEREST_PAYMENTS } from '../constants'

const MIN_PUBLIC_RATE = 0
const MAX_PUBLIC_RATE = 15
const MIN_CONFIDENCE = 0.85

function safeLimit(limit: number | undefined, fallback: number, max = 500): number {
  if (!Number.isFinite(limit)) return fallback
  return Math.min(max, Math.max(1, Math.floor(limit as number)))
}

function rows<T>(result: D1Result<T>): T[] {
  return result.results ?? []
}

export async function getTdFilters(db: D1Database) {
  const [banks, termMonths, depositTiers, interestPayments] = await Promise.all([
    db.prepare('SELECT DISTINCT bank_name AS value FROM historical_term_deposit_rates ORDER BY bank_name ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT term_months AS value FROM historical_term_deposit_rates ORDER BY CAST(term_months AS INTEGER) ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT deposit_tier AS value FROM historical_term_deposit_rates ORDER BY deposit_tier ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT interest_payment AS value FROM historical_term_deposit_rates ORDER BY interest_payment ASC').all<{ value: string }>(),
  ])

  const fallback = (vals: string[], fb: string[]) => (vals.length > 0 ? vals : fb)

  return {
    banks: rows(banks).map((x) => x.value),
    term_months: rows(termMonths).map((x) => x.value),
    deposit_tiers: rows(depositTiers).map((x) => x.value),
    interest_payments: fallback(rows(interestPayments).map((x) => x.value), INTEREST_PAYMENTS),
  }
}

type TdPaginatedFilters = {
  page?: number
  size?: number
  startDate?: string
  endDate?: string
  bank?: string
  termMonths?: string
  depositTier?: string
  interestPayment?: string
  sort?: string
  dir?: 'asc' | 'desc'
  includeManual?: boolean
}

const SORT_COLUMNS: Record<string, string> = {
  collection_date: 'h.collection_date',
  bank_name: 'h.bank_name',
  product_name: 'h.product_name',
  term_months: 'h.term_months',
  interest_rate: 'h.interest_rate',
  deposit_tier: 'h.deposit_tier',
  interest_payment: 'h.interest_payment',
  parsed_at: 'h.parsed_at',
  run_source: 'h.run_source',
}

function buildWhere(filters: TdPaginatedFilters): { clause: string; binds: Array<string | number> } {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  where.push('h.confidence_score >= ?')
  binds.push(MIN_CONFIDENCE)

  if (!filters.includeManual) where.push("(h.run_source IS NULL OR h.run_source != 'manual')")
  if (filters.bank) { where.push('h.bank_name = ?'); binds.push(filters.bank) }
  if (filters.termMonths) { where.push('CAST(h.term_months AS TEXT) = ?'); binds.push(filters.termMonths) }
  if (filters.depositTier) { where.push('h.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.interestPayment) { where.push('h.interest_payment = ?'); binds.push(filters.interestPayment) }
  if (filters.startDate) { where.push('h.collection_date >= ?'); binds.push(filters.startDate) }
  if (filters.endDate) { where.push('h.collection_date <= ?'); binds.push(filters.endDate) }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', binds }
}

export async function queryTdRatesPaginated(db: D1Database, filters: TdPaginatedFilters) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`

  const page = Math.max(1, Math.floor(Number(filters.page) || 1))
  const size = Math.min(500, Math.max(1, Math.floor(Number(filters.size) || 50)))
  const offset = (page - 1) * size

  const countSql = `SELECT COUNT(*) AS total FROM historical_term_deposit_rates h ${whereClause}`
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.term_months, h.interest_rate, h.deposit_tier,
      h.min_deposit, h.max_deposit, h.interest_payment,
      h.source_url, h.data_quality_flag, h.confidence_score,
      h.parsed_at, h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier AS product_key
    FROM historical_term_deposit_rates h
    ${whereClause} ${orderClause}
    LIMIT ? OFFSET ?
  `

  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(dataSql).bind(...binds, size, offset).all<Record<string, unknown>>(),
  ])

  const total = Number(countResult?.total ?? 0)
  return { last_page: Math.max(1, Math.ceil(total / size)), total, data: rows(dataResult) }
}

export async function queryLatestTdRates(db: D1Database, filters: {
  bank?: string; termMonths?: string; depositTier?: string; interestPayment?: string
  limit?: number; orderBy?: 'default' | 'rate_asc' | 'rate_desc'
}) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('v.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  where.push('v.confidence_score >= ?')
  binds.push(MIN_CONFIDENCE)

  if (filters.bank) { where.push('v.bank_name = ?'); binds.push(filters.bank) }
  if (filters.termMonths) { where.push('CAST(v.term_months AS TEXT) = ?'); binds.push(filters.termMonths) }
  if (filters.depositTier) { where.push('v.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.interestPayment) { where.push('v.interest_payment = ?'); binds.push(filters.interestPayment) }

  const orderMap: Record<string, string> = {
    default: 'v.collection_date DESC, v.bank_name ASC, v.product_name ASC',
    rate_asc: 'v.interest_rate ASC, v.bank_name ASC',
    rate_desc: 'v.interest_rate DESC, v.bank_name ASC',
  }
  const limit = safeLimit(filters.limit, 200, 1000)
  binds.push(limit)

  const sql = `
    SELECT v.*, v.product_key
    FROM vw_latest_td_rates v
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${orderMap[filters.orderBy ?? 'default'] ?? orderMap.default}
    LIMIT ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result)
}

export async function queryTdTimeseries(db: D1Database, input: {
  bank?: string; productKey?: string; termMonths?: string
  startDate?: string; endDate?: string; limit?: number
}) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('t.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  where.push('t.confidence_score >= ?')
  binds.push(MIN_CONFIDENCE)

  if (input.bank) { where.push('t.bank_name = ?'); binds.push(input.bank) }
  if (input.productKey) { where.push('t.product_key = ?'); binds.push(input.productKey) }
  if (input.termMonths) { where.push('CAST(t.term_months AS TEXT) = ?'); binds.push(input.termMonths) }
  if (input.startDate) { where.push('t.collection_date >= ?'); binds.push(input.startDate) }
  if (input.endDate) { where.push('t.collection_date <= ?'); binds.push(input.endDate) }

  const limit = safeLimit(input.limit, 500, 5000)
  binds.push(limit)

  const sql = `
    SELECT t.*
    FROM vw_td_timeseries t
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.collection_date ASC
    LIMIT ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result)
}

export async function queryTdForExport(db: D1Database, filters: TdPaginatedFilters, maxRows = 10000) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.min(maxRows, Math.max(1, Math.floor(Number(maxRows))))

  const countSql = `SELECT COUNT(*) AS total FROM historical_term_deposit_rates h ${whereClause}`
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.term_months, h.interest_rate, h.deposit_tier,
      h.min_deposit, h.max_deposit, h.interest_payment,
      h.source_url, h.data_quality_flag, h.confidence_score,
      h.parsed_at, h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier AS product_key
    FROM historical_term_deposit_rates h
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC
    LIMIT ?
  `

  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(dataSql).bind(...binds, limit).all<Record<string, unknown>>(),
  ])

  return { data: rows(dataResult), total: Number(countResult?.total ?? 0) }
}
