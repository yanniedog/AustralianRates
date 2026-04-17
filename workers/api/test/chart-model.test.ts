/**
 * Unit tests for the server-side chart-model port (workers/api/src/chart-model/*).
 *
 * These are pure-function tests with literal inputs (allowed under the
 * `no-mock-test-data.mdc` exception for pure unit tests). They exercise the
 * numeric math of the ports end-to-end against row shapes that match the
 * columns the analytics projection actually returns to the chart endpoints.
 */

import { describe, expect, it } from 'vitest'
import { buildSeriesCollection } from '../src/chart-model/series-collection'
import { buildSurfaceModel } from '../src/chart-model/surface'
import { buildLenderRanking } from '../src/chart-model/lender-ranking'
import { buildDistributionModel } from '../src/chart-model/distribution'
import { buildDefaultChartModel } from '../src/chart-model/chart-model'
import { parseDensity, rankDirection } from '../src/chart-model/config'

type Row = Record<string, unknown>

/** Three lenders, two products each, 4 days of data; mimics the row shape
 *  that `collectHomeLoanAnalyticsRowsResolved` returns after projection. */
function buildHomeLoanRows(): Row[] {
  const lenders = [
    { bank: 'ANZ', product: 'Simplicity PLUS', productKey: 'anz|simplicity', seriesKey: 'anz|simplicity|80' },
    { bank: 'CBA', product: 'Wealth Package', productKey: 'cba|wealth', seriesKey: 'cba|wealth|80' },
    { bank: 'CBA', product: 'Extra Home Loan', productKey: 'cba|extra', seriesKey: 'cba|extra|80' },
    { bank: 'NAB', product: 'Tailored Home', productKey: 'nab|tailored', seriesKey: 'nab|tailored|80' },
  ]
  const days = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']
  const rows: Row[] = []
  for (const lender of lenders) {
    days.forEach((day, i) => {
      rows.push({
        collection_date: day,
        bank_name: lender.bank,
        product_name: lender.product,
        product_key: lender.productKey,
        series_key: lender.seriesKey,
        interest_rate: 5.8 + i * 0.05 + (lender.bank === 'ANZ' ? 0 : lender.bank === 'CBA' ? 0.2 : 0.4),
        comparison_rate: 6.0,
        security_purpose: 'owner_occupied',
        repayment_type: 'principal_and_interest',
        rate_structure: 'variable',
        lvr_tier: 'lvr_80-85%',
      })
    })
  }
  return rows
}

describe('chart-model/config', () => {
  it('rankDirection returns asc for home-loans interest_rate (lower is better)', () => {
    expect(rankDirection('home_loans', 'interest_rate')).toBe('asc')
    expect(rankDirection('savings', 'interest_rate')).toBe('desc')
    expect(rankDirection('term_deposits', 'interest_rate')).toBe('desc')
  })

  it('rankDirection returns asc for fee fields regardless of section', () => {
    expect(rankDirection('home_loans', 'annual_fee')).toBe('asc')
    expect(rankDirection('savings', 'monthly_fee')).toBe('asc')
    expect(rankDirection('term_deposits', 'total_cost')).toBe('asc')
  })

  it('parseDensity resolves standard density with optional cap', () => {
    const base = parseDensity('standard', null, null)
    expect(base.rowLimit).toBe(24)
    expect(base.compareLimit).toBe(6)

    const capped = parseDensity('standard', 10, 'capped')
    expect(capped.rowLimit).toBe(10)
    expect(capped.compareLimit).toBe(6)

    const unlimited = parseDensity('standard', null, 'unlimited')
    expect(unlimited.rowLimit).toBe(Number.MAX_SAFE_INTEGER)
    expect(unlimited.compareLimit).toBe(12)
  })
})

describe('chart-model/series-collection', () => {
  it('groups rows by product identity, sorts points, computes delta, and sorts by metric direction', () => {
    const rows = buildHomeLoanRows()
    const series = buildSeriesCollection(rows, 'interest_rate', 'home_loans')
    expect(series.length).toBe(4)
    // home-loans direction = asc (lower is better), so ANZ (best rate) should be first.
    expect(series[0].bankName).toBe('ANZ')
    expect(series[series.length - 1].bankName).toBe('NAB')

    for (const entry of series) {
      expect(entry.points.length).toBe(4)
      const dates = entry.points.map((p) => p.date)
      expect(dates).toEqual([...dates].sort())
      expect(entry.latestDate).toBe('2026-03-04')
      expect(entry.delta).toBeCloseTo(entry.points[3].value - entry.points[0].value, 6)
    }
  })

  it('drops rows with non-numeric string metric values (matches client numericValue behaviour)', () => {
    // `null` coerces to 0 (Number(null) === 0, finite); only NaN-producing values are dropped.
    // This mirrors the client's `numericValue` in site/ar-chart-data.js so server and client agree.
    const rows = [
      { collection_date: '2026-03-01', bank_name: 'ANZ', product_name: 'A', product_key: 'a', interest_rate: 5.5 },
      { collection_date: '2026-03-02', bank_name: 'ANZ', product_name: 'A', product_key: 'a', interest_rate: 'N/A' },
      { collection_date: '2026-03-03', bank_name: 'ANZ', product_name: 'A', product_key: 'a', interest_rate: undefined },
    ]
    const series = buildSeriesCollection(rows, 'interest_rate', 'home_loans')
    expect(series.length).toBe(1)
    expect(series[0].pointCount).toBe(1)
  })
})

describe('chart-model/surface', () => {
  it('builds an ECharts-ready grid: unique dates on x, one row per series, cells with [xIdx, yIdx, value]', () => {
    const rows = buildHomeLoanRows()
    const series = buildSeriesCollection(rows, 'interest_rate', 'home_loans')
    const surface = buildSurfaceModel(series)
    expect(surface.xLabels).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'])
    expect(surface.yLabels.length).toBe(4)
    expect(surface.cells.length).toBe(series.length * 4)
    for (const cell of surface.cells) {
      expect(cell.value[0]).toBeGreaterThanOrEqual(0)
      expect(cell.value[1]).toBeGreaterThanOrEqual(0)
      expect(cell.value[1]).toBeLessThan(series.length)
      expect(cell.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(Number(surface.min)).toBeCloseTo(5.8, 3)
    expect(Number(surface.max)).toBeCloseTo(6.35, 3)
  })
})

describe('chart-model/lender-ranking', () => {
  it('groups series by bank, picks the best-ranked series per bank, and respects density rowLimit', () => {
    const rows = buildHomeLoanRows()
    const series = buildSeriesCollection(rows, 'interest_rate', 'home_loans')
    const density = parseDensity('standard', null, null)
    const ranking = buildLenderRanking(series, { yField: 'interest_rate' }, density, 'home_loans')
    expect(ranking.totalBanks).toBe(3)
    expect(ranking.entries.length).toBe(3)
    expect(ranking.entries[0].bankName).toBe('ANZ')
    expect(ranking.entries[0].rank).toBe(1)
    expect(ranking.direction).toBe('asc')
    for (let i = 1; i < ranking.entries.length; i++) {
      const prev = ranking.entries[i - 1].value as number
      const curr = ranking.entries[i].value as number
      expect(prev).toBeLessThanOrEqual(curr)
    }
  })

  it('truncates to density rowLimit', () => {
    const rows = buildHomeLoanRows()
    const series = buildSeriesCollection(rows, 'interest_rate', 'home_loans')
    const density = parseDensity('standard', 2, 'capped')
    const ranking = buildLenderRanking(series, { yField: 'interest_rate' }, density, 'home_loans')
    expect(ranking.entries.length).toBe(2)
    expect(ranking.entries[0].rank).toBe(1)
    expect(ranking.entries[1].rank).toBe(2)
    expect(ranking.totalBanks).toBe(3)
  })
})

describe('chart-model/distribution', () => {
  it('groups by bank_name (fallback from product_key), computes box-whisker stats sorted by direction', () => {
    const rows = buildHomeLoanRows()
    const distribution = buildDistributionModel(rows, { yField: 'interest_rate', groupField: 'product_key' }, 'home_loans')
    expect(distribution.categories.length).toBe(3)
    expect(distribution.categories[0]).toBe('ANZ')
    expect(distribution.boxes[0].length).toBe(5)
    expect(distribution.boxes[0][0]).toBeLessThanOrEqual(distribution.boxes[0][4])
    expect(distribution.means[0]).toBeLessThanOrEqual(distribution.means[2] as number)
  })
})

describe('chart-model/chart-model (composed)', () => {
  it('produces the full default-view payload with meta, surface, ranking, distribution', () => {
    const rows = buildHomeLoanRows()
    const model = buildDefaultChartModel({ section: 'home_loans', rows })
    expect(model.meta.section).toBe('home_loans')
    expect(model.meta.fields.yField).toBe('interest_rate')
    expect(model.meta.totalRows).toBe(rows.length)
    expect(model.meta.totalSeries).toBeGreaterThanOrEqual(4)
    expect(model.visibleSeriesMeta.length).toBeGreaterThanOrEqual(4)
    expect(model.lenderRanking.entries.length).toBeGreaterThanOrEqual(3)
    expect(model.surface.cells.length).toBeGreaterThanOrEqual(rows.length)
    expect(model.distribution.categories.length).toBeGreaterThanOrEqual(3)
    expect(model.meta.renderedCells).toBe(
      model.visibleSeriesMeta.reduce((sum, s) => sum + s.pointCount, 0),
    )
  })

  it('assigns sequential colorIndex to visible series', () => {
    const rows = buildHomeLoanRows()
    const model = buildDefaultChartModel({ section: 'home_loans', rows })
    model.visibleSeriesMeta.forEach((series, index) => {
      expect(series.colorIndex).toBe(index)
    })
  })
})
