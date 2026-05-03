import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getCachedOrCompute, resolveChartDateRangeFromDb, writeD1ChartCache } from '../../src/db/chart-cache'
import { getReadDbFromEnv } from '../../src/db/read-db'
import { queryReportPlotPayload } from '../../src/db/report-plot'
import { writeD1ReportPlotCache } from '../../src/db/report-plot-cache'
import { getLatestCompletedDailyRunFinishedAt } from '../../src/db/run-reports'
import { resolveFiltersForScope } from '../../src/db/scope-filters'
import { writeSnapshotKvBundles } from '../../src/db/snapshot-cache'
import {
  collectHomeLoanAnalyticsRowsResolved,
  collectSavingsAnalyticsRowsResolved,
} from '../../src/routes/analytics-data'
import { buildSnapshotPayload } from '../../src/routes/snapshot-public'

async function latestSourceRunFinishedAt(): Promise<string | null> {
  try {
    return await getLatestCompletedDailyRunFinishedAt(env.DB)
  } catch {
    return null
  }
}

async function warmTargetedPublicCaches() {
  const sourceRunFinishedAt = await latestSourceRunFinishedAt()
  const rd = getReadDbFromEnv(env)
  const dbs = { canonicalDb: rd, analyticsDb: rd }

  const snapshotScope = 'preset:consumer-default:window:90D'
  const snapshot = await buildSnapshotPayload(env, 'home_loans', snapshotScope, { sourceRunFinishedAt })
  await writeSnapshotKvBundles(env.CHART_CACHE_KV, 'home_loans', snapshotScope, snapshot)

  const savingsScope = 'preset:consumer-default:window:90D'
  const savingsFilters = await resolveFiltersForScope(rd, 'savings', savingsScope)
  const savingsResult = await collectSavingsAnalyticsRowsResolved(dbs, 'change', {
    ...savingsFilters,
    disableRowCap: true,
    chartInternalRefresh: true,
  })
  await writeD1ChartCache(env.DB, 'savings', 'change', savingsScope, savingsResult, {
    filtersResolved: { startDate: savingsFilters.startDate, endDate: savingsFilters.endDate },
    sourceRunFinishedAt,
  })

  const reportScope = 'preset:consumer-default:window:1Y'
  const reportFilters = await resolveFiltersForScope(rd, 'home_loans', reportScope)
  const reportPayload = await queryReportPlotPayload(rd, 'home_loans', 'moves', reportFilters)
  await writeD1ReportPlotCache(env.DB, 'home_loans', 'moves', reportScope, reportPayload, { sourceRunFinishedAt })
}

describe('analytics cache headers', () => {
  it('does not persist D1 chart cache rows from a public live compute fallback', async () => {
    await env.DB
      .prepare(
        `DELETE FROM chart_request_cache
         WHERE section = 'home_loans'
           AND representation = 'day'
           AND request_scope = 'default'`,
      )
      .run()

    const result = await getCachedOrCompute(
      { DB: env.DB },
      'home_loans',
      'day',
      {},
      async () => {
        const filters = await resolveChartDateRangeFromDb(env.DB, 'home_loans', {})
        const rows = await collectHomeLoanAnalyticsRowsResolved(
          { canonicalDb: env.DB, analyticsDb: env.DB },
          'day',
          filters,
        )
        return {
          rows: rows.rows,
          representation: rows.representation,
          fallbackReason: rows.fallbackReason,
        }
      },
    )

    expect(result.fromCache).toBe('live')

    const row = await env.DB
      .prepare(
        `SELECT COUNT(*) AS count
         FROM chart_request_cache
         WHERE section = 'home_loans'
           AND representation = 'day'
           AND request_scope = 'default'`,
      )
      .first<{ count: number }>()
    expect(Number(row?.count ?? 0)).toBe(0)
  })

  it('serves warmed default analytics and report caches from KV or D1', async () => {
    await warmTargetedPublicCaches()

    const homeLoanUrl =
      'https://example.com/api/home-loan-rates/analytics/series?compact=1&representation=day&sort=collection_date&dir=asc&security_purpose=owner_occupied&repayment_type=principal_and_interest&rate_structure=variable&lvr_tier=lvr_80-85%&min_rate=0.01'
    const homeLoanFirstResponse = await SELF.fetch(homeLoanUrl)

    expect(homeLoanFirstResponse.status).toBe(200)
    expect(homeLoanFirstResponse.headers.get('X-AR-Cache')).toBe('kv')
    expect(homeLoanFirstResponse.headers.get('X-AR-Analytics-Source')).toBe('snapshot')
    expect(homeLoanFirstResponse.headers.get('X-AR-Snapshot-Scope')).toBe('preset:consumer-default:window:90D')

    const homeLoanJson = (await homeLoanFirstResponse.json()) as {
      ok?: boolean
      representation?: string
      rows?: unknown[]
      rows_format?: string
      grouped_rows?: { version?: number; groups?: unknown[] }
    }

    expect(homeLoanJson.ok).toBe(true)
    expect(homeLoanJson.representation).toBe('day')
    expect(homeLoanJson.rows_format).toBe('grouped_v1')
    expect(Array.isArray(homeLoanJson.rows)).toBe(true)
    expect(homeLoanJson.grouped_rows?.version).toBe(1)
    expect(Array.isArray(homeLoanJson.grouped_rows?.groups)).toBe(true)

    const homeLoanSecondResponse = await SELF.fetch(homeLoanUrl)
    expect(homeLoanSecondResponse.status).toBe(200)
    expect(homeLoanSecondResponse.headers.get('X-AR-Cache')).toBe('kv')
    expect(homeLoanSecondResponse.headers.get('X-AR-Analytics-Source')).toBe('snapshot')
    await homeLoanSecondResponse.text()

    const savingsResponse = await SELF.fetch(
      'https://example.com/api/savings-rates/analytics/series?compact=1&representation=change&sort=collection_date&dir=asc&account_type=savings&chart_window=90D&min_rate=0.01',
    )

    expect(savingsResponse.status).toBe(200)
    expect(savingsResponse.headers.get('X-AR-Cache')).toBe('d1')

    const savingsJson = (await savingsResponse.json()) as {
      ok?: boolean
      requested_representation?: string
      rows_format?: string
      grouped_rows?: { version?: number; groups?: unknown[] }
    }

    expect(savingsJson.ok).toBe(true)
    expect(savingsJson.requested_representation).toBe('change')
    expect(savingsJson.rows_format).toBe('grouped_v1')
    expect(savingsJson.grouped_rows?.version).toBe(1)
    expect(Array.isArray(savingsJson.grouped_rows?.groups)).toBe(true)

    const filteredResponse = await SELF.fetch(
      'https://example.com/api/home-loan-rates/analytics/series?compact=1&representation=day&sort=collection_date&dir=asc&security_purpose=owner_occupied&repayment_type=principal_and_interest&rate_structure=variable&lvr_tier=lvr_80-85%&min_rate=0.01&bank=ANZ',
    )

    expect(filteredResponse.status).toBe(200)
    expect(filteredResponse.headers.get('X-AR-Cache')).toBe('live')
    await filteredResponse.text()

    const reportUrl =
      'https://example.com/api/home-loan-rates/analytics/report-plot?mode=moves&security_purpose=owner_occupied&repayment_type=principal_and_interest&rate_structure=variable&lvr_tier=lvr_80-85%&chart_window=1Y&min_rate=0.01'
    const reportFirstResponse = await SELF.fetch(reportUrl)

    expect(reportFirstResponse.status).toBe(200)
    expect(reportFirstResponse.headers.get('X-AR-Cache')).toBe('d1')
    const reportJson = (await reportFirstResponse.json()) as {
      ok?: boolean
      mode?: string
      points?: unknown[]
    }

    expect(reportJson.ok).toBe(true)
    expect(reportJson.mode).toBe('moves')
    expect(Array.isArray(reportJson.points)).toBe(true)

    const reportSecondResponse = await SELF.fetch(reportUrl)
    expect(reportSecondResponse.status).toBe(200)
    expect(reportSecondResponse.headers.get('X-AR-Cache')).toBe('kv')
    await reportSecondResponse.text()
  })
})
