import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { refreshChartPivotCache } from '../../src/pipeline/chart-cache-refresh'

describe('report-plot routes', () => {
  it('returns empty but valid home-loan moves payload when no real rows match', async () => {
    const response = await SELF.fetch(
      'https://example.com/api/home-loan-rates/analytics/report-plot?mode=moves&start_date=1900-01-01&end_date=1900-12-31',
    )
    expect(response.status).toBe(200)
    const json = (await response.json()) as {
      mode?: string
      points?: unknown[]
      meta?: { section?: string }
    }
    expect(json.mode).toBe('moves')
    expect(Array.isArray(json.points)).toBe(true)
    expect(json.meta?.section).toBe('home_loans')
  })

  it('returns empty but valid savings bands payload when no real rows match', async () => {
    const response = await SELF.fetch(
      'https://example.com/api/savings-rates/analytics/report-plot?mode=bands&start_date=1900-01-01&end_date=1900-12-31',
    )
    expect(response.status).toBe(200)
    const json = (await response.json()) as {
      mode?: string
      series?: unknown[]
      meta?: { section?: string }
    }
    expect(json.mode).toBe('bands')
    expect(Array.isArray(json.series)).toBe(true)
    expect(json.meta?.section).toBe('savings')
  })

  it('returns term-deposit report-plot meta with resolved term in payload meta', async () => {
    const response = await SELF.fetch(
      'https://example.com/api/term-deposit-rates/analytics/report-plot?mode=moves&start_date=1900-01-01&end_date=1900-12-31',
    )
    expect(response.status).toBe(200)
    const json = (await response.json()) as {
      mode?: string
      points?: unknown[]
      meta?: { section?: string; resolved_term_months?: number | null }
    }
    expect(json.mode).toBe('moves')
    expect(Array.isArray(json.points)).toBe(true)
    expect(json.meta?.section).toBe('term_deposits')
    expect(json.meta?.resolved_term_months ?? null).toBeNull()
  })
})

describe('report-plot cache refresh', () => {
  it('precomputes report-plot cache rows for default scopes', async () => {
    const result = await refreshChartPivotCache(env)
    expect(result.ok).toBe(true)

    const row = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM report_plot_request_cache')
      .first<{ n: number }>()

    expect(Number(row?.n || 0)).toBe(36)
  })
})
