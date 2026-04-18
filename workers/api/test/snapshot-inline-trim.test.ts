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

  it('returns null when immovable fields alone exceed the cap', () => {
    const data: Record<string, unknown> = {
      siteUi: { blob: 'x'.repeat(500_000) },
    }
    expect(trimSnapshotDataForHtmlInline(section, scope, builtAt, data)).toBeNull()
  })
})
