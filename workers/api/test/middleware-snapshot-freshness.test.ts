import { describe, expect, it } from 'vitest'

/**
 * Mirror of `snapshotPayloadFresh` in `functions/_middleware.js` and `site/functions/_middleware.js`.
 */
function snapshotPayloadFresh(
  payload: {
    builtAt?: string
    sourceRunFinishedAt?: string | null
    data?: { filtersResolved?: { endDate?: string } }
  } | null,
  latestAvailableCollectionDate: string | null,
  latestRunFinishedAt: string | null,
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
  const sourceRunMs = new Date(String(payload.sourceRunFinishedAt || '')).getTime()
  const latestRunMs = new Date(String(latestRunFinishedAt || '')).getTime()
  if (Number.isFinite(sourceRunMs) && Number.isFinite(latestRunMs) && sourceRunMs < latestRunMs) {
    return false
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
        null,
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
        null,
        nowMs,
      ),
    ).toBe(true)
  })

  it('rejects endDate ahead of latest available collection date meta', () => {
    expect(
      snapshotPayloadFresh(
        {
          builtAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
          data: { filtersResolved: { endDate: '2026-06-07' } },
        },
        '2026-06-06',
        null,
        nowMs,
      ),
    ).toBe(false)
  })

  it('rejects snapshot built before the latest completed daily run watermark', () => {
    expect(
      snapshotPayloadFresh(
        {
          builtAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
          sourceRunFinishedAt: '2026-06-07T06:00:00.000Z',
          data: { filtersResolved: { endDate: '2026-06-07' } },
        },
        '2026-06-07',
        '2026-06-07T07:30:00.000Z',
        nowMs,
      ),
    ).toBe(false)
  })

  it('accepts snapshot when sourceRunFinishedAt matches latest run watermark', () => {
    expect(
      snapshotPayloadFresh(
        {
          builtAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
          sourceRunFinishedAt: '2026-06-07T07:30:00.000Z',
          data: { filtersResolved: { endDate: '2026-06-07' } },
        },
        '2026-06-07',
        '2026-06-07T07:30:00.000Z',
        nowMs,
      ),
    ).toBe(true)
  })
})
