import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('chart-data routes', () => {
  it('returns stable 400 for invalid home-loan lvr', async () => {
    const response = await SELF.fetch(
      'https://example.com/api/home-loan-rates/chart-data?lvr=101&repaymentType=P%26I&occupancy=Owner&offset=false',
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as {
      ok?: boolean
      error?: { code?: string }
    }
    expect(json.ok).toBe(false)
    expect(json.error?.code).toBe('INVALID_LVR')
  })

  it('returns empty but valid home-loan chart payload when no real rows match', async () => {
    const response = await SELF.fetch(
      'https://example.com/api/home-loan-rates/chart-data?lvr=80&repaymentType=P%26I&occupancy=Owner&offset=false&startDate=1900-01-01&endDate=1900-12-31',
    )
    expect(response.status).toBe(200)
    const json = (await response.json()) as {
      series?: unknown[]
      events?: unknown[]
    }
    expect(Array.isArray(json.series)).toBe(true)
    expect(Array.isArray(json.events)).toBe(true)
    expect((json.series ?? []).length).toBe(0)
  })

  it('returns empty but valid savings chart payload when no real rows match', async () => {
    const response = await SELF.fetch(
      'https://example.com/api/savings-rates/chart-data?startDate=1900-01-01&endDate=1900-12-31',
    )
    expect(response.status).toBe(200)
    const json = (await response.json()) as {
      series?: unknown[]
      events?: unknown[]
    }
    expect(Array.isArray(json.series)).toBe(true)
    expect(Array.isArray(json.events)).toBe(true)
    expect((json.series ?? []).length).toBe(0)
  })

  it('returns empty but valid term-deposit chart payload when no real rows match', async () => {
    const response = await SELF.fetch(
      'https://example.com/api/term-deposit-rates/chart-data?startDate=1900-01-01&endDate=1900-12-31',
    )
    expect(response.status).toBe(200)
    const json = (await response.json()) as {
      series?: unknown[]
      events?: unknown[]
    }
    expect(Array.isArray(json.series)).toBe(true)
    expect(Array.isArray(json.events)).toBe(true)
    expect((json.series ?? []).length).toBe(0)
  })

  it.todo('returns OFFSET_FIELD_UNAVAILABLE when the requested home-loan slice still has unknown has_offset_account values in real D1 data')
})
