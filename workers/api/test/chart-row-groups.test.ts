import { describe, expect, it } from 'vitest'
import { buildGroupedChartRows } from '../src/utils/chart-row-groups'

describe('buildGroupedChartRows', () => {
  it('moves stable series metadata out of repeated points', () => {
    const grouped = buildGroupedChartRows([
      {
        series_key: 'series-1',
        bank_name: 'Example Bank',
        product_name: 'Product A',
        collection_date: '2026-04-01',
        interest_rate: 5.5,
      },
      {
        series_key: 'series-1',
        bank_name: 'Example Bank',
        product_name: 'Product A',
        collection_date: '2026-04-02',
        interest_rate: 5.6,
      },
    ])

    expect(grouped.version).toBe(1)
    expect(grouped.groups).toHaveLength(1)
    expect(grouped.groups[0]).toEqual({
      meta: {
        series_key: 'series-1',
        bank_name: 'Example Bank',
        product_name: 'Product A',
      },
      points: [
        { collection_date: '2026-04-01', interest_rate: 5.5 },
        { collection_date: '2026-04-02', interest_rate: 5.6 },
      ],
    })
  })

  it('keeps non-stable fields on each point', () => {
    const grouped = buildGroupedChartRows([
      {
        series_key: 'series-1',
        bank_name: 'Example Bank',
        collection_date: '2026-04-01',
        product_url: 'https://example.com/a',
      },
      {
        series_key: 'series-1',
        bank_name: 'Example Bank',
        collection_date: '2026-04-02',
        product_url: 'https://example.com/b',
      },
    ])

    expect(grouped.groups[0]).toEqual({
      meta: {
        series_key: 'series-1',
        bank_name: 'Example Bank',
      },
      points: [
        { collection_date: '2026-04-01', product_url: 'https://example.com/a' },
        { collection_date: '2026-04-02', product_url: 'https://example.com/b' },
      ],
    })
  })
})
