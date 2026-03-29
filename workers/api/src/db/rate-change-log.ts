import { getRateChangeDatasetConfig, type RateChangeDataset } from './rate-changes/config'
import { queryRateChangeIntegrity, type RateChangeIntegrity } from './rate-changes/integrity'
import { buildRateChangeCountSql, buildRateChangeDataSql, type RateChangeQueryInput } from './rate-changes/sql'
import { rows } from './query-common'

async function queryRateChangesByDataset<T>(
  db: D1Database,
  dataset: RateChangeDataset,
  input: RateChangeQueryInput,
): Promise<{ total: number; rows: T[] }> {
  const config = getRateChangeDatasetConfig(dataset)
  const countQuery = buildRateChangeCountSql(config, input.windowStartDate)
  const dataQuery = buildRateChangeDataSql(config, input)

  const [countResult, dataResult] = await Promise.all([
    db.prepare(countQuery.sql).bind(...countQuery.bindings).first<{ total: number }>(),
    db.prepare(dataQuery.sql).bind(...dataQuery.bindings).all<T>(),
  ])

  return {
    total: Number(countResult?.total ?? 0),
    rows: rows(dataResult),
  }
}

async function queryChangeIntegrityByDataset(db: D1Database, dataset: RateChangeDataset): Promise<RateChangeIntegrity> {
  const config = getRateChangeDatasetConfig(dataset)
  return queryRateChangeIntegrity(db, config)
}

export type HomeLoanRateChangeRow = {
  changed_at: string
  previous_changed_at: string | null
  collection_date: string
  previous_collection_date: string | null
  bank_name: string
  product_name: string
  series_key: string
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

export type SavingsRateChangeRow = {
  changed_at: string
  previous_changed_at: string | null
  collection_date: string
  previous_collection_date: string | null
  bank_name: string
  product_name: string
  series_key: string
  product_key: string
  account_type: string
  rate_type: string
  deposit_tier: string
  previous_rate: number
  new_rate: number
  delta_bps: number
  run_source: string | null
}

export type TdRateChangeRow = {
  changed_at: string
  previous_changed_at: string | null
  collection_date: string
  previous_collection_date: string | null
  bank_name: string
  product_name: string
  series_key: string
  product_key: string
  term_months: number
  deposit_tier: string
  interest_payment: string
  previous_rate: number
  new_rate: number
  delta_bps: number
  run_source: string | null
}

export async function queryHomeLoanRateChanges(db: D1Database, input: RateChangeQueryInput) {
  return queryRateChangesByDataset<HomeLoanRateChangeRow>(db, 'home_loans', input)
}

export async function querySavingsRateChanges(db: D1Database, input: RateChangeQueryInput) {
  return queryRateChangesByDataset<SavingsRateChangeRow>(db, 'savings', input)
}

export async function queryTdRateChanges(db: D1Database, input: RateChangeQueryInput) {
  return queryRateChangesByDataset<TdRateChangeRow>(db, 'term_deposits', input)
}

export async function queryHomeLoanRateChangeIntegrity(db: D1Database) {
  return queryChangeIntegrityByDataset(db, 'home_loans')
}

export async function querySavingsRateChangeIntegrity(db: D1Database) {
  return queryChangeIntegrityByDataset(db, 'savings')
}

export async function queryTdRateChangeIntegrity(db: D1Database) {
  return queryChangeIntegrityByDataset(db, 'term_deposits')
}

export async function queryHomeLoanRateChangesForWindow(
  db: D1Database,
  input: Omit<RateChangeQueryInput, 'maxLimit'> & { limit?: number },
) {
  return queryRateChangesByDataset<HomeLoanRateChangeRow>(db, 'home_loans', { ...input, maxLimit: 50000 })
}

export async function querySavingsRateChangesForWindow(
  db: D1Database,
  input: Omit<RateChangeQueryInput, 'maxLimit'> & { limit?: number },
) {
  return queryRateChangesByDataset<SavingsRateChangeRow>(db, 'savings', { ...input, maxLimit: 50000 })
}

export async function queryTdRateChangesForWindow(
  db: D1Database,
  input: Omit<RateChangeQueryInput, 'maxLimit'> & { limit?: number },
) {
  return queryRateChangesByDataset<TdRateChangeRow>(db, 'term_deposits', { ...input, maxLimit: 50000 })
}
