import { describe, expect, it } from 'vitest'
import { shouldFilterSiteHealthAttentionForActionable } from '../src/db/health-check-runs'

describe('health check run persistence', () => {
  it('filters stale site health attention rows when a newer healthy run exists', () => {
    expect(
      shouldFilterSiteHealthAttentionForActionable(
        {
          message: 'site_health_attention',
          ts: '2026-03-28T20:15:42.870Z',
        },
        {
          checked_at: '2026-03-28T20:22:20.823Z',
          overall_ok: 1,
        },
      ),
    ).toBe(true)
  })

  it('keeps site health attention rows when the latest run is not healthy', () => {
    expect(
      shouldFilterSiteHealthAttentionForActionable(
        {
          message: 'site_health_attention',
          ts: '2026-03-28T20:15:42.870Z',
        },
        {
          checked_at: '2026-03-28T20:22:20.823Z',
          overall_ok: 0,
        },
      ),
    ).toBe(false)
  })

  it.todo(
    'verify health-check persistence with a real D1 schema fixture or integration worker; the synthetic prepared-statement capture test was removed under the real-data-only policy',
  )
})
