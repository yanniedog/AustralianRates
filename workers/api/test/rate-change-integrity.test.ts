import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { getRateChangeDatasetConfig } from '../src/db/rate-changes/config'
import { queryRateChangeIntegrity } from '../src/db/rate-changes/integrity'
import { wrapSqliteDatabase } from './support/sqlite-d1'

function createTdIntegrityDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
CREATE TABLE historical_term_deposit_rates (
  collection_date TEXT NOT NULL,
  parsed_at TEXT NOT NULL,
  run_id TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  term_months INTEGER NOT NULL,
  deposit_tier TEXT NOT NULL,
  interest_payment TEXT NOT NULL,
  interest_rate REAL NOT NULL,
  confidence_score REAL NOT NULL,
  run_source TEXT NOT NULL,
  series_key TEXT NOT NULL
);
`)
  return sqlite
}

function insertTdRow(
  sqlite: DatabaseSync,
  input: {
    runId: string
    parsedAt: string
    interestRate: number
  },
) {
  sqlite
    .prepare(
      `INSERT INTO historical_term_deposit_rates (
         collection_date,
         parsed_at,
         run_id,
         bank_name,
         product_id,
         product_name,
         term_months,
         deposit_tier,
         interest_payment,
         interest_rate,
         confidence_score,
         run_source,
         series_key
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .run(
      '2026-03-05',
      input.parsedAt,
      input.runId,
      'Bank of Queensland',
      '0b906e88-5c03-ee11-8f6e-00224814d330',
      'Premier Investment Term Deposit',
      9,
      '$5k-$250.0k',
      'monthly',
      input.interestRate,
      0.99,
      'scheduled',
      'Bank of Queensland|0b906e88-5c03-ee11-8f6e-00224814d330|9|$5k-$250.0k|monthly',
    )
}

describe('rate-change integrity collisions', () => {
  it('does not flag same-day series updates across different runs as identity collisions', async () => {
    const sqlite = createTdIntegrityDb()
    insertTdRow(sqlite, {
      runId: 'daily:2026-03-05:2026-03-04T13:28:00.000Z',
      parsedAt: '2026-03-04T13:28:49.816Z',
      interestRate: 4.45,
    })
    insertTdRow(sqlite, {
      runId: 'daily:2026-03-05:2026-03-05T12:55:00.000Z',
      parsedAt: '2026-03-05T12:55:50.497Z',
      interestRate: 4.55,
    })

    const integrity = await queryRateChangeIntegrity(
      wrapSqliteDatabase(sqlite),
      getRateChangeDatasetConfig('term_deposits'),
    )
    const collisionCheck = integrity.checks.find((check) => check.id === 'identity_collisions')

    expect(collisionCheck?.passed).toBe(true)
    sqlite.close()
  })

  it('flags conflicting rates for the same series within a single run', async () => {
    const sqlite = createTdIntegrityDb()
    insertTdRow(sqlite, {
      runId: 'daily:2026-03-05:2026-03-05T12:55:00.000Z',
      parsedAt: '2026-03-05T12:55:50.497Z',
      interestRate: 4.45,
    })
    insertTdRow(sqlite, {
      runId: 'daily:2026-03-05:2026-03-05T12:55:00.000Z',
      parsedAt: '2026-03-05T12:55:51.505Z',
      interestRate: 4.55,
    })

    const integrity = await queryRateChangeIntegrity(
      wrapSqliteDatabase(sqlite),
      getRateChangeDatasetConfig('term_deposits'),
    )
    const collisionCheck = integrity.checks.find((check) => check.id === 'identity_collisions')

    expect(collisionCheck?.passed).toBe(false)
    expect(collisionCheck?.metrics).toMatchObject({
      collision_groups: 1,
      collision_rows: 2,
    })
    sqlite.close()
  })
})
