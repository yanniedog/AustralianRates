import { INTEREST_PAYMENTS } from '../constants'
import { runSourceWhereClause, type SourceMode } from '../utils/source-mode'
import { presentCoreRowFields, presentTdRow } from '../utils/row-presentation'

const MIN_PUBLIC_RATE = 0
const MAX_PUBLIC_RATE = 15
const MIN_CONFIDENCE = 0.85
const MIN_CONFIDENCE_HISTORICAL = 0.65

function safeLimit(limit: number | undefined, fallback: number, max = 500): number {
  if (!Number.isFinite(limit)) return fallback
  return Math.min(max, Math.max(1, Math.floor(limit as number)))
}

function rows<T>(result: D1Result<T>): T[] {
  return result.results ?? []
}

function addBankWhere(
  where: string[],
  binds: Array<string | number>,
  column: string,
  bank?: string,
  banks?: string[],
) {
  const uniqueBanks = Array.from(new Set((banks ?? []).map((v) => String(v || '').trim()).filter(Boolean)))
  if (uniqueBanks.length > 0) {
    const placeholders = uniqueBanks.map(() => '?').join(', ')
    where.push(`${column} IN (${placeholders})`)
    for (const value of uniqueBanks) binds.push(value)
    return
  }

  if (bank) {
    where.push(`${column} = ?`)
    binds.push(bank)
  }
}

function addRateBoundsWhere(
  where: string[],
  binds: Array<string | number>,
  interestRateColumn: string,
  minRate?: number,
  maxRate?: number,
) {
  if (Number.isFinite(minRate)) {
    where.push(`${interestRateColumn} >= ?`)
    binds.push(Number(minRate))
  }
  if (Number.isFinite(maxRate)) {
    where.push(`${interestRateColumn} <= ?`)
    binds.push(Number(maxRate))
  }
}

export async function getTdFilters(db: D1Database) {
  const [banks, termMonths, depositTiers, interestPayments] = await Promise.all([
    db.prepare('SELECT DISTINCT bank_name AS value FROM historical_term_deposit_rates ORDER BY bank_name ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT term_months AS value FROM historical_term_deposit_rates ORDER BY CAST(term_months AS INTEGER) ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT deposit_tier AS value FROM historical_term_deposit_rates ORDER BY deposit_tier ASC').all<{ value: string }>(),
    db.prepare('SELECT DISTINCT interest_payment AS value FROM historical_term_deposit_rates ORDER BY interest_payment ASC').all<{ value: string }>(),
  ])

  const fallback = (vals: string[], fb: string[]) => (vals.length > 0 ? vals : fb)

  const termMonthsList = rows(termMonths).map((x) => x.value)
  const depositTiersList = rows(depositTiers).map((x) => x.value)
  const interestPaymentsList = fallback(rows(interestPayments).map((x) => x.value), INTEREST_PAYMENTS)

  const single_value_columns: string[] = []
  if (termMonthsList.length <= 1) single_value_columns.push('term_months')
  if (depositTiersList.length <= 1) single_value_columns.push('deposit_tier')
  if (interestPaymentsList.length <= 1) single_value_columns.push('interest_payment')

  return {
    banks: rows(banks).map((x) => x.value),
    term_months: termMonthsList,
    deposit_tiers: depositTiersList,
    interest_payments: interestPaymentsList,
    single_value_columns,
  }
}

type TdPaginatedFilters = {
  page?: number
  size?: number
  startDate?: string
  endDate?: string
  bank?: string
  banks?: string[]
  termMonths?: string
  depositTier?: string
  interestPayment?: string
  minRate?: number
  maxRate?: number
  includeRemoved?: boolean
  sort?: string
  dir?: 'asc' | 'desc'
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
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
  retrieved_at: 'h.parsed_at',
  found_at: 'first_retrieved_at',
  first_retrieved_at: 'first_retrieved_at',
  rate_confirmed_at: 'rate_confirmed_at',
  run_source: 'h.run_source',
  retrieval_type: 'h.retrieval_type',
  is_removed: 'is_removed',
  removed_at: 'removed_at',
  source_url: 'h.source_url',
  product_url: 'h.product_url',
  published_at: 'h.published_at',
  cdr_product_detail_json: 'h.cdr_product_detail_json',
}

function buildWhere(filters: TdPaginatedFilters): { clause: string; binds: Array<string | number> } {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', filters.minRate, filters.maxRate)
  if (filters.mode === 'daily') {
    where.push("h.retrieval_type != 'historical_scrape'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (filters.mode === 'historical') {
    where.push("h.retrieval_type = 'historical_scrape'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }

  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))
  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  if (filters.termMonths) { where.push('CAST(h.term_months AS TEXT) = ?'); binds.push(filters.termMonths) }
  if (filters.depositTier) { where.push('h.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.interestPayment) { where.push('h.interest_payment = ?'); binds.push(filters.interestPayment) }
  if (filters.startDate) { where.push('h.collection_date >= ?'); binds.push(filters.startDate) }
  if (filters.endDate) { where.push('h.collection_date <= ?'); binds.push(filters.endDate) }
  if (!filters.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', binds }
}

export async function queryTdRatesPaginated(db: D1Database, filters: TdPaginatedFilters) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`

  const page = Math.max(1, Math.floor(Number(filters.page) || 1))
  const size = Math.min(1000, Math.max(1, Math.floor(Number(filters.size) || 50)))
  const offset = (page - 1) * size

  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_term_deposit_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.term_months, h.interest_rate, h.deposit_tier,
      h.min_deposit, h.max_deposit, h.interest_payment,
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_json, h.data_quality_flag, h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.term_months, h.deposit_tier
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.term_months,
          h.deposit_tier,
          h.interest_payment,
          h.interest_rate,
          h.min_deposit,
          h.max_deposit
      ) AS rate_confirmed_at,
      h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier AS product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_term_deposit_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause} ${orderClause}
    LIMIT ? OFFSET ?
  `

  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(dataSql).bind(...binds, size, offset).all<Record<string, unknown>>(),
  ])

  const total = Number(countResult?.total ?? 0)
  let scheduled = 0
  let manual = 0
  for (const row of rows(dataResult)) {
    if (String((row as Record<string, unknown>).run_source ?? 'scheduled').toLowerCase() === 'manual') manual += 1
    else scheduled += 1
  }
  const data = rows(dataResult).map((row) => presentTdRow(row))

  return {
    last_page: Math.max(1, Math.ceil(total / size)),
    total,
    data,
    source_mix: { scheduled, manual },
  }
}

export async function queryLatestTdRates(db: D1Database, filters: {
  bank?: string; banks?: string[]; termMonths?: string; depositTier?: string; interestPayment?: string
  minRate?: number; maxRate?: number
  includeRemoved?: boolean
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
  limit?: number; orderBy?: 'default' | 'rate_asc' | 'rate_desc'
}) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('v.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'v.interest_rate', filters.minRate, filters.maxRate)
  if (filters.mode === 'daily') {
    where.push("v.retrieval_type != 'historical_scrape'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (filters.mode === 'historical') {
    where.push("v.retrieval_type = 'historical_scrape'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }

  addBankWhere(where, binds, 'v.bank_name', filters.bank, filters.banks)
  if (filters.termMonths) { where.push('CAST(v.term_months AS TEXT) = ?'); binds.push(filters.termMonths) }
  if (filters.depositTier) { where.push('v.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.interestPayment) { where.push('v.interest_payment = ?'); binds.push(filters.interestPayment) }
  if (!filters.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')
  where.push(runSourceWhereClause('v.run_source', filters.sourceMode ?? 'all'))

  const orderMap: Record<string, string> = {
    default: 'v.collection_date DESC, v.bank_name ASC, v.product_name ASC',
    rate_asc: 'v.interest_rate ASC, v.bank_name ASC',
    rate_desc: 'v.interest_rate DESC, v.bank_name ASC',
  }
  const limit = safeLimit(filters.limit, 200, 1000)
  binds.push(limit)

  const sql = `
    SELECT
      v.*,
      (
        SELECT MIN(h.parsed_at)
        FROM historical_term_deposit_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.term_months = v.term_months
          AND h.deposit_tier = v.deposit_tier
      ) AS first_retrieved_at,
      (
        SELECT MAX(h.parsed_at)
        FROM historical_term_deposit_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.term_months = v.term_months
          AND h.deposit_tier = v.deposit_tier
          AND h.interest_payment = v.interest_payment
          AND h.interest_rate = v.interest_rate
          AND (
            (h.min_deposit = v.min_deposit)
            OR (h.min_deposit IS NULL AND v.min_deposit IS NULL)
          )
          AND (
            (h.max_deposit = v.max_deposit)
            OR (h.max_deposit IS NULL AND v.max_deposit IS NULL)
          )
          AND h.data_quality_flag LIKE 'cdr_live%'
      ) AS rate_confirmed_at,
      v.product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM vw_latest_td_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${orderMap[filters.orderBy ?? 'default'] ?? orderMap.default}
    LIMIT ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result).map((row) => presentTdRow(row))
}

/** Count of current products matching the same filters as queryLatestTdRates. */
export async function queryLatestTdRatesCount(db: D1Database, filters: Parameters<typeof queryLatestTdRates>[1]): Promise<number> {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('v.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'v.interest_rate', filters.minRate, filters.maxRate)
  if (filters.mode === 'daily') {
    where.push("v.retrieval_type != 'historical_scrape'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (filters.mode === 'historical') {
    where.push("v.retrieval_type = 'historical_scrape'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }
  addBankWhere(where, binds, 'v.bank_name', filters.bank, filters.banks)
  if (filters.termMonths) { where.push('CAST(v.term_months AS TEXT) = ?'); binds.push(filters.termMonths) }
  if (filters.depositTier) { where.push('v.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.interestPayment) { where.push('v.interest_payment = ?'); binds.push(filters.interestPayment) }
  if (!filters.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')
  where.push(runSourceWhereClause('v.run_source', filters.sourceMode ?? 'all'))

  const countSql = `
    SELECT COUNT(*) AS n
    FROM vw_latest_td_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `
  const countResult = await db.prepare(countSql).bind(...binds).first<{ n: number }>()
  const n = countResult?.n ?? 0
  return Number(n)
}

export async function queryLatestAllTdRates(db: D1Database, filters: {
  bank?: string; banks?: string[]; termMonths?: string; depositTier?: string; interestPayment?: string
  minRate?: number; maxRate?: number
  includeRemoved?: boolean
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
  limit?: number; orderBy?: 'default' | 'rate_asc' | 'rate_desc'
}) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', filters.minRate, filters.maxRate)
  if (filters.mode === 'daily') {
    where.push("h.retrieval_type != 'historical_scrape'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (filters.mode === 'historical') {
    where.push("h.retrieval_type = 'historical_scrape'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }

  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  if (filters.termMonths) { where.push('CAST(h.term_months AS TEXT) = ?'); binds.push(filters.termMonths) }
  if (filters.depositTier) { where.push('h.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.interestPayment) { where.push('h.interest_payment = ?'); binds.push(filters.interestPayment) }
  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))

  const orderBy = filters.orderBy ?? 'default'
  const orderClause =
    orderBy === 'rate_asc'
      ? 'ranked.interest_rate ASC, ranked.bank_name ASC'
      : orderBy === 'rate_desc'
        ? 'ranked.interest_rate DESC, ranked.bank_name ASC'
        : 'ranked.collection_date DESC, ranked.bank_name ASC, ranked.product_name ASC'

  const limit = safeLimit(filters.limit, 200, 1000)
  binds.push(limit)

  const sql = `
    WITH ranked AS (
      SELECT
        h.bank_name,
        h.collection_date,
        h.product_id,
        h.product_name,
        h.term_months,
        h.interest_rate,
        h.deposit_tier,
        h.min_deposit,
        h.max_deposit,
        h.interest_payment,
        h.source_url,
        h.product_url,
        h.published_at,
        h.data_quality_flag,
        h.confidence_score,
        h.retrieval_type,
        h.parsed_at,
        MIN(h.parsed_at) OVER (
          PARTITION BY h.bank_name, h.product_id, h.term_months, h.deposit_tier
        ) AS first_retrieved_at,
        MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
          PARTITION BY
            h.bank_name,
            h.product_id,
            h.term_months,
            h.deposit_tier,
            h.interest_payment,
            h.interest_rate,
            h.min_deposit,
            h.max_deposit
        ) AS rate_confirmed_at,
        h.run_source,
        h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier AS product_key,
        ROW_NUMBER() OVER (
          PARTITION BY h.bank_name, h.product_id, h.term_months, h.deposit_tier
          ORDER BY h.collection_date DESC, h.parsed_at DESC
        ) AS row_num
      FROM historical_term_deposit_rates h
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    )
    SELECT
      ranked.bank_name,
      ranked.collection_date,
      ranked.product_id,
      ranked.product_name,
      ranked.term_months,
      ranked.interest_rate,
      ranked.deposit_tier,
      ranked.min_deposit,
      ranked.max_deposit,
      ranked.interest_payment,
      ranked.source_url,
      ranked.product_url,
      ranked.published_at,
      ranked.data_quality_flag,
      ranked.confidence_score,
      ranked.retrieval_type,
      ranked.parsed_at,
      ranked.first_retrieved_at,
      ranked.rate_confirmed_at,
      ranked.run_source,
      ranked.product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM ranked
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = ranked.bank_name
      AND pps.product_id = ranked.product_id
    WHERE ranked.row_num = 1
      ${filters.includeRemoved ? '' : 'AND COALESCE(pps.is_removed, 0) = 0'}
    ORDER BY ${orderClause}
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result).map((row) => presentTdRow(row))
}

export async function queryTdTimeseries(db: D1Database, input: {
  bank?: string; banks?: string[]; productKey?: string; seriesKey?: string; termMonths?: string; depositTier?: string; interestPayment?: string
  minRate?: number; maxRate?: number
  includeRemoved?: boolean
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
  startDate?: string; endDate?: string; limit?: number; offset?: number
}) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', input.minRate, input.maxRate)
  if (input.mode === 'daily') {
    where.push("h.retrieval_type != 'historical_scrape'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (input.mode === 'historical') {
    where.push("h.retrieval_type = 'historical_scrape'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }

  addBankWhere(where, binds, 'h.bank_name', input.bank, input.banks)
  if (input.seriesKey) {
    where.push('h.series_key = ?')
    binds.push(input.seriesKey)
  } else if (input.productKey) {
    where.push("(h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier) = ?")
    binds.push(input.productKey)
  }
  if (input.termMonths) { where.push('CAST(h.term_months AS TEXT) = ?'); binds.push(input.termMonths) }
  if (input.depositTier) { where.push('h.deposit_tier = ?'); binds.push(input.depositTier) }
  if (input.interestPayment) { where.push('h.interest_payment = ?'); binds.push(input.interestPayment) }
  if (!input.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')
  where.push(runSourceWhereClause('h.run_source', input.sourceMode ?? 'all'))
  if (input.startDate) { where.push('h.collection_date >= ?'); binds.push(input.startDate) }
  if (input.endDate) { where.push('h.collection_date <= ?'); binds.push(input.endDate) }

  const limit = safeLimit(input.limit, 500, 2000)
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0))
  binds.push(limit, offset)

  const sql = `
    SELECT
      h.collection_date,
      h.bank_name,
      h.product_id,
      h.product_code,
      h.product_name,
      h.series_key,
      (h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier) AS product_key,
      h.term_months,
      h.interest_rate,
      h.deposit_tier,
      h.min_deposit,
      h.max_deposit,
      h.interest_payment,
      h.source_url,
      h.product_url,
      h.published_at,
      h.cdr_product_detail_json,
      h.data_quality_flag,
      h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      h.run_id,
      h.run_source,
      MIN(h.parsed_at) OVER (PARTITION BY COALESCE(h.series_key, (h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier || '|' || h.interest_payment))) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.term_months,
          h.deposit_tier,
          h.interest_payment,
          h.interest_rate,
          h.min_deposit,
          h.max_deposit
      ) AS rate_confirmed_at,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_term_deposit_rates h
    LEFT JOIN series_presence_status pps
      ON pps.dataset_kind = 'term_deposits'
      AND pps.series_key = h.series_key
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY h.collection_date ASC, h.parsed_at ASC
    LIMIT ? OFFSET ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result).map((row) => presentTdRow(row))
}

export async function queryTdForExport(db: D1Database, filters: TdPaginatedFilters, maxRows = 10000) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.min(maxRows, Math.max(1, Math.floor(Number(maxRows))))

  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_term_deposit_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.term_months, h.interest_rate, h.deposit_tier,
      h.min_deposit, h.max_deposit, h.interest_payment,
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_json, h.data_quality_flag, h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.term_months, h.deposit_tier
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.term_months,
          h.deposit_tier,
          h.interest_payment,
          h.interest_rate,
          h.min_deposit,
          h.max_deposit
      ) AS rate_confirmed_at,
      h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier AS product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
FROM historical_term_deposit_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC
    LIMIT ?
  `

  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(dataSql).bind(...binds, limit).all<Record<string, unknown>>(),
  ])

  let scheduled = 0
  let manual = 0
  for (const row of rows(dataResult)) {
    if (String((row as Record<string, unknown>).run_source ?? 'scheduled').toLowerCase() === 'manual') manual += 1
    else scheduled += 1
  }
  return {
    data: rows(dataResult).map((row) => presentCoreRowFields(row)),
    total: Number(countResult?.total ?? 0),
    source_mix: { scheduled, manual },
  }
}

export async function getTdStaleness(db: D1Database, staleHours = 48) {
  const result = await db
    .prepare(
      `SELECT
        bank_name,
        MAX(collection_date) AS latest_date,
        MAX(parsed_at) AS latest_parsed_at,
        COUNT(*) AS total_rows
       FROM historical_term_deposit_rates
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

export async function getTdQualityDiagnostics(db: D1Database) {
  const [totals, byFlag, sourceMix] = await Promise.all([
    db
      .prepare(
        `SELECT
          COUNT(*) AS total_rows,
          SUM(CASE WHEN interest_rate BETWEEN ? AND ? THEN 1 ELSE 0 END) AS in_range_rows,
          SUM(CASE WHEN confidence_score >= ? THEN 1 ELSE 0 END) AS confidence_ok_rows
         FROM historical_term_deposit_rates`,
      )
      .bind(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE, MIN_CONFIDENCE)
      .first<{ total_rows: number; in_range_rows: number; confidence_ok_rows: number }>(),
    db
      .prepare(
        `SELECT data_quality_flag, COUNT(*) AS n
         FROM historical_term_deposit_rates
         GROUP BY data_quality_flag
         ORDER BY n DESC`,
      )
      .all<{ data_quality_flag: string; n: number }>(),
    db
      .prepare(
        `SELECT COALESCE(run_source, 'scheduled') AS run_source, COUNT(*) AS n
         FROM historical_term_deposit_rates
         GROUP BY COALESCE(run_source, 'scheduled')`,
      )
      .all<{ run_source: string; n: number }>(),
  ])

  let scheduled = 0
  let manual = 0
  for (const row of rows(sourceMix)) {
    if (String(row.run_source).toLowerCase() === 'manual') manual += Number(row.n)
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
