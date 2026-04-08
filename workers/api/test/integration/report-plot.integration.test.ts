import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { reportPlotTestState } from '../../src/db/report-plot'
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

  it('returns min/max actual rates per bank per day in savings bands', async () => {
    const bank = 'ANZ'
    const d1 = '2025-02-20'
    const d2 = '2025-02-21'
    const productIds = ['sav-band-1', 'sav-band-2']
    const seriesKeys = [
      `${bank}|sav-band-1|savings|base|all`,
      `${bank}|sav-band-2|savings|base|all`,
    ]

    await env.DB
      .prepare('DELETE FROM historical_savings_rates WHERE bank_name = ? AND product_id IN (?, ?) AND collection_date IN (?, ?)')
      .bind(bank, productIds[0], productIds[1], d1, d2)
      .run()

    const insertSql = String(savingsWarmupSeedSql).trim()
    await env.DB.prepare(insertSql)
      .bind(bank, d1, productIds[0], 'ANZ Online Savings Account', seriesKeys[0], 4.5, 'https://example.com/savings', `${d1}T00:00:00.000Z`)
      .run()
    await env.DB.prepare(insertSql)
      .bind(bank, d2, productIds[0], 'ANZ Online Savings Account', seriesKeys[0], 4.6, 'https://example.com/savings', `${d2}T00:00:00.000Z`)
      .run()
    await env.DB.prepare(insertSql)
      .bind(bank, d1, productIds[1], 'ANZ Progress Saver', seriesKeys[1], 4.4, 'https://example.com/savings', `${d1}T00:00:00.000Z`)
      .run()
    await env.DB.prepare(insertSql)
      .bind(bank, d2, productIds[1], 'ANZ Progress Saver', seriesKeys[1], 4.4, 'https://example.com/savings', `${d2}T00:00:00.000Z`)
      .run()

    try {
      await env.DB.prepare('DELETE FROM savings_report_deltas').run()
      await env.DB
        .prepare('DELETE FROM report_plot_request_cache WHERE section = ?')
        .bind('savings')
        .run()

      const response = await SELF.fetch(
        'https://example.com/api/savings-rates/analytics/report-plot?mode=bands&chart_window=90D',
      )

      expect(response.status).toBe(200)
      const json = (await response.json()) as {
        mode?: string
        series?: Array<{
          bank_name?: string
          points?: Array<{
            date?: string
            min_rate?: number
            max_rate?: number
          }>
        }>
      }

      const anz = (json.series || []).find((entry) => entry.bank_name === bank)
      const targetPoint = (anz?.points || []).find((point) => point.date === d2)

      expect(json.mode).toBe('bands')
      // Both products included (unchanged product not filtered): min=4.4, max=4.6
      expect(targetPoint).toMatchObject({
        date: d2,
        min_rate: 4.4,
        max_rate: 4.6,
      })
    } finally {
      await env.DB
        .prepare('DELETE FROM historical_savings_rates WHERE bank_name = ? AND product_id IN (?, ?) AND collection_date IN (?, ?)')
        .bind(bank, productIds[0], productIds[1], d1, d2)
        .run()
      await env.DB
        .prepare('DELETE FROM report_plot_request_cache WHERE section = ?')
        .bind('savings')
        .run()
    }
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
      reportPlotTestState.refreshCountBySection.clear()
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
      const lockRow = await env.DB
        .prepare('SELECT COUNT(*) AS n FROM report_plot_refresh_locks WHERE section = ?')
        .bind('savings')
        .first<{ n: number }>()

      expect(Number(row?.n || 0)).toBeGreaterThan(0)
      expect(reportPlotTestState.refreshCountBySection.get('savings') ?? 0).toBe(1)
      expect(Number(lockRow?.n || 0)).toBe(0)
    } finally {
      reportPlotTestState.refreshCountBySection.clear()
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

    expect(Number(row?.n || 0)).toBe(60)
  })
})
