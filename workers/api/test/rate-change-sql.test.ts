import { describe, expect, it } from 'vitest'
import { getRateChangeDatasetConfig } from '../src/db/rate-changes/config'
import { buildMissingKeyClause, buildRateChangeCte, buildRateChangeDataSql } from '../src/db/rate-changes/sql'

describe('term deposit rate-change identity', () => {
  it('requires interest_payment in the change-series identity', () => {
    const config = getRateChangeDatasetConfig('term_deposits')

    expect(config.keyDimensions).toContain('interest_payment')
    expect(config.seriesKeyExpression).toContain('interest_payment')
    expect(config.productKeyExpression).toContain('interest_payment')
    expect(buildMissingKeyClause(config, 'h')).toContain('h.interest_payment')
  })

  it('partitions derived changes by series identity instead of the legacy product key', () => {
    const config = getRateChangeDatasetConfig('term_deposits')
    const query = buildRateChangeCte(config)

    expect(query.cte).toContain('AS product_key')
    expect(query.cte).toContain('AS series_key')
    expect(query.cte).toContain('PARTITION BY i.series_key')
    expect(query.cte).not.toContain('PARTITION BY i.product_key')
  })

  it('anchors previous change dates to earlier change events instead of the prior snapshot row', () => {
    const config = getRateChangeDatasetConfig('term_deposits')
    const query = buildRateChangeCte(config)

    expect(query.cte).toContain('AS prior_snapshot_rate')
    expect(query.cte).toContain('FROM change_events c')
    expect(query.cte).toContain('LAG(c.collection_date) OVER')
    expect(query.cte).toContain('LAG(c.changed_at) OVER')
    expect(query.cte).not.toContain('LAG(i.collection_date) OVER')
    expect(query.cte).not.toContain('LAG(i.parsed_at) OVER')
  })

  it('applies date windows after change-event derivation so prior change dates stay available', () => {
    const config = getRateChangeDatasetConfig('term_deposits')
    const query = buildRateChangeDataSql(config, { windowStartDate: '2026-03-01' })

    expect(query.sql).toContain('FROM changed')
    expect(query.sql).toContain('WHERE collection_date >= ?')
    expect(query.sql).not.toContain('AND collection_date >= ?')
  })
})
