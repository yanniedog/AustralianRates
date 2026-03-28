import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { upsertRbaCashRate } from '../../src/db/rba-cash-rate'
import { collectRbaCashRateForDate } from '../../src/ingest/rba'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RBA collection integration', () => {
  it('falls back to the nearest stored rate when upstream sources are unavailable', async () => {
    await upsertRbaCashRate(env.DB, {
      collectionDate: '2099-01-01',
      cashRate: 4.35,
      effectiveDate: '2098-12-15',
      sourceUrl: 'https://www.rba.gov.au/statistics/cash-rate/',
    })

    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1
      return new Response('blocked', { status: 403 })
    })

    const result = await collectRbaCashRateForDate(env.DB, '2099-01-01', {
      FETCH_MAX_RETRIES: '0',
    })

    // One attempt each for HTML decisions page and F1 CSV (no fetch retries; retries are tested in unit tests).
    expect(calls).toBe(2)
    expect(result).toEqual({
      ok: true,
      cashRate: 4.35,
      effectiveDate: '2098-12-15',
      sourceUrl: 'https://www.rba.gov.au/statistics/cash-rate/',
      fallbackToStored: true,
    })
  })
})
