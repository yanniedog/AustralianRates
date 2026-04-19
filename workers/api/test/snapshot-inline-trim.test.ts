import { describe, expect, it } from 'vitest'
import {
  SNAPSHOT_INLINE_RESPONSE_MAX_BYTES,
  trimSnapshotDataForHtmlInline,
  wrappedSnapshotApiByteLength,
} from '../src/utils/snapshot-inline-trim'

describe('snapshot-inline-trim', () => {
  const section = 'home_loans'
  const scope = 'default'
  const builtAt = '2026-01-01T00:00:00.000Z'

  it('returns a clone under the cap when payload is already small', () => {
    const data = { siteUi: { ok: true }, urls: {} }
    const out = trimSnapshotDataForHtmlInline(section, scope, builtAt, data)
    expect(out).toEqual(data)
    expect(wrappedSnapshotApiByteLength(section, scope, builtAt, out!)).toBeLessThanOrEqual(
      SNAPSHOT_INLINE_RESPONSE_MAX_BYTES,
    )
  })

  it('removes analyticsSeries while keeping chartModels when series dominates size', () => {
    const data: Record<string, unknown> = {
      siteUi: { ok: true },
      analyticsSeries: { grouped_rows: { x: 'y'.repeat(600_000) } },
      chartModels: { default: { meta: [1, 2, 3] } },
    }
    const out = trimSnapshotDataForHtmlInline(section, scope, builtAt, data)
    expect(out).not.toHaveProperty('analyticsSeries')
    expect(out).toHaveProperty('chartModels')
    expect(wrappedSnapshotApiByteLength(section, scope, builtAt, out!)).toBeLessThanOrEqual(
      SNAPSHOT_INLINE_RESPONSE_MAX_BYTES,
    )
  })

  it('keeps currentLeaders while trimming the inline payload under the cap', () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      bank_name: `Bank ${index}`,
      product_name: `Product ${index}`,
      interest_rate: 5 + index / 1000,
      lvr_tier: 'lvr_80-85%',
    }))
    const data: Record<string, unknown> = {
      latestAll: { rows },
      currentLeaders: {
        ok: true,
        scenarios: [{ scenarioLabel: 'OO P&I variable 80-85%', row: rows[0] }],
      },
      chartModels: { default: { meta: [1, 2, 3] } },
      analyticsSeries: { grouped_rows: { x: 'y'.repeat(600_000) } },
    }
    const out = trimSnapshotDataForHtmlInline(section, scope, builtAt, data)
    expect(out).toHaveProperty('currentLeaders')
    expect(((out?.currentLeaders as { scenarios?: unknown[] })?.scenarios || []).length).toBe(1)
    expect(wrappedSnapshotApiByteLength(section, scope, builtAt, out!)).toBeLessThanOrEqual(
      SNAPSHOT_INLINE_RESPONSE_MAX_BYTES,
    )
  })

  it('preserves reportProductHistory and reportPlotBands ahead of latestAll and chartModels', () => {
    const data: Record<string, unknown> = {
      siteUi: { ok: true },
      reportPlotBands: { series: [{ bank_name: 'ANZ', points: [{ date: '2026-04-19', min_rate: 4.5, max_rate: 4.7 }] }] },
      reportProductHistory: {
        ok: true,
        version: 2,
        section: 'home_loans',
        dates: ['2026-04-18', '2026-04-19'],
        products: Array.from({ length: 300 }, (_, index) => ({
          key: `bank-${index}|product-${index}`,
          bank_name: `Bank ${index}`,
          product_name: `Product ${index}`,
          rate_structure: 'variable',
          points: [[0, 5.5], [1, 5.4]],
        })),
      },
      latestAll: { rows: Array.from({ length: 1200 }, (_, index) => ({ bank_name: `Bank ${index}`, product_name: `Product ${index}` })) },
      currentLeaders: { scenarios: [{ scenarioLabel: 'Leader', row: { bank_name: 'Bank 1' } }] },
      chartModels: { default: { meta: { totalSeries: 1200 } } },
      analyticsSeries: { grouped_rows: { x: 'y'.repeat(600_000) } },
    }

    const out = trimSnapshotDataForHtmlInline(section, scope, builtAt, data)
    expect(out).toHaveProperty('reportProductHistory')
    expect(out).toHaveProperty('reportPlotBands')
    expect(wrappedSnapshotApiByteLength(section, scope, builtAt, out!)).toBeLessThanOrEqual(
      SNAPSHOT_INLINE_RESPONSE_MAX_BYTES,
    )
  })

  it('keeps compact reportProductHistory for large term-deposit report views under the inline cap', () => {
    const tdData: Record<string, unknown> = {
      siteUi: { ok: true },
      filters: { ok: true, filters: { term_months: Array.from({ length: 36 }, (_, index) => String(index + 1)) } },
      overview: { ok: true },
      reportPlotBands: {
        series: [{ bank_name: 'ANZ', points: [{ date: '2026-04-19', min_rate: 4.5, max_rate: 4.7 }] }],
      },
      reportProductHistory: {
        ok: true,
        version: 2,
        section: 'term_deposits',
        dates: Array.from({ length: 31 }, (_, index) => `2026-04-${String(index + 1).padStart(2, '0')}`),
        products: Array.from({ length: 1000 }, (_, index) => ({
          key: `bank-${index}|td-${index}|12|all|at_maturity`,
          bank_name: `Bank ${index}`,
          product_name: `TD ${index}`,
          term_months: (index % 36) + 1,
          deposit_tier: 'all',
          interest_payment: 'at_maturity',
          points: [[0, 30, 4 + (index % 5) / 10]],
        })),
      },
      filtersResolved: { startDate: '2026-04-01', endDate: '2026-04-31', preset: null },
      urls: {},
      latestAll: { rows: Array.from({ length: 1200 }, (_, index) => ({ bank_name: `Bank ${index}`, product_name: `Product ${index}` })) },
      analyticsSeries: { grouped_rows: { x: 'y'.repeat(600_000) } },
      chartModels: { default: { meta: { totalSeries: 1000 } } },
    }

    const out = trimSnapshotDataForHtmlInline('term_deposits', 'window:30D', builtAt, tdData)
    expect(out).toHaveProperty('reportProductHistory')
    expect(out).toHaveProperty('reportPlotBands')
    expect(wrappedSnapshotApiByteLength('term_deposits', 'window:30D', builtAt, out!)).toBeLessThanOrEqual(
      SNAPSHOT_INLINE_RESPONSE_MAX_BYTES,
    )
  })

  it('keeps raw home-loan report history and bands inline for the default 90D report bundle', () => {
    const homeData: Record<string, unknown> = {
      siteUi: { ok: true },
      filters: { ok: true, filters: { banks: ['ANZ', 'CBA', 'Westpac'] } },
      overview: { ok: true },
      reportPlotBands: {
        series: Array.from({ length: 16 }, (_, bankIndex) => ({
          bank_name: `Bank ${bankIndex}`,
          points: Array.from({ length: 51 }, (_, pointIndex) => ({
            date: `2026-02-${String((pointIndex % 28) + 1).padStart(2, '0')}`,
            min_rate: 5 + bankIndex / 20,
            max_rate: 7 + bankIndex / 20,
          })),
        })),
      },
      reportProductHistory: {
        ok: true,
        version: 2,
        section: 'home_loans',
        dates: Array.from({ length: 51 }, (_, index) => `2026-02-${String((index % 28) + 1).padStart(2, '0')}`),
        products: Array.from({ length: 1100 }, (_, index) => ({
          key: `bank-${index}|product-${index}|owner_occupied|principal_and_interest|lvr_80-85%|variable`,
          bank_name: `Bank ${index}`,
          product_name: `Product ${index}`,
          security_purpose: 'owner_occupied',
          repayment_type: 'principal_and_interest',
          rate_structure: index % 5 === 0 ? 'fixed_1yr' : 'variable',
          lvr_tier: 'lvr_80-85%',
          points: [[0, 50, 5.5 + (index % 7) / 10]],
        })),
      },
      filtersResolved: { startDate: '2026-01-20', endDate: '2026-04-19', preset: null },
      urls: {},
      latestAll: { rows: Array.from({ length: 1200 }, (_, index) => ({ bank_name: `Bank ${index}`, product_name: `Product ${index}` })) },
      analyticsSeries: { grouped_rows: { x: 'y'.repeat(600_000) } },
      chartModels: { default: { meta: { totalSeries: 1100 } } },
    }

    expect(wrappedSnapshotApiByteLength('home_loans', 'window:90D', builtAt, homeData)).toBeGreaterThan(400_000)
    const out = trimSnapshotDataForHtmlInline('home_loans', 'window:90D', builtAt, homeData)
    expect(out).toHaveProperty('reportProductHistory')
    expect(out).toHaveProperty('reportPlotBands')
    expect(wrappedSnapshotApiByteLength('home_loans', 'window:90D', builtAt, out!)).toBeLessThanOrEqual(
      SNAPSHOT_INLINE_RESPONSE_MAX_BYTES,
    )
  })

  it('returns null when immovable fields alone exceed the cap', () => {
    const data: Record<string, unknown> = {
      siteUi: { blob: 'x'.repeat(500_000) },
    }
    expect(trimSnapshotDataForHtmlInline(section, scope, builtAt, data)).toBeNull()
  })
})
