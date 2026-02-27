const MIN_HOME_LOAN_RATE = 0.5
const MAX_HOME_LOAN_RATE = 25
const MIN_HOME_LOAN_CONFIDENCE = 0.85

const MIN_SAVINGS_RATE = 0
const MAX_SAVINGS_RATE = 15
const MIN_SAVINGS_CONFIDENCE = 0.85

const MIN_TD_RATE = 0
const MAX_TD_RATE = 15
const MIN_TD_CONFIDENCE = 0.85

type RateChangeQueryInput = {
  limit?: number
  offset?: number
}

function safeLimit(limit: number | undefined, fallback: number, max = 1000): number {
  if (!Number.isFinite(limit)) return fallback
  return Math.min(max, Math.max(1, Math.floor(limit as number)))
}

function safeOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset)) return 0
  return Math.max(0, Math.floor(offset as number))
}

function rows<T>(result: D1Result<T>): T[] {
  return result.results ?? []
}

type HomeLoanRateChangeRow = {
  changed_at: string
  previous_changed_at: string | null
  collection_date: string
  previous_collection_date: string | null
  bank_name: string
  product_name: string
  product_key: string
  security_purpose: string
  repayment_type: string
  lvr_tier: string
  rate_structure: string
  previous_rate: number
  new_rate: number
  delta_bps: number
  run_source: string | null
}

export async function queryHomeLoanRateChanges(db: D1Database, input: RateChangeQueryInput) {
  const limit = safeLimit(input.limit, 200, 1000)
  const offset = safeOffset(input.offset)

  const cte = `
    WITH base AS (
      SELECT
        h.collection_date,
        h.parsed_at,
        h.bank_name,
        h.product_name,
        h.security_purpose,
        h.repayment_type,
        h.lvr_tier,
        h.rate_structure,
        h.interest_rate,
        h.run_source,
        h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key
      FROM historical_loan_rates h
      WHERE h.interest_rate BETWEEN ?1 AND ?2
        AND h.confidence_score >= ?3
    ),
    ordered AS (
      SELECT
        b.*,
        LAG(b.interest_rate) OVER (
          PARTITION BY b.product_key
          ORDER BY b.collection_date ASC, b.parsed_at ASC
        ) AS previous_rate,
        LAG(b.parsed_at) OVER (
          PARTITION BY b.product_key
          ORDER BY b.collection_date ASC, b.parsed_at ASC
        ) AS previous_changed_at,
        LAG(b.collection_date) OVER (
          PARTITION BY b.product_key
          ORDER BY b.collection_date ASC, b.parsed_at ASC
        ) AS previous_collection_date
      FROM base b
    ),
    changed AS (
      SELECT
        o.parsed_at AS changed_at,
        o.previous_changed_at,
        o.collection_date,
        o.previous_collection_date,
        o.bank_name,
        o.product_name,
        o.product_key,
        o.security_purpose,
        o.repayment_type,
        o.lvr_tier,
        o.rate_structure,
        o.previous_rate,
        o.interest_rate AS new_rate,
        ROUND((o.interest_rate - o.previous_rate) * 100, 3) AS delta_bps,
        o.run_source
      FROM ordered o
      WHERE o.previous_rate IS NOT NULL
        AND o.interest_rate != o.previous_rate
    )
  `

  const countSql = `${cte} SELECT COUNT(*) AS total FROM changed`
  const dataSql = `${cte}
    SELECT *
    FROM changed
    ORDER BY changed_at DESC
    LIMIT ?4 OFFSET ?5
  `

  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(MIN_HOME_LOAN_RATE, MAX_HOME_LOAN_RATE, MIN_HOME_LOAN_CONFIDENCE).first<{ total: number }>(),
    db.prepare(dataSql).bind(MIN_HOME_LOAN_RATE, MAX_HOME_LOAN_RATE, MIN_HOME_LOAN_CONFIDENCE, limit, offset).all<HomeLoanRateChangeRow>(),
  ])

  return {
    total: Number(countResult?.total ?? 0),
    rows: rows(dataResult),
  }
}

type SavingsRateChangeRow = {
  changed_at: string
  previous_changed_at: string | null
  collection_date: string
  previous_collection_date: string | null
  bank_name: string
  product_name: string
  product_key: string
  account_type: string
  rate_type: string
  deposit_tier: string
  previous_rate: number
  new_rate: number
  delta_bps: number
  run_source: string | null
}

export async function querySavingsRateChanges(db: D1Database, input: RateChangeQueryInput) {
  const limit = safeLimit(input.limit, 200, 1000)
  const offset = safeOffset(input.offset)

  const cte = `
    WITH base AS (
      SELECT
        h.collection_date,
        h.parsed_at,
        h.bank_name,
        h.product_name,
        h.account_type,
        h.rate_type,
        h.deposit_tier,
        h.interest_rate,
        h.run_source,
        h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key
      FROM historical_savings_rates h
      WHERE h.interest_rate BETWEEN ?1 AND ?2
        AND h.confidence_score >= ?3
    ),
    ordered AS (
      SELECT
        b.*,
        LAG(b.interest_rate) OVER (
          PARTITION BY b.product_key
          ORDER BY b.collection_date ASC, b.parsed_at ASC
        ) AS previous_rate,
        LAG(b.parsed_at) OVER (
          PARTITION BY b.product_key
          ORDER BY b.collection_date ASC, b.parsed_at ASC
        ) AS previous_changed_at,
        LAG(b.collection_date) OVER (
          PARTITION BY b.product_key
          ORDER BY b.collection_date ASC, b.parsed_at ASC
        ) AS previous_collection_date
      FROM base b
    ),
    changed AS (
      SELECT
        o.parsed_at AS changed_at,
        o.previous_changed_at,
        o.collection_date,
        o.previous_collection_date,
        o.bank_name,
        o.product_name,
        o.product_key,
        o.account_type,
        o.rate_type,
        o.deposit_tier,
        o.previous_rate,
        o.interest_rate AS new_rate,
        ROUND((o.interest_rate - o.previous_rate) * 100, 3) AS delta_bps,
        o.run_source
      FROM ordered o
      WHERE o.previous_rate IS NOT NULL
        AND o.interest_rate != o.previous_rate
    )
  `

  const countSql = `${cte} SELECT COUNT(*) AS total FROM changed`
  const dataSql = `${cte}
    SELECT *
    FROM changed
    ORDER BY changed_at DESC
    LIMIT ?4 OFFSET ?5
  `

  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(MIN_SAVINGS_RATE, MAX_SAVINGS_RATE, MIN_SAVINGS_CONFIDENCE).first<{ total: number }>(),
    db.prepare(dataSql).bind(MIN_SAVINGS_RATE, MAX_SAVINGS_RATE, MIN_SAVINGS_CONFIDENCE, limit, offset).all<SavingsRateChangeRow>(),
  ])

  return {
    total: Number(countResult?.total ?? 0),
    rows: rows(dataResult),
  }
}

type TdRateChangeRow = {
  changed_at: string
  previous_changed_at: string | null
  collection_date: string
  previous_collection_date: string | null
  bank_name: string
  product_name: string
  product_key: string
  term_months: string
  deposit_tier: string
  interest_payment: string
  previous_rate: number
  new_rate: number
  delta_bps: number
  run_source: string | null
}

export async function queryTdRateChanges(db: D1Database, input: RateChangeQueryInput) {
  const limit = safeLimit(input.limit, 200, 1000)
  const offset = safeOffset(input.offset)

  const cte = `
    WITH base AS (
      SELECT
        h.collection_date,
        h.parsed_at,
        h.bank_name,
        h.product_name,
        h.term_months,
        h.deposit_tier,
        h.interest_payment,
        h.interest_rate,
        h.run_source,
        h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier AS product_key
      FROM historical_term_deposit_rates h
      WHERE h.interest_rate BETWEEN ?1 AND ?2
        AND h.confidence_score >= ?3
    ),
    ordered AS (
      SELECT
        b.*,
        LAG(b.interest_rate) OVER (
          PARTITION BY b.product_key
          ORDER BY b.collection_date ASC, b.parsed_at ASC
        ) AS previous_rate,
        LAG(b.parsed_at) OVER (
          PARTITION BY b.product_key
          ORDER BY b.collection_date ASC, b.parsed_at ASC
        ) AS previous_changed_at,
        LAG(b.collection_date) OVER (
          PARTITION BY b.product_key
          ORDER BY b.collection_date ASC, b.parsed_at ASC
        ) AS previous_collection_date
      FROM base b
    ),
    changed AS (
      SELECT
        o.parsed_at AS changed_at,
        o.previous_changed_at,
        o.collection_date,
        o.previous_collection_date,
        o.bank_name,
        o.product_name,
        o.product_key,
        o.term_months,
        o.deposit_tier,
        o.interest_payment,
        o.previous_rate,
        o.interest_rate AS new_rate,
        ROUND((o.interest_rate - o.previous_rate) * 100, 3) AS delta_bps,
        o.run_source
      FROM ordered o
      WHERE o.previous_rate IS NOT NULL
        AND o.interest_rate != o.previous_rate
    )
  `

  const countSql = `${cte} SELECT COUNT(*) AS total FROM changed`
  const dataSql = `${cte}
    SELECT *
    FROM changed
    ORDER BY changed_at DESC
    LIMIT ?4 OFFSET ?5
  `

  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(MIN_TD_RATE, MAX_TD_RATE, MIN_TD_CONFIDENCE).first<{ total: number }>(),
    db.prepare(dataSql).bind(MIN_TD_RATE, MAX_TD_RATE, MIN_TD_CONFIDENCE, limit, offset).all<TdRateChangeRow>(),
  ])

  return {
    total: Number(countResult?.total ?? 0),
    rows: rows(dataResult),
  }
}
