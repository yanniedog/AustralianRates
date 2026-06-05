import { describe, expect, it } from 'vitest'

/**
 * Mirror of `latestAllBlockIsCompleteForLimit` in `site/ar-chart-local-data.js`.
 * Keep in sync when changing snapshot latest-all completeness rules.
 */
function latestAllBlockIsCompleteForLimit(
  block: {
    rows: unknown[]
    count?: number
    total?: number
    meta?: {
      coverage?: { total_rows?: number; limited?: boolean }
      snapshot_rows_truncated?: boolean
    }
  } | null,
  requestedLimit: number | string | undefined,
): boolean {
  if (!block || typeof block !== 'object' || !Array.isArray(block.rows)) return false
  const rows = block.rows
  const limit = Math.max(0, Number(requestedLimit || 0))
  const count = Number(block.count)
  const total = Number(block.total)
  const meta = block.meta && typeof block.meta === 'object' ? block.meta : null
  const coverage = meta?.coverage && typeof meta.coverage === 'object' ? meta.coverage : null
  const coverageTotal = coverage ? Number(coverage.total_rows) : NaN
  const coverageLimited = !!(coverage && coverage.limited)
  const snapshotTruncated = !!(meta && meta.snapshot_rows_truncated)
  const knownTotal = Number.isFinite(total)
    ? total
    : Number.isFinite(coverageTotal)
      ? coverageTotal
      : Number.isFinite(count)
        ? count
        : rows.length
  if (!rows.length) return knownTotal === 0
  if (knownTotal > rows.length) return false
  if (limit > 0 && rows.length < Math.min(limit, knownTotal)) return false
  if ((coverageLimited || snapshotTruncated) && limit > 0 && rows.length < limit) return false
  return true
}

describe('latestAllBlockIsCompleteForLimit', () => {
  it('rejects capped snapshot when universe total exceeds returned rows at request limit', () => {
    const block = {
      rows: Array.from({ length: 5000 }, () => ({})),
      count: 5000,
      total: 8200,
      meta: { coverage: { total_rows: 8200, returned_rows: 5000, limited: true } },
    }
    expect(latestAllBlockIsCompleteForLimit(block, 5000)).toBe(false)
  })

  it('accepts snapshot when returned rows match universe total', () => {
    const block = {
      rows: Array.from({ length: 1200 }, () => ({})),
      count: 1200,
      total: 1200,
      meta: { coverage: { total_rows: 1200, returned_rows: 1200, limited: false } },
    }
    expect(latestAllBlockIsCompleteForLimit(block, 5000)).toBe(true)
  })

  it('rejects inline-trimmed snapshot when total exceeds capped rows', () => {
    const block = {
      rows: Array.from({ length: 300 }, () => ({})),
      count: 300,
      total: 1200,
      meta: {
        coverage: { total_rows: 1200, returned_rows: 300, limited: true },
        snapshot_rows_truncated: true,
      },
    }
    expect(latestAllBlockIsCompleteForLimit(block, 5000)).toBe(false)
  })
})
