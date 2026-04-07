import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { refreshChartPivotCache } from '../../src/pipeline/chart-cache-refresh'
import savingsWarmupSeedSql from './report-plot-warmup-seed.sql?raw'

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

  it('serializes first-load report-plot warm-up for parallel requests', async () => {
    // Rows shaped from test/fixtures/real-normalized-savings-row.json; two collection dates
    // so savings_report_deltas refresh yields at least one delta (integration DB is migration-only).
    const bank = 'ANZ'
    const productId = 'sav-1'
    const d1 = '2025-02-20'
    const d2 = '2025-02-21'
    const seriesKey = `${bank}|${productId}|savings|base|all`

    await env.DB
      .prepare('DELETE FROM historical_savings_rates WHERE bank_name = ? AND product_id = ? AND collection_date IN (?, ?)')
      .bind(bank, productId, d1, d2)
      .run()

    const insertSql = String(savingsWarmupSeedSql).trim()
    await env.DB.prepare(insertSql)
      .bind(
        bank,
        d1,
        productId,
        'ANZ Online Savings Account',
        seriesKey,
        4.5,
        'https://example.com/savings',
        `${d1}T00:00:00.000Z`,
      )
      .run()
    await env.DB.prepare(insertSql)
      .bind(
        bank,
        d2,
        productId,
        'ANZ Online Savings Account',
        seriesKey,
        4.6,
        'https://example.com/savings',
        `${d2}T00:00:00.000Z`,
      )
      .run()

    try {
      await env.DB.prepare('DELETE FROM savings_report_deltas').run()
      // Default chart_window requests use D1 report-plot cache; clear so compute() runs and repopulates deltas.
      await env.DB
        .prepare(
          `DELETE FROM report_plot_request_cache WHERE section = ? AND request_scope = ?`,
        )
        .bind('savings', 'window:90D')
        .run()

      const [movesResponse, bandsResponse] = await Promise.all([
        SELF.fetch('https://example.com/api/savings-rates/analytics/report-plot?mode=moves&chart_window=90D'),
        SELF.fetch('https://example.com/api/savings-rates/analytics/report-plot?mode=bands&chart_window=90D'),
      ])

      expect(movesResponse.status).toBe(200)
      expect(bandsResponse.status).toBe(200)

      const row = await env.DB
        .prepare('SELECT COUNT(*) AS n FROM savings_report_deltas')
        .first<{ n: number }>()

      expect(Number(row?.n || 0)).toBeGreaterThan(0)
    } finally {
      await env.DB
        .prepare('DELETE FROM historical_savings_rates WHERE bank_name = ? AND product_id = ? AND collection_date IN (?, ?)')
        .bind(bank, productId, d1, d2)
        .run()
    }
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
