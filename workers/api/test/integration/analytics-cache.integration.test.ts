import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { refreshChartPivotCache } from '../../src/pipeline/chart-cache-refresh'

async function warmChartCache() {
  const result = await refreshChartPivotCache(env)
  expect(result.ok).toBe(true)
}

describe('analytics cache headers', () => {
  it('serves home-loan consumer default series from D1 after refresh', async () => {
    await warmChartCache()

    const response = await SELF.fetch(
      'https://example.com/api/home-loan-rates/analytics/series?compact=1&representation=day&sort=collection_date&dir=asc&security_purpose=owner_occupied&repayment_type=principal_and_interest&rate_structure=variable&lvr_tier=lvr_80-85%&min_rate=0.01',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-AR-Cache')).toBe('d1')

    const json = (await response.json()) as {
      ok?: boolean
      representation?: string
      rows?: unknown[]
      rows_format?: string
      grouped_rows?: { version?: number; groups?: unknown[] }
    }

    expect(json.ok).toBe(true)
    expect(json.representation).toBe('day')
    expect(json.rows_format).toBe('grouped_v1')
    expect(Array.isArray(json.rows)).toBe(true)
    expect(json.grouped_rows?.version).toBe(1)
    expect(Array.isArray(json.grouped_rows?.groups)).toBe(true)
  })

  it('serves savings consumer default chart-window series from D1 after refresh', async () => {
    await warmChartCache()

    const response = await SELF.fetch(
      'https://example.com/api/savings-rates/analytics/series?compact=1&representation=change&sort=collection_date&dir=asc&account_type=savings&chart_window=90D&min_rate=0.01',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-AR-Cache')).toBe('d1')

    const json = (await response.json()) as {
      ok?: boolean
      requested_representation?: string
      rows_format?: string
      grouped_rows?: { version?: number; groups?: unknown[] }
    }

    expect(json.ok).toBe(true)
    expect(json.requested_representation).toBe('change')
    expect(json.rows_format).toBe('grouped_v1')
    expect(json.grouped_rows?.version).toBe(1)
    expect(Array.isArray(json.grouped_rows?.groups)).toBe(true)
  })

  it('keeps filtered series requests on the live path', async () => {
    await warmChartCache()

    const response = await SELF.fetch(
      'https://example.com/api/home-loan-rates/analytics/series?compact=1&representation=day&sort=collection_date&dir=asc&security_purpose=owner_occupied&repayment_type=principal_and_interest&rate_structure=variable&lvr_tier=lvr_80-85%&min_rate=0.01&bank=ANZ',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-AR-Cache')).toBe('live')
  })

  it('serves report-plot preset requests from D1 after refresh', async () => {
    await warmChartCache()

    const response = await SELF.fetch(
      'https://example.com/api/home-loan-rates/analytics/report-plot?mode=moves&security_purpose=owner_occupied&repayment_type=principal_and_interest&rate_structure=variable&lvr_tier=lvr_80-85%&chart_window=1Y&min_rate=0.01',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-AR-Cache')).toBe('d1')

    const json = (await response.json()) as {
      ok?: boolean
      mode?: string
      points?: unknown[]
    }

    expect(json.ok).toBe(true)
    expect(json.mode).toBe('moves')
    expect(Array.isArray(json.points)).toBe(true)
  })
})
