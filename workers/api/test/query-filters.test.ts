import { describe, expect, it } from 'vitest'
import { queryLatestRates } from '../src/db/queries'
import { queryLatestSavingsRates } from '../src/db/savings-queries'
import { queryLatestTdRates } from '../src/db/td-queries'

type Statement = { sql: string; binds: Array<string | number> }

function makeSqlCaptureDb() {
  const statements: Statement[] = []

  const db = {
    prepare: (sql: string) => ({
      bind: (...binds: Array<string | number>) => ({
        all: async () => {
          statements.push({ sql, binds })
          return { results: [] }
        },
        first: async () => {
          statements.push({ sql, binds })
          return { total: 0 }
        },
      }),
    }),
  } as unknown as D1Database

  return {
    db,
    lastStatement: () => statements[statements.length - 1],
  }
}

describe('query filter SQL generation', () => {
  it('applies multi-bank, numeric bounds, and default removed filtering for home-loan latest', async () => {
    const mock = makeSqlCaptureDb()

    await queryLatestRates(mock.db, {
      banks: ['ANZ', 'CBA'],
      minRate: 5.0,
      maxRate: 6.0,
      minComparisonRate: 5.1,
      maxComparisonRate: 6.1,
      limit: 25,
    })

    const stmt = mock.lastStatement()
    expect(stmt.sql).toMatch(/v\.bank_name IN \(\?, \?\)/)
    expect(stmt.sql).toContain('v.interest_rate >= ?')
    expect(stmt.sql).toContain('v.interest_rate <= ?')
    expect(stmt.sql).toContain('v.comparison_rate IS NOT NULL')
    expect(stmt.sql).toContain('COALESCE(pps.is_removed, 0) = 0')
  })

  it('omits removed filtering when includeRemoved is true for home-loan latest', async () => {
    const mock = makeSqlCaptureDb()

    await queryLatestRates(mock.db, {
      includeRemoved: true,
      limit: 10,
    })

    const stmt = mock.lastStatement()
    expect(stmt.sql).not.toContain('COALESCE(pps.is_removed, 0) = 0')
  })

  it('supports multi-bank and min/max headline filtering for savings latest', async () => {
    const mock = makeSqlCaptureDb()

    await queryLatestSavingsRates(mock.db, {
      banks: ['NAB', 'ING'],
      minRate: 1.5,
      maxRate: 5.5,
      limit: 20,
    })

    const stmt = mock.lastStatement()
    expect(stmt.sql).toMatch(/v\.bank_name IN \(\?, \?\)/)
    expect(stmt.sql).toContain('v.interest_rate >= ?')
    expect(stmt.sql).toContain('v.interest_rate <= ?')
    expect(stmt.sql).toContain('COALESCE(pps.is_removed, 0) = 0')
  })

  it('supports multi-bank and min/max headline filtering for term-deposit latest', async () => {
    const mock = makeSqlCaptureDb()

    await queryLatestTdRates(mock.db, {
      banks: ['ANZ', 'Westpac'],
      minRate: 2.0,
      maxRate: 6.0,
      limit: 20,
    })

    const stmt = mock.lastStatement()
    expect(stmt.sql).toMatch(/v\.bank_name IN \(\?, \?\)/)
    expect(stmt.sql).toContain('v.interest_rate >= ?')
    expect(stmt.sql).toContain('v.interest_rate <= ?')
    expect(stmt.sql).toContain('COALESCE(pps.is_removed, 0) = 0')
  })
})

