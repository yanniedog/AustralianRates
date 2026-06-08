import { describe, expect, it } from 'vitest'

/**
 * Mirror of `snapshotPayloadFresh` in `functions/_middleware.js` and `site/functions/_middleware.js`.
 */
function snapshotPayloadFresh(
  payload: { builtAt?: string; data?: { filtersResolved?: { endDate?: string } } } | null,
  latestAvailableCollectionDate: string | null,
  nowMs = Date.now(),
): boolean {
  const SNAPSHOT_FRESH_MS = 36 * 60 * 60 * 1000
  if (!payload || typeof payload !== 'object') return false
  const builtAt = new Date(String(payload.builtAt || '')).getTime()
  if (!Number.isFinite(builtAt) || nowMs - builtAt > SNAPSHOT_FRESH_MS) return false
  const filtersResolved = payload.data?.filtersResolved
  const endDate = filtersResolved && typeof filtersResolved.endDate === 'string' ? filtersResolved.endDate : ''
  if (
    typeof latestAvailableCollectionDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(latestAvailableCollectionDate) &&
    endDate
  ) {
    if (endDate < latestAvailableCollectionDate) return false
    if (endDate > latestAvailableCollectionDate) return false
  }
  const melbourne = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' })
  const today = melbourne.format(new Date(nowMs))
  const yesterday = melbourne.format(new Date(nowMs - 86400000))
  return endDate === today || endDate === yesterday || endDate === latestAvailableCollectionDate
}

describe('middleware snapshotPayloadFresh', () => {
  const nowMs = new Date('2026-06-07T02:00:00.000Z').getTime()

  it('accepts yesterday endDate when latest available meta is absent', () => {
    expect(
      snapshotPayloadFresh(
        {
          builtAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
          data: { filtersResolved: { endDate: '2026-06-06' } },
        },
        null,
        nowMs,
      ),
    ).toBe(true)
  })

  it('rejects yesterday endDate when latest available advanced after ingest', () => {
    expect(
      snapshotPayloadFresh(
        {
          builtAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
          data: { filtersResolved: { endDate: '2026-06-06' } },
        },
        '2026-06-07',
        nowMs,
      ),
    ).toBe(false)
  })

  it('accepts endDate matching latest available collection date', () => {
    expect(
      snapshotPayloadFresh(
        {
          builtAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
          data: { filtersResolved: { endDate: '2026-06-07' } },
        },
        '2026-06-07',
        nowMs,
      ),
    ).toBe(true)
  })

  it('rejects endDate ahead of latest available collection date even when it is today', () => {
    expect(
      snapshotPayloadFresh(
        {
          builtAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
          data: { filtersResolved: { endDate: '2026-06-07' } },
        },
        '2026-06-06',
        nowMs,
      ),
    ).toBe(false)
  })
})
