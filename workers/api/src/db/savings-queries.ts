import { SAVINGS_ACCOUNT_TYPES, SAVINGS_RATE_TYPES } from '../constants'
import { runSourceWhereClause, type SourceMode } from '../utils/source-mode'
import { presentCoreRowFields, presentSavingsRow } from '../utils/row-presentation'

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
  banks?: string[]
  accountType?: string
  rateType?: string
  depositTier?: string
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
  account_type: 'h.account_type',
  rate_type: 'h.rate_type',
  interest_rate: 'h.interest_rate',
  deposit_tier: 'h.deposit_tier',
  monthly_fee: 'h.monthly_fee',
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

function buildWhere(filters: SavingsPaginatedFilters): { clause: string; binds: Array<string | number> } {
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
  if (filters.accountType) { where.push('h.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('h.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('h.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (filters.startDate) { where.push('h.collection_date >= ?'); binds.push(filters.startDate) }
  if (filters.endDate) { where.push('h.collection_date <= ?'); binds.push(filters.endDate) }
  if (!filters.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', binds }
}

export async function querySavingsRatesPaginated(db: D1Database, filters: SavingsPaginatedFilters) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`

  const page = Math.max(1, Math.floor(Number(filters.page) || 1))
  const size = Math.min(1000, Math.max(1, Math.floor(Number(filters.size) || 50)))
  const offset = (page - 1) * size

  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const sourceSql = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.account_type, h.rate_type, h.interest_rate, h.deposit_tier,
      h.min_balance, h.max_balance, h.conditions, h.monthly_fee,
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_json, h.data_quality_flag, h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.account_type, h.rate_type, h.deposit_tier
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.account_type,
          h.rate_type,
          h.deposit_tier,
          h.interest_rate,
          h.monthly_fee,
          h.min_balance,
          h.max_balance,
          h.conditions
      ) AS rate_confirmed_at,
      h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
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
    if (String(row.run_source).toLowerCase() === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }
  const data = rows(dataResult).map((row) => presentSavingsRow(row))

  return {
    last_page: Math.max(1, Math.ceil(total / size)),
    total,
    data,
    source_mix: { scheduled, manual },
  }
}

export async function queryLatestSavingsRates(db: D1Database, filters: {
  bank?: string; banks?: string[]; accountType?: string; rateType?: string; depositTier?: string
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
  if (filters.accountType) { where.push('v.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('v.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('v.deposit_tier = ?'); binds.push(filters.depositTier) }
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
        FROM historical_savings_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.account_type = v.account_type
          AND h.rate_type = v.rate_type
          AND h.deposit_tier = v.deposit_tier
      ) AS first_retrieved_at,
      (
        SELECT MAX(h.parsed_at)
        FROM historical_savings_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.account_type = v.account_type
          AND h.rate_type = v.rate_type
          AND h.deposit_tier = v.deposit_tier
          AND h.interest_rate = v.interest_rate
          AND (
            (h.monthly_fee = v.monthly_fee)
            OR (h.monthly_fee IS NULL AND v.monthly_fee IS NULL)
          )
          AND (
            (h.min_balance = v.min_balance)
            OR (h.min_balance IS NULL AND v.min_balance IS NULL)
          )
          AND (
            (h.max_balance = v.max_balance)
            OR (h.max_balance IS NULL AND v.max_balance IS NULL)
          )
          AND (
            (h.conditions = v.conditions)
            OR (h.conditions IS NULL AND v.conditions IS NULL)
          )
          AND h.data_quality_flag LIKE 'cdr_live%'
      ) AS rate_confirmed_at,
      v.product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM vw_latest_savings_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${orderMap[filters.orderBy ?? 'default'] ?? orderMap.default}
    LIMIT ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result).map((row) => presentSavingsRow(row))
}

/** Count of current products matching the same filters as queryLatestSavingsRates. */
export async function queryLatestSavingsRatesCount(db: D1Database, filters: Parameters<typeof queryLatestSavingsRates>[1]): Promise<number> {
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
  if (filters.accountType) { where.push('v.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('v.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('v.deposit_tier = ?'); binds.push(filters.depositTier) }
  if (!filters.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')
  where.push(runSourceWhereClause('v.run_source', filters.sourceMode ?? 'all'))

  const countSql = `
    SELECT COUNT(*) AS n
    FROM vw_latest_savings_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `
  const countResult = await db.prepare(countSql).bind(...binds).first<{ n: number }>()
  const n = countResult?.n ?? 0
  return Number(n)
}

export async function queryLatestAllSavingsRates(db: D1Database, filters: {
  bank?: string; banks?: string[]; accountType?: string; rateType?: string; depositTier?: string
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
  if (filters.accountType) { where.push('h.account_type = ?'); binds.push(filters.accountType) }
  if (filters.rateType) { where.push('h.rate_type = ?'); binds.push(filters.rateType) }
  if (filters.depositTier) { where.push('h.deposit_tier = ?'); binds.push(filters.depositTier) }
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
        h.account_type,
        h.rate_type,
        h.interest_rate,
        h.deposit_tier,
        h.min_balance,
        h.max_balance,
        h.conditions,
        h.monthly_fee,
        h.source_url,
        h.product_url,
        h.published_at,
        h.data_quality_flag,
        h.confidence_score,
        h.retrieval_type,
        h.parsed_at,
        MIN(h.parsed_at) OVER (
          PARTITION BY h.bank_name, h.product_id, h.account_type, h.rate_type, h.deposit_tier
        ) AS first_retrieved_at,
        MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
          PARTITION BY
            h.bank_name,
            h.product_id,
            h.account_type,
            h.rate_type,
            h.deposit_tier,
            h.interest_rate,
            h.monthly_fee,
            h.min_balance,
            h.max_balance,
            h.conditions
        ) AS rate_confirmed_at,
        h.run_source,
        h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key,
        ROW_NUMBER() OVER (
          PARTITION BY h.bank_name, h.product_id, h.account_type, h.rate_type, h.deposit_tier
          ORDER BY h.collection_date DESC, h.parsed_at DESC
        ) AS row_num
      FROM historical_savings_rates h
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    )
    SELECT
      ranked.bank_name,
      ranked.collection_date,
      ranked.product_id,
      ranked.product_name,
      ranked.account_type,
      ranked.rate_type,
      ranked.interest_rate,
      ranked.deposit_tier,
      ranked.min_balance,
      ranked.max_balance,
      ranked.conditions,
      ranked.monthly_fee,
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
      ON pps.section = 'savings'
      AND pps.bank_name = ranked.bank_name
      AND pps.product_id = ranked.product_id
    WHERE ranked.row_num = 1
      ${filters.includeRemoved ? '' : 'AND COALESCE(pps.is_removed, 0) = 0'}
    ORDER BY ${orderClause}
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result).map((row) => presentSavingsRow(row))
}

export async function querySavingsTimeseries(db: D1Database, input: {
  bank?: string; banks?: string[]; productKey?: string; accountType?: string; rateType?: string
  minRate?: number; maxRate?: number
  includeRemoved?: boolean
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
  startDate?: string; endDate?: string; limit?: number
}) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('t.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 't.interest_rate', input.minRate, input.maxRate)
  if (input.mode === 'daily') {
    where.push("t.retrieval_type != 'historical_scrape'")
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  } else if (input.mode === 'historical') {
    where.push("t.retrieval_type = 'historical_scrape'")
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE)
  }

  addBankWhere(where, binds, 't.bank_name', input.bank, input.banks)
  if (input.productKey) { where.push('t.product_key = ?'); binds.push(input.productKey) }
  if (input.accountType) { where.push('t.account_type = ?'); binds.push(input.accountType) }
  if (input.rateType) { where.push('t.rate_type = ?'); binds.push(input.rateType) }
  if (!input.includeRemoved) where.push('COALESCE(pps.is_removed, 0) = 0')
  where.push(runSourceWhereClause('t.run_source', input.sourceMode ?? 'all'))
  if (input.startDate) { where.push('t.collection_date >= ?'); binds.push(input.startDate) }
  if (input.endDate) { where.push('t.collection_date <= ?'); binds.push(input.endDate) }

  const limit = safeLimit(input.limit, 500, 5000)
  binds.push(limit)

  const sql = `
    SELECT
      t.*,
      MIN(t.parsed_at) OVER (PARTITION BY t.product_key) AS first_retrieved_at,
      MAX(CASE WHEN t.data_quality_flag LIKE 'cdr_live%' THEN t.parsed_at END) OVER (
        PARTITION BY
          t.bank_name,
          t.product_id,
          t.account_type,
          t.rate_type,
          t.deposit_tier,
          t.interest_rate,
          t.monthly_fee,
          t.min_balance,
          t.max_balance,
          t.conditions
      ) AS rate_confirmed_at,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM vw_savings_timeseries t
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = t.bank_name
      AND pps.product_id = t.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.collection_date ASC
    LIMIT ?
  `
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result).map((row) => presentSavingsRow(row))
}

export async function querySavingsForExport(db: D1Database, filters: SavingsPaginatedFilters, maxRows = 10000) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.min(maxRows, Math.max(1, Math.floor(Number(maxRows))))

  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const sourceSql = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.account_type, h.rate_type, h.interest_rate, h.deposit_tier,
      h.min_balance, h.max_balance, h.conditions, h.monthly_fee,
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_json, h.data_quality_flag, h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.account_type, h.rate_type, h.deposit_tier
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.account_type,
          h.rate_type,
          h.deposit_tier,
          h.interest_rate,
          h.monthly_fee,
          h.min_balance,
          h.max_balance,
          h.conditions
      ) AS rate_confirmed_at,
      h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
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
    if (String(row.run_source).toLowerCase() === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }
  return {
    data: rows(dataResult).map((row) => presentCoreRowFields(row)),
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
