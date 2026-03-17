/**
 * Landing-page overview: RBA rate (with change/check times) and latest bank feed summary.
 * Used by GET /overview to power hero stats and hover tooltips.
 */

export type RbaLandingRow = {
  cash_rate: number
  effective_date: string
  fetched_at: string
}

export type FeedsLandingRow = {
  last_collection_date: string
  last_parsed_at: string
  latest_bank: string
  latest_product: string
}

export type DatasetKind = 'home_loans' | 'savings' | 'term_deposits'

const FEEDS_SQL = `
  SELECT
    collection_date AS last_collection_date,
    parsed_at AS last_parsed_at,
    bank_name AS latest_bank,
    product_name AS latest_product
  FROM historical_loan_rates
  ORDER BY collection_date DESC, parsed_at DESC
  LIMIT 1
` as const

const SAVINGS_FEEDS_SQL = `
  SELECT
    collection_date AS last_collection_date,
    parsed_at AS last_parsed_at,
    bank_name AS latest_bank,
    product_name AS latest_product
  FROM historical_savings_rates
  ORDER BY collection_date DESC, parsed_at DESC
  LIMIT 1
` as const

const TD_FEEDS_SQL = `
  SELECT
    collection_date AS last_collection_date,
    parsed_at AS last_parsed_at,
    bank_name AS latest_bank,
    product_name AS latest_product
  FROM historical_term_deposit_rates
  ORDER BY collection_date DESC, parsed_at DESC
  LIMIT 1
` as const

/** Latest RBA row by collection_date (for hero: rate, when it changed, when we last checked). */
export async function getLatestRbaForLanding(db: D1Database): Promise<RbaLandingRow | null> {
  const row = await db
    .prepare(
      `SELECT cash_rate, effective_date, fetched_at
       FROM rba_cash_rates
       ORDER BY collection_date DESC
       LIMIT 1`,
    )
    .first<RbaLandingRow>()
  if (!row || !row.effective_date) return null
  return {
    cash_rate: Number(row.cash_rate),
    effective_date: String(row.effective_date),
    fetched_at: String(row.fetched_at ?? ''),
  }
}

/** Latest feed row for a dataset: last collection date, last parsed_at, and one latest bank/product. */
export async function getLatestFeedsForLanding(
  db: D1Database,
  section: DatasetKind,
): Promise<FeedsLandingRow | null> {
  const sql =
    section === 'home_loans'
      ? FEEDS_SQL
      : section === 'savings'
        ? SAVINGS_FEEDS_SQL
        : TD_FEEDS_SQL
  const row = await db.prepare(sql).first<FeedsLandingRow>()
  if (!row || !row.last_collection_date) return null
  return {
    last_collection_date: String(row.last_collection_date),
    last_parsed_at: String(row.last_parsed_at ?? ''),
    latest_bank: String(row.latest_bank ?? ''),
    latest_product: String(row.latest_product ?? ''),
  }
}

export type LandingOverviewPayload = {
  rba: {
    cash_rate: number
    effective_date: string
    fetched_at: string
  } | null
  feeds: {
    last_collection_date: string
    last_parsed_at: string
    latest_bank: string
    latest_product: string
  } | null
}

export async function getLandingOverview(
  db: D1Database,
  section: DatasetKind,
): Promise<LandingOverviewPayload> {
  const [rba, feeds] = await Promise.all([
    section === 'home_loans' ? getLatestRbaForLanding(db) : Promise.resolve(null),
    getLatestFeedsForLanding(db, section),
  ])
  return {
    rba: rba
      ? {
          cash_rate: rba.cash_rate,
          effective_date: rba.effective_date,
          fetched_at: rba.fetched_at,
        }
      : null,
    feeds: feeds
      ? {
          last_collection_date: feeds.last_collection_date,
          last_parsed_at: feeds.last_parsed_at,
          latest_bank: feeds.latest_bank,
          latest_product: feeds.latest_product,
        }
      : null,
  }
}
