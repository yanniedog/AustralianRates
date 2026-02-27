import {
  FEATURE_SETS,
  LVR_TIERS,
  RATE_STRUCTURES,
  REPAYMENT_TYPES,
  SECURITY_PURPOSES,
} from '../constants'
import { runSourceWhereClause, type SourceMode } from '../utils/source-mode'
import { presentCoreRowFields, presentHomeLoanRow } from '../utils/row-presentation'

type LatestFilters = {
  bank?: string
  banks?: string[]
  securityPurpose?: string
  repaymentType?: string
  rateStructure?: string
  lvrTier?: string
  featureSet?: string
  minRate?: number
  maxRate?: number
  minComparisonRate?: number
  maxComparisonRate?: number
  includeRemoved?: boolean
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
  limit?: number
  orderBy?: 'default' | 'rate_asc' | 'rate_desc'
}

const VALID_ORDER_BY: Record<string, string> = {
  default: 'v.collection_date DESC, v.bank_name ASC, v.product_name ASC, v.lvr_tier ASC, v.rate_structure ASC',
  rate_asc: 'v.interest_rate ASC, v.bank_name ASC, v.product_name ASC',
  rate_desc: 'v.interest_rate DESC, v.bank_name ASC, v.product_name ASC',
}

const MIN_PUBLIC_RATE = 0.5
const MAX_PUBLIC_RATE = 25
const MIN_CONFIDENCE_ALL = 0.85
const MIN_CONFIDENCE_DAILY = 0.9
const MIN_CONFIDENCE_HISTORICAL = 0.82

function safeLimit(limit: number | undefined, fallback: number, max = 500): number {
  if (!Number.isFinite(limit)) {
    return fallback
  }
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
  comparisonRateColumn: string,
  filters: {
    minRate?: number
    maxRate?: number
    minComparisonRate?: number
    maxComparisonRate?: number
  },
) {
  if (Number.isFinite(filters.minRate)) {
    where.push(`${interestRateColumn} >= ?`)
    binds.push(Number(filters.minRate))
  }
  if (Number.isFinite(filters.maxRate)) {
    where.push(`${interestRateColumn} <= ?`)
    binds.push(Number(filters.maxRate))
  }
  if (Number.isFinite(filters.minComparisonRate)) {
    where.push(`${comparisonRateColumn} IS NOT NULL`)
    where.push(`${comparisonRateColumn} >= ?`)
    binds.push(Number(filters.minComparisonRate))
  }
  if (Number.isFinite(filters.maxComparisonRate)) {
    where.push(`${comparisonRateColumn} IS NOT NULL`)
    where.push(`${comparisonRateColumn} <= ?`)
    binds.push(Number(filters.maxComparisonRate))
  }
}

export async function getFilters(db: D1Database) {
  const [banks, securityPurposes, repaymentTypes, rateStructures, lvrTiers, featureSets] = await Promise.all([
    db.prepare('SELECT DISTINCT bank_name AS value FROM historical_loan_rates ORDER BY bank_name ASC').all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT security_purpose AS value FROM historical_loan_rates ORDER BY security_purpose ASC')
      .all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT repayment_type AS value FROM historical_loan_rates ORDER BY repayment_type ASC')
      .all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT rate_structure AS value FROM historical_loan_rates ORDER BY rate_structure ASC')
      .all<{ value: string }>(),
    db.prepare('SELECT DISTINCT lvr_tier AS value FROM historical_loan_rates ORDER BY lvr_tier ASC').all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT feature_set AS value FROM historical_loan_rates ORDER BY feature_set ASC')
      .all<{ value: string }>(),
  ])

  const fallbackIfEmpty = (values: string[], fallback: string[]) => (values.length > 0 ? values : fallback)

  return {
    banks: rows(banks).map((x) => x.value),
    security_purposes: fallbackIfEmpty(
      rows(securityPurposes).map((x) => x.value),
      SECURITY_PURPOSES,
    ),
    repayment_types: fallbackIfEmpty(
      rows(repaymentTypes).map((x) => x.value),
      REPAYMENT_TYPES,
    ),
    rate_structures: fallbackIfEmpty(
      rows(rateStructures).map((x) => x.value),
      RATE_STRUCTURES,
    ),
    lvr_tiers: fallbackIfEmpty(
      rows(lvrTiers).map((x) => x.value),
      LVR_TIERS,
    ),
    feature_sets: fallbackIfEmpty(
      rows(featureSets).map((x) => x.value),
      FEATURE_SETS,
    ),
  }
}

export async function queryLatestRates(db: D1Database, filters: LatestFilters) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('v.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)

  addBankWhere(where, binds, 'v.bank_name', filters.bank, filters.banks)
  addRateBoundsWhere(where, binds, 'v.interest_rate', 'v.comparison_rate', filters)
  if (filters.securityPurpose) {
    where.push('v.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('v.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('v.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('v.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('v.feature_set = ?')
    binds.push(filters.featureSet)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(pps.is_removed, 0) = 0')
  }
  where.push(runSourceWhereClause('v.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("v.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("v.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  const limit = safeLimit(filters.limit, 200, 1000)
  binds.push(limit)

  const sql = `
    SELECT
      v.bank_name,
      v.collection_date,
      v.product_id,
      v.product_name,
      v.security_purpose,
      v.repayment_type,
      v.rate_structure,
      v.lvr_tier,
      v.feature_set,
      v.interest_rate,
      v.comparison_rate,
      v.annual_fee,
      v.source_url,
      v.product_url,
      v.published_at,
      v.data_quality_flag,
      v.confidence_score,
      v.retrieval_type,
      v.parsed_at,
      (
        SELECT MIN(h.parsed_at)
        FROM historical_loan_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.security_purpose = v.security_purpose
          AND h.repayment_type = v.repayment_type
          AND h.lvr_tier = v.lvr_tier
          AND h.rate_structure = v.rate_structure
      ) AS first_retrieved_at,
      (
        SELECT MAX(h.parsed_at)
        FROM historical_loan_rates h
        WHERE h.bank_name = v.bank_name
          AND h.product_id = v.product_id
          AND h.security_purpose = v.security_purpose
          AND h.repayment_type = v.repayment_type
          AND h.lvr_tier = v.lvr_tier
          AND h.rate_structure = v.rate_structure
          AND h.interest_rate = v.interest_rate
          AND (
            (h.comparison_rate = v.comparison_rate)
            OR (h.comparison_rate IS NULL AND v.comparison_rate IS NULL)
          )
          AND (
            (h.annual_fee = v.annual_fee)
            OR (h.annual_fee IS NULL AND v.annual_fee IS NULL)
          )
          AND h.data_quality_flag LIKE 'cdr_live%'
      ) AS rate_confirmed_at,
      v.run_source,
      v.product_key,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= v.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM vw_latest_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${VALID_ORDER_BY[filters.orderBy ?? 'default'] ?? VALID_ORDER_BY.default}
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result).map((row) => presentHomeLoanRow(row))
}

/** Count of current products matching the same filters as queryLatestRates (for "Tracked products" total). */
export async function queryLatestRatesCount(db: D1Database, filters: LatestFilters): Promise<number> {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('v.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addBankWhere(where, binds, 'v.bank_name', filters.bank, filters.banks)
  addRateBoundsWhere(where, binds, 'v.interest_rate', 'v.comparison_rate', filters)
  if (filters.securityPurpose) {
    where.push('v.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('v.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('v.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('v.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('v.feature_set = ?')
    binds.push(filters.featureSet)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(pps.is_removed, 0) = 0')
  }
  where.push(runSourceWhereClause('v.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("v.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("v.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('v.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  const countSql = `
    SELECT COUNT(*) AS n
    FROM vw_latest_rates v
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = v.bank_name
      AND pps.product_id = v.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `
  const countResult = await db.prepare(countSql).bind(...binds).first<{ n: number }>()
  const n = countResult?.n ?? 0
  return Number(n)
}

export async function queryLatestAllRates(db: D1Database, filters: LatestFilters) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)

  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  addRateBoundsWhere(where, binds, 'h.interest_rate', 'h.comparison_rate', filters)
  if (filters.securityPurpose) {
    where.push('h.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('h.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('h.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('h.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('h.feature_set = ?')
    binds.push(filters.featureSet)
  }
  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("h.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("h.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  const limit = safeLimit(filters.limit, 200, 1000)
  binds.push(limit)

  const orderBy = filters.orderBy ?? 'default'
  const orderClause =
    orderBy === 'rate_asc'
      ? 'ranked.interest_rate ASC, ranked.bank_name ASC, ranked.product_name ASC'
      : orderBy === 'rate_desc'
        ? 'ranked.interest_rate DESC, ranked.bank_name ASC, ranked.product_name ASC'
        : 'ranked.collection_date DESC, ranked.bank_name ASC, ranked.product_name ASC, ranked.lvr_tier ASC, ranked.rate_structure ASC'

  const sql = `
    WITH ranked AS (
      SELECT
        h.bank_name,
        h.collection_date,
        h.product_id,
        h.product_name,
        h.security_purpose,
        h.repayment_type,
        h.rate_structure,
        h.lvr_tier,
        h.feature_set,
        h.interest_rate,
        h.comparison_rate,
        h.annual_fee,
        h.source_url,
        h.product_url,
        h.published_at,
        h.data_quality_flag,
        h.confidence_score,
        h.retrieval_type,
        h.parsed_at,
        MIN(h.parsed_at) OVER (
          PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
        ) AS first_retrieved_at,
        MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
          PARTITION BY
            h.bank_name,
            h.product_id,
            h.security_purpose,
            h.repayment_type,
            h.lvr_tier,
            h.rate_structure,
            h.interest_rate,
            h.comparison_rate,
            h.annual_fee
        ) AS rate_confirmed_at,
        h.run_source,
        h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
        ROW_NUMBER() OVER (
          PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
          ORDER BY h.collection_date DESC, h.parsed_at DESC
        ) AS row_num
      FROM historical_loan_rates h
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    )
    SELECT
      ranked.bank_name,
      ranked.collection_date,
      ranked.product_id,
      ranked.product_name,
      ranked.security_purpose,
      ranked.repayment_type,
      ranked.rate_structure,
      ranked.lvr_tier,
      ranked.feature_set,
      ranked.interest_rate,
      ranked.comparison_rate,
      ranked.annual_fee,
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
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= ranked.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM ranked
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = ranked.bank_name
      AND pps.product_id = ranked.product_id
    WHERE ranked.row_num = 1
      ${filters.includeRemoved ? '' : 'AND COALESCE(pps.is_removed, 0) = 0'}
    ORDER BY ${orderClause}
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result).map((row) => presentHomeLoanRow(row))
}

export async function queryTimeseries(
  db: D1Database,
  input: {
    bank?: string
    banks?: string[]
    productKey?: string
    securityPurpose?: string
    repaymentType?: string
    featureSet?: string
    minRate?: number
    maxRate?: number
    minComparisonRate?: number
    maxComparisonRate?: number
    includeRemoved?: boolean
    mode?: 'all' | 'daily' | 'historical'
    sourceMode?: SourceMode
    startDate?: string
    endDate?: string
    limit?: number
  },
) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('t.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)

  addBankWhere(where, binds, 't.bank_name', input.bank, input.banks)
  addRateBoundsWhere(where, binds, 't.interest_rate', 't.comparison_rate', input)
  if (input.productKey) {
    where.push('t.product_key = ?')
    binds.push(input.productKey)
  }
  if (input.securityPurpose) {
    where.push('t.security_purpose = ?')
    binds.push(input.securityPurpose)
  }
  if (input.repaymentType) {
    where.push('t.repayment_type = ?')
    binds.push(input.repaymentType)
  }
  if (input.featureSet) {
    where.push('t.feature_set = ?')
    binds.push(input.featureSet)
  }
  if (!input.includeRemoved) {
    where.push('COALESCE(pps.is_removed, 0) = 0')
  }
  where.push(runSourceWhereClause('t.run_source', input.sourceMode ?? 'all'))
  if (input.startDate) {
    where.push('t.collection_date >= ?')
    binds.push(input.startDate)
  }
  if (input.endDate) {
    where.push('t.collection_date <= ?')
    binds.push(input.endDate)
  }
  if (input.mode === 'daily') {
    where.push("t.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (input.mode === 'historical') {
    where.push("t.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('t.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  const limit = safeLimit(input.limit, 500, 5000)
  binds.push(limit)

  const sql = `
    SELECT
      t.collection_date,
      t.bank_name,
      t.product_id,
      t.product_name,
      t.security_purpose,
      t.repayment_type,
      t.lvr_tier,
      t.rate_structure,
      t.feature_set,
      t.interest_rate,
      t.comparison_rate,
      t.annual_fee,
      t.data_quality_flag,
      t.confidence_score,
      t.retrieval_type,
      t.source_url,
      t.product_url,
      t.published_at,
      t.parsed_at,
      MIN(t.parsed_at) OVER (PARTITION BY t.product_key) AS first_retrieved_at,
      MAX(CASE WHEN t.data_quality_flag LIKE 'cdr_live%' THEN t.parsed_at END) OVER (
        PARTITION BY
          t.bank_name,
          t.product_id,
          t.security_purpose,
          t.repayment_type,
          t.lvr_tier,
          t.rate_structure,
          t.interest_rate,
          t.comparison_rate,
          t.annual_fee
      ) AS rate_confirmed_at,
      t.run_source,
      t.product_key,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= t.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM vw_rate_timeseries t
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = t.bank_name
      AND pps.product_id = t.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.collection_date ASC
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result).map((row) => presentHomeLoanRow(row))
}

type RatesPaginatedFilters = {
  page?: number
  size?: number
  startDate?: string
  endDate?: string
  bank?: string
  banks?: string[]
  securityPurpose?: string
  repaymentType?: string
  rateStructure?: string
  lvrTier?: string
  featureSet?: string
  minRate?: number
  maxRate?: number
  minComparisonRate?: number
  maxComparisonRate?: number
  includeRemoved?: boolean
  sort?: string
  dir?: 'asc' | 'desc'
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: SourceMode
}

const PAGINATED_SORT_COLUMNS: Record<string, string> = {
  collection_date: 'h.collection_date',
  bank_name: 'h.bank_name',
  product_name: 'h.product_name',
  security_purpose: 'h.security_purpose',
  repayment_type: 'h.repayment_type',
  rate_structure: 'h.rate_structure',
  lvr_tier: 'h.lvr_tier',
  feature_set: 'h.feature_set',
  interest_rate: 'h.interest_rate',
  comparison_rate: 'h.comparison_rate',
  annual_fee: 'h.annual_fee',
  rba_cash_rate: 'rba_cash_rate',
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

export async function queryRatesPaginated(db: D1Database, filters: RatesPaginatedFilters) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', 'h.comparison_rate', filters)

  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("h.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("h.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  if (filters.securityPurpose) {
    where.push('h.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('h.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('h.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('h.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('h.feature_set = ?')
    binds.push(filters.featureSet)
  }
  if (filters.startDate) {
    where.push('h.collection_date >= ?')
    binds.push(filters.startDate)
  }
  if (filters.endDate) {
    where.push('h.collection_date <= ?')
    binds.push(filters.endDate)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(pps.is_removed, 0) = 0')
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const sortCol = PAGINATED_SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`

  const page = Math.max(1, Math.floor(Number(filters.page) || 1))
  const size = Math.min(1000, Math.max(1, Math.floor(Number(filters.size) || 50)))
  const offset = (page - 1) * size

  // product_key is the canonical longitudinal identity for the same product across collection dates
  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const sourceSql = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const dataSql = `
    SELECT
      h.bank_name,
      h.collection_date,
      h.product_id,
      h.product_name,
      h.security_purpose,
      h.repayment_type,
      h.rate_structure,
      h.lvr_tier,
      h.feature_set,
      h.interest_rate,
      h.comparison_rate,
      h.annual_fee,
      h.source_url,
      h.product_url,
      h.published_at,
      h.cdr_product_detail_json,
      h.data_quality_flag,
      h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.security_purpose,
          h.repayment_type,
          h.lvr_tier,
          h.rate_structure,
          h.interest_rate,
          h.comparison_rate,
          h.annual_fee
      ) AS rate_confirmed_at,
      h.run_id,
      h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= h.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `

  const dataBinds = [...binds, size, offset]

  const [countResult, sourceResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(sourceSql).bind(...binds).all<{ run_source: string; n: number }>(),
    db.prepare(dataSql).bind(...dataBinds).all<Record<string, unknown>>(),
  ])

  const total = Number(countResult?.total ?? 0)
  const lastPage = Math.max(1, Math.ceil(total / size))
  let scheduled = 0
  let manual = 0
  for (const row of rows(sourceResult)) {
    if (String(row.run_source).toLowerCase() === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }

  const data = rows(dataResult).map((row) => presentHomeLoanRow(row))

  return {
    last_page: lastPage,
    total,
    data,
    source_mix: { scheduled, manual },
  }
}

const EXPORT_MAX_ROWS = 10000

export type RatesExportFilters = Omit<RatesPaginatedFilters, 'page' | 'size'> & { limit?: number }

export async function queryRatesForExport(
  db: D1Database,
  filters: RatesExportFilters,
  maxRows: number = EXPORT_MAX_ROWS,
): Promise<{ data: Array<Record<string, unknown>>; total: number; source_mix: { scheduled: number; manual: number } }> {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', 'h.comparison_rate', filters)

  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("h.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("h.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  if (filters.securityPurpose) {
    where.push('h.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('h.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('h.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('h.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('h.feature_set = ?')
    binds.push(filters.featureSet)
  }
  if (filters.startDate) {
    where.push('h.collection_date >= ?')
    binds.push(filters.startDate)
  }
  if (filters.endDate) {
    where.push('h.collection_date <= ?')
    binds.push(filters.endDate)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(pps.is_removed, 0) = 0')
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const sortCol = PAGINATED_SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`
  const limit = Math.min(maxRows, Math.max(1, Math.floor(Number(filters.limit) || maxRows)))

  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const sourceSql = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const dataSql = `
    SELECT
      h.bank_name,
      h.collection_date,
      h.product_id,
      h.product_name,
      h.security_purpose,
      h.repayment_type,
      h.rate_structure,
      h.lvr_tier,
      h.feature_set,
      h.interest_rate,
      h.comparison_rate,
      h.annual_fee,
      h.source_url,
      h.product_url,
      h.published_at,
      h.cdr_product_detail_json,
      h.data_quality_flag,
      h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.security_purpose,
          h.repayment_type,
          h.lvr_tier,
          h.rate_structure,
          h.interest_rate,
          h.comparison_rate,
          h.annual_fee
      ) AS rate_confirmed_at,
      h.run_id,
      h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= h.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    ${orderClause}
    LIMIT ?
  `

  const [countResult, sourceResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(sourceSql).bind(...binds).all<{ run_source: string; n: number }>(),
    db.prepare(dataSql).bind(...binds, limit).all<Record<string, unknown>>(),
  ])

  const total = Number(countResult?.total ?? 0)
  let scheduled = 0
  let manual = 0
  for (const row of rows(sourceResult)) {
    if (String(row.run_source).toLowerCase() === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }
  return {
    data: rows(dataResult).map((row) => presentCoreRowFields(row)),
    total,
    source_mix: { scheduled, manual },
  }
}

export async function getLenderStaleness(db: D1Database, staleHours = 48) {
  const result = await db
    .prepare(
      `SELECT
        bank_name,
        MAX(collection_date) AS latest_date,
        MAX(parsed_at) AS latest_parsed_at,
        COUNT(*) AS total_rows
       FROM historical_loan_rates
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

export async function getQualityDiagnostics(db: D1Database) {
  const [totals, byFlag] = await Promise.all([
    db
      .prepare(
        `SELECT
          COUNT(*) AS total_rows,
          SUM(CASE WHEN interest_rate BETWEEN ? AND ? THEN 1 ELSE 0 END) AS in_range_rows,
          SUM(CASE WHEN confidence_score >= ? THEN 1 ELSE 0 END) AS confidence_ok_rows
         FROM historical_loan_rates`,
      )
      .bind(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE, MIN_CONFIDENCE_ALL)
      .first<{ total_rows: number; in_range_rows: number; confidence_ok_rows: number }>(),
    db
      .prepare(
        `SELECT data_quality_flag, COUNT(*) AS n
         FROM historical_loan_rates
         GROUP BY data_quality_flag
         ORDER BY n DESC`,
      )
      .all<{ data_quality_flag: string; n: number }>(),
  ])

  return {
    total_rows: Number(totals?.total_rows ?? 0),
    in_range_rows: Number(totals?.in_range_rows ?? 0),
    confidence_ok_rows: Number(totals?.confidence_ok_rows ?? 0),
    by_flag: rows(byFlag).map((x) => ({
      data_quality_flag: x.data_quality_flag,
      count: Number(x.n),
    })),
  }
}
