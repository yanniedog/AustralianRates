import { SAVINGS_ACCOUNT_TYPES, SAVINGS_RATE_TYPES } from '../constants'
import { runSourceWhereClause, type SourceMode } from '../utils/source-mode'

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

export async function getSavingsFilters(db: D1Database) {
  const [banks, accountTypes, rateTypes, depositTiers] = await Promise.all([
    db.prepare('SELECT DISTINCT bank_name AS value FROM historical_savings_rates ORDER BY bank_name ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT account_type AS value FROM historical_savings_rates ORDER BY account_type ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT rate_type AS value FROM historical_savings_rates ORDER BY rate_type ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT deposit_tier AS value FROM historical_savings_rates ORDER BY deposit_tier ASC').all<{ value: string }>(),
  ])

  const fallback = (vals: string[], fb: string[]) => (vals.length > 0 ? vals : fb)

  return {
    banks: rows(banks).map((x) => x.value),
    account_types: fallback(rows(accountTypes).map((x) => x.value), SAVINGS_ACCOUNT_TYPES),
    rate_types: fallback(rows(rateTypes).map((x) => x.value), SAVINGS_RATE_TYPES),
    deposit_tiers: rows(depositTiers).map((x) => x.value),
  }
}

type SavingsPaginatedFilters = {
  page?: number
  size?: number
  startDate?: string
  endDate?: string
  bank?: string
  accountType?: string
  rateType?: string
  depositTier?: string
  sort?: string
  dir?: 'asc' | 'desc'
  sourceMode?: SourceMode
}

const SORT_COLUMNS: Record<string, string> = {
  collection_date: 'h.collection_date',
  bank_name: 'h.bank_name',
  product_name: 'h.product_name',
  account_type: 'h.account_type',
  rate_type: 'h.rate_type',
  interest_rate: 'h.interest_rate',
  deposit_tier: 'h.deposit_tier',
  monthly_fee: 'h.monthly_fee',
  parsed_at: 'h.parsed_at',
  run_source: 'h.run_source',
}

function buildWhere(filters: SavingsPaginatedFilters): { clause: string; binds: Array<string | number> } {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  where.push('h.confidence_score >= ?')
  binds.push(MIN_CONFIDENCE)

  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))
  if (filters.bank) { where.push('h.bank_name = ?'); binds.push(filters.bank) }
  if (filters.accountType) { where.push('h.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('h.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('h.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.startDate) { where.push('h.collection_date >= ?'); binds.push(filters.startDate) }
  if (filters.endDate) { where.push('h.collection_date <= ?'); binds.push(filters.endDate) }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', binds }
}

export async function querySavingsRatesPaginated(db: D1Database, filters: SavingsPaginatedFilters) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`

  const page = Math.max(1, Math.floor(Number(filters.page) || 1))
  const size = Math.min(500, Math.max(1, Math.floor(Number(filters.size) || 50)))
  const offset = (page - 1) * size

  const countSql = `SELECT COUNT(*) AS total FROM historical_savings_rates h ${whereClause}`
  const sourceSql = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_savings_rates h
    ${whereClause}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.account_type, h.rate_type, h.interest_rate, h.deposit_tier,
      h.min_balance, h.max_balance, h.conditions, h.monthly_fee,
      h.source_url, h.data_quality_flag, h.confidence_score,
      h.parsed_at, h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key
    FROM historical_savings_rates h
    ${whereClause} ${orderClause}
    LIMIT ? OFFSET ?
  `

  const [countResult, sourceResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(sourceSql).bind(...binds).all<{ run_source: string; n: number }>(),
    db.prepare(dataSql).bind(...binds, size, offset).all<Record<string, unknown>>(),
  ])

  const total = Number(countResult?.total ?? 0)
  let scheduled = 0
  let manual = 0
  for (const row of rows(sourceResult)) {
    if (String(row.run_source) === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }
  return {
    last_page: Math.max(1, Math.ceil(total / size)),
    total,
    data: rows(dataResult),
    source_mix: { scheduled, manual },
  }
}

export async function queryLatestSavingsRates(db: D1Database, filters: {
  bank?: string; accountType?: string; rateType?: string; depositTier?: string
  sourceMode?: SourceMode
  limit?: number; orderBy?: 'default' | 'rate_asc' | 'rate_desc'
}) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('v.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  where.push('v.confidence_score >= ?')
  binds.push(MIN_CONFIDENCE)

  if (filters.bank) { where.push('v.bank_name = ?'); binds.push(filters.bank) }
  if (filters.accountType) { where.push('v.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('v.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('v.deposit_tier = ?'); binds.push(filters.depositTier) }
  where.push(runSourceWhereClause('v.run_source', filters.sourceMode ?? 'all'))

  const orderMap: Record<string, string> = {
    default: 'v.collection_date DESC, v.bank_name ASC, v.product_name ASC',
    rate_asc: 'v.interest_rate ASC, v.bank_name ASC',
    rate_desc: 'v.interest_rate DESC, v.bank_name ASC',
  }
  const limit = safeLimit(filters.limit, 200, 1000)
  binds.push(limit)

  const sql = `
    SELECT v.*, v.product_key
    FROM vw_latest_savings_rates v
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${orderMap[filters.orderBy ?? 'default'] ?? orderMap.default}
    LIMIT ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result)
}

export async function querySavingsTimeseries(db: D1Database, input: {
  bank?: string; productKey?: string; accountType?: string; rateType?: string
  sourceMode?: SourceMode
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
  if (input.accountType) { where.push('t.account_type = ?'); binds.push(input.accountType) }
  if (input.rateType) { where.push('t.rate_type = ?'); binds.push(input.rateType) }
  where.push(runSourceWhereClause('t.run_source', input.sourceMode ?? 'all'))
  if (input.startDate) { where.push('t.collection_date >= ?'); binds.push(input.startDate) }
  if (input.endDate) { where.push('t.collection_date <= ?'); binds.push(input.endDate) }

  const limit = safeLimit(input.limit, 500, 5000)
  binds.push(limit)

  const sql = `
    SELECT t.*
    FROM vw_savings_timeseries t
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.collection_date ASC
    LIMIT ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result)
}

export async function querySavingsForExport(db: D1Database, filters: SavingsPaginatedFilters, maxRows = 10000) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.min(maxRows, Math.max(1, Math.floor(Number(maxRows))))

  const countSql = `SELECT COUNT(*) AS total FROM historical_savings_rates h ${whereClause}`
  const sourceSql = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_savings_rates h
    ${whereClause}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.account_type, h.rate_type, h.interest_rate, h.deposit_tier,
      h.min_balance, h.max_balance, h.conditions, h.monthly_fee,
      h.source_url, h.data_quality_flag, h.confidence_score,
      h.parsed_at, h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key
    FROM historical_savings_rates h
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC
    LIMIT ?
  `

  const [countResult, sourceResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(sourceSql).bind(...binds).all<{ run_source: string; n: number }>(),
    db.prepare(dataSql).bind(...binds, limit).all<Record<string, unknown>>(),
  ])

  let scheduled = 0
  let manual = 0
  for (const row of rows(sourceResult)) {
    if (String(row.run_source) === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }
  return {
    data: rows(dataResult),
    total: Number(countResult?.total ?? 0),
    source_mix: { scheduled, manual },
  }
}

export async function getSavingsStaleness(db: D1Database, staleHours = 48) {
  const result = await db
    .prepare(
      `SELECT
        bank_name,
        MAX(collection_date) AS latest_date,
        MAX(parsed_at) AS latest_parsed_at,
        COUNT(*) AS total_rows
       FROM historical_savings_rates
       GROUP BY bank_name
       ORDER BY bank_name ASC`,
    )
    .all<{ bank_name: string; latest_date: string; latest_parsed_at: string; total_rows: number }>()

  const now = Date.now()
  return rows(result).map((r) => {
    const parsedAt = new Date(r.latest_parsed_at).getTime()
    const ageMs = now - parsedAt
    const ageHours = Math.round(ageMs / (1000 * 60 * 60))
    return {
      bank_name: r.bank_name,
      latest_date: r.latest_date,
      latest_parsed_at: r.latest_parsed_at,
      total_rows: Number(r.total_rows),
      age_hours: ageHours,
      stale: ageHours > staleHours,
    }
  })
}

export async function getSavingsQualityDiagnostics(db: D1Database) {
  const [totals, byFlag, sourceMix] = await Promise.all([
    db
      .prepare(
        `SELECT
          COUNT(*) AS total_rows,
          SUM(CASE WHEN interest_rate BETWEEN ? AND ? THEN 1 ELSE 0 END) AS in_range_rows,
          SUM(CASE WHEN confidence_score >= ? THEN 1 ELSE 0 END) AS confidence_ok_rows
         FROM historical_savings_rates`,
      )
      .bind(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE, MIN_CONFIDENCE)
      .first<{ total_rows: number; in_range_rows: number; confidence_ok_rows: number }>(),
    db
      .prepare(
        `SELECT data_quality_flag, COUNT(*) AS n
         FROM historical_savings_rates
         GROUP BY data_quality_flag
         ORDER BY n DESC`,
      )
      .all<{ data_quality_flag: string; n: number }>(),
    db
      .prepare(
        `SELECT COALESCE(run_source, 'scheduled') AS run_source, COUNT(*) AS n
         FROM historical_savings_rates
         GROUP BY COALESCE(run_source, 'scheduled')`,
      )
      .all<{ run_source: string; n: number }>(),
  ])

  let scheduled = 0
  let manual = 0
  for (const row of rows(sourceMix)) {
    if (String(row.run_source) === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }

  return {
    total_rows: Number(totals?.total_rows ?? 0),
    in_range_rows: Number(totals?.in_range_rows ?? 0),
    confidence_ok_rows: Number(totals?.confidence_ok_rows ?? 0),
    source_mix: { scheduled, manual },
    by_flag: rows(byFlag).map((x) => ({
      data_quality_flag: x.data_quality_flag,
      count: Number(x.n),
    })),
  }
}
