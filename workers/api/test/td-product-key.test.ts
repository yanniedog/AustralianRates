import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { queryTdRatesPaginated } from '../src/db/term-deposits/paginated'
import { queryTdTimeseries } from '../src/db/term-deposits/timeseries'
import { wrapSqliteDatabase } from './support/sqlite-d1'

const BANK_NAME = 'ANZ'
const PRODUCT_ID = '2d41a5d3-0c8d-d5e9-cadc-195410627e08'
const PRODUCT_NAME = 'ANZ Advance Notice Term Deposit'
const DEPOSIT_TIER = 'all'
const TERM_MONTHS = 7

function createTdQueryDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
CREATE TABLE historical_term_deposit_rates (
  collection_date TEXT NOT NULL,
  parsed_at TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  series_key TEXT NOT NULL,
  term_months INTEGER NOT NULL,
  interest_rate REAL NOT NULL,
  deposit_tier TEXT NOT NULL,
  min_deposit REAL,
  max_deposit REAL,
  interest_payment TEXT NOT NULL,
  source_url TEXT NOT NULL,
  product_url TEXT,
  published_at TEXT,
  cdr_product_detail_hash TEXT,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  run_id TEXT,
  run_source TEXT NOT NULL
);

CREATE TABLE product_presence_status (
  section TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  is_removed INTEGER NOT NULL,
  removed_at TEXT
);

CREATE TABLE series_presence_status (
  dataset_kind TEXT NOT NULL,
  series_key TEXT NOT NULL,
  is_removed INTEGER NOT NULL,
  removed_at TEXT
);
`)
  return sqlite
}

function insertTdRow(
  sqlite: DatabaseSync,
  input: {
    collectionDate: string
    parsedAt: string
    interestPayment: 'at_maturity' | 'monthly'
    interestRate: number
    runSource: 'scheduled' | 'manual'
  },
) {
  const seriesKey = `${BANK_NAME}|${PRODUCT_ID}|${TERM_MONTHS}|${DEPOSIT_TIER}|${input.interestPayment}`
  sqlite
    .prepare(
      `INSERT INTO historical_term_deposit_rates (
         collection_date,
         parsed_at,
         bank_name,
         product_id,
         product_code,
         product_name,
         series_key,
         term_months,
         interest_rate,
         deposit_tier,
         min_deposit,
         max_deposit,
         interest_payment,
         source_url,
         product_url,
         published_at,
         cdr_product_detail_hash,
         data_quality_flag,
         confidence_score,
         retrieval_type,
         run_id,
         run_source
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)`,
    )
    .run(
      input.collectionDate,
      input.parsedAt,
      BANK_NAME,
      PRODUCT_ID,
      PRODUCT_ID,
      PRODUCT_NAME,
      seriesKey,
      TERM_MONTHS,
      input.interestRate,
      DEPOSIT_TIER,
      null,
      null,
      input.interestPayment,
      'https://www.anz.com.au/personal/bank-accounts/term-deposits/advance-notice-term-deposit/',
      'https://www.anz.com.au/personal/bank-accounts/term-deposits/advance-notice-term-deposit/',
      null,
      null,
      'cdr_live',
      0.99,
      'present_scrape_same_date',
      `${input.runSource}:${input.collectionDate}`,
      input.runSource,
    )
}

describe('term deposit product_key identity', () => {
  it('filters timeseries by the canonical 5-part TD product_key', async () => {
    const sqlite = createTdQueryDb()
    insertTdRow(sqlite, {
      collectionDate: '2026-03-06',
      parsedAt: '2026-03-05T13:20:43.017Z',
      interestPayment: 'at_maturity',
      interestRate: 3.25,
      runSource: 'scheduled',
    })
    insertTdRow(sqlite, {
      collectionDate: '2026-03-07',
      parsedAt: '2026-03-06T13:34:37.490Z',
      interestPayment: 'at_maturity',
      interestRate: 3.25,
      runSource: 'scheduled',
    })
    insertTdRow(sqlite, {
      collectionDate: '2026-03-06',
      parsedAt: '2026-03-05T13:20:53.227Z',
      interestPayment: 'monthly',
      interestRate: 3.22,
      runSource: 'scheduled',
    })
    insertTdRow(sqlite, {
      collectionDate: '2026-03-07',
      parsedAt: '2026-03-06T13:34:47.536Z',
      interestPayment: 'monthly',
      interestRate: 3.22,
      runSource: 'scheduled',
    })

    const rows = await queryTdTimeseries(wrapSqliteDatabase(sqlite), {
      productKey: `${BANK_NAME}|${PRODUCT_ID}|${TERM_MONTHS}|${DEPOSIT_TIER}|monthly`,
      includeRemoved: true,
      limit: 10,
      mode: 'all',
      sourceMode: 'all',
    })

    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.product_key === `${BANK_NAME}|${PRODUCT_ID}|${TERM_MONTHS}|${DEPOSIT_TIER}|monthly`)).toBe(true)
    expect(rows.every((row) => row.interest_payment === 'monthly')).toBe(true)
    sqlite.close()
  })

  it('emits canonical 5-part TD product_keys from paginated results', async () => {
    const sqlite = createTdQueryDb()
    insertTdRow(sqlite, {
      collectionDate: '2026-03-07',
      parsedAt: '2026-03-07T00:28:36.893Z',
      interestPayment: 'at_maturity',
      interestRate: 3.25,
      runSource: 'manual',
    })
    insertTdRow(sqlite, {
      collectionDate: '2026-03-07',
      parsedAt: '2026-03-07T00:28:47.138Z',
      interestPayment: 'monthly',
      interestRate: 3.22,
      runSource: 'manual',
    })

    const result = await queryTdRatesPaginated(wrapSqliteDatabase(sqlite), {
      includeRemoved: true,
      mode: 'all',
      page: 1,
      size: 10,
      sourceMode: 'all',
    })

    expect(result.data).toHaveLength(2)
    expect(result.data.map((row) => row.product_key)).toEqual([
      `${BANK_NAME}|${PRODUCT_ID}|${TERM_MONTHS}|${DEPOSIT_TIER}|at_maturity`,
      `${BANK_NAME}|${PRODUCT_ID}|${TERM_MONTHS}|${DEPOSIT_TIER}|monthly`,
    ])
    expect(result.data.map((row) => row.series_key)).toEqual([
      `${BANK_NAME}|${PRODUCT_ID}|${TERM_MONTHS}|${DEPOSIT_TIER}|at_maturity`,
      `${BANK_NAME}|${PRODUCT_ID}|${TERM_MONTHS}|${DEPOSIT_TIER}|monthly`,
    ])
    sqlite.close()
  })
})
