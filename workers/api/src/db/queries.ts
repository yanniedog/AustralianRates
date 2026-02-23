import {
  FEATURE_SETS,
  LVR_TIERS,
  RATE_STRUCTURES,
  REPAYMENT_TYPES,
  SECURITY_PURPOSES,
} from '../constants'

type LatestFilters = {
  bank?: string
  securityPurpose?: string
  repaymentType?: string
  rateStructure?: string
  lvrTier?: string
  featureSet?: string
  mode?: 'all' | 'daily' | 'historical'
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

  where.push(`v.interest_rate BETWEEN ${MIN_PUBLIC_RATE} AND ${MAX_PUBLIC_RATE}`)

  if (filters.bank) {
    where.push('v.bank_name = ?')
    binds.push(filters.bank)
  }
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
      v.data_quality_flag,
      v.confidence_score,
      v.parsed_at,
      v.product_key,
      r.cash_rate AS rba_cash_rate
    FROM vw_latest_rates v
    LEFT JOIN rba_cash_rates r
      ON r.collection_date = v.collection_date
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${VALID_ORDER_BY[filters.orderBy ?? 'default'] ?? VALID_ORDER_BY.default}
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result)
}

export async function queryTimeseries(
  db: D1Database,
  input: {
    bank?: string
    productKey?: string
    securityPurpose?: string
    repaymentType?: string
    featureSet?: string
    mode?: 'all' | 'daily' | 'historical'
    startDate?: string
    endDate?: string
    limit?: number
  },
) {
  const where: string[] = []
  const binds: Array<string | number> = []

  where.push(`t.interest_rate BETWEEN ${MIN_PUBLIC_RATE} AND ${MAX_PUBLIC_RATE}`)

  if (input.bank) {
    where.push('t.bank_name = ?')
    binds.push(input.bank)
  }
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
      t.source_url,
      t.product_key,
      r.cash_rate AS rba_cash_rate
    FROM vw_rate_timeseries t
    LEFT JOIN rba_cash_rates r
      ON r.collection_date = t.collection_date
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.collection_date ASC
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result)
}

export async function getQualityDiagnostics(db: D1Database) {
  const [totals, byFlag] = await Promise.all([
    db
      .prepare(
        `SELECT
          COUNT(*) AS total_rows,
          SUM(CASE WHEN interest_rate BETWEEN ${MIN_PUBLIC_RATE} AND ${MAX_PUBLIC_RATE} THEN 1 ELSE 0 END) AS in_range_rows,
          SUM(CASE WHEN confidence_score >= ${MIN_CONFIDENCE_ALL} THEN 1 ELSE 0 END) AS confidence_ok_rows
         FROM historical_loan_rates`,
      )
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