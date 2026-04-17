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

  it('returns null when immovable fields alone exceed the cap', () => {
    const data: Record<string, unknown> = {
      siteUi: { blob: 'x'.repeat(500_000) },
    }
    expect(trimSnapshotDataForHtmlInline(section, scope, builtAt, data)).toBeNull()
  })
})
