import { describe, expect, it } from 'vitest'
import { collapseChartSeriesRows } from '../src/utils/chart-series-collapse'

describe('collapseChartSeriesRows', () => {
  it('keeps one row per product_key and collection_date for day representation', () => {
    const rows = [
      { product_key: 'a|1', collection_date: '2024-01-01', interest_rate: 5.1, is_removed: 0 },
      { product_key: 'a|1', collection_date: '2024-01-01', interest_rate: 5.2, is_removed: 0 },
      { product_key: 'a|1', collection_date: '2024-01-02', interest_rate: 5.3, is_removed: 0 },
    ]
    const out = collapseChartSeriesRows('day', rows)
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.interest_rate)).toContain(5.2)
    expect(out.map((r) => r.collection_date).sort()).toEqual(['2024-01-01', '2024-01-02'])
  })

  it('prefers non-removed when collapsing day duplicates', () => {
    const rows = [
      { product_key: 'b|2', collection_date: '2024-02-01', interest_rate: 6.0, is_removed: 1 },
      { product_key: 'b|2', collection_date: '2024-02-01', interest_rate: 6.1, is_removed: 0 },
    ]
    const out = collapseChartSeriesRows('day', rows)
    expect(out).toHaveLength(1)
    expect(out[0].interest_rate).toBe(6.1)
    expect(out[0].is_removed).toBe(0)
  })
})
