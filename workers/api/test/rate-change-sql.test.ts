import { describe, expect, it } from 'vitest'
import { getRateChangeDatasetConfig } from '../src/db/rate-changes/config'
import { buildMissingKeyClause, buildRateChangeCte } from '../src/db/rate-changes/sql'

describe('term deposit rate-change identity', () => {
  it('requires interest_payment in the change-series identity', () => {
    const config = getRateChangeDatasetConfig('term_deposits')

    expect(config.keyDimensions).toContain('interest_payment')
    expect(config.seriesKeyExpression).toContain('interest_payment')
    expect(config.productKeyExpression).not.toContain('interest_payment')
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
})
