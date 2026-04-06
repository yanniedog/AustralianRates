import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { runEconomicCoverageAudit } from '../../src/db/economic-coverage-audit'
import { insertHealthCheckRun } from '../../src/db/health-check-runs'
import { upsertEconomicObservations, upsertEconomicStatus } from '../../src/db/economic-series'
import { parseRbaTableCsv, extractRbaSeriesObservations } from '../../src/economic/rba-table'
import { ECONOMIC_SERIES_DEFINITIONS } from '../../src/economic/registry'
import g3Fixture from '../fixtures/economic/rba-g3.csv?raw'
import h3Fixture from '../fixtures/economic/rba-h3.csv?raw'

function adminHeaders() {
  return {
    Authorization: `Bearer ${String(env.ADMIN_API_TOKEN || '').trim()}`,
    'Content-Type': 'application/json',
  }
}

async function clearEconomicTables() {
  await env.DB.prepare('DELETE FROM economic_series_observations').run()
  await env.DB.prepare('DELETE FROM economic_series_status').run()
  await env.DB.prepare('DELETE FROM health_check_runs').run()
  await env.DB.prepare('DELETE FROM integrity_audit_runs').run()
}

beforeEach(async () => {
  await clearEconomicTables()
})

describe('economic admin coverage', () => {
  it('runs economic coverage audit against real D1 rows', async () => {
    const table = parseRbaTableCsv(h3Fixture, 'https://www.rba.gov.au/statistics/tables/csv/h3-data.csv')
    const rows = extractRbaSeriesObservations(table, 'consumer_sentiment', 'GICWMICS', false)
    await upsertEconomicObservations(env.DB, rows)
    await upsertEconomicStatus(env.DB, {
      seriesId: 'consumer_sentiment',
      lastCheckedAt: '2010-03-02T00:00:00.000Z',
      lastSuccessAt: '2010-03-02T00:00:00.000Z',
      lastObservationDate: '2010-02-28',
      lastValue: 117,
      status: 'ok',
      message: 'Loaded from fixture.',
      sourceUrl: 'https://www.rba.gov.au/statistics/tables/csv/h3-data.csv',
      proxy: false,
    })
    await upsertEconomicStatus(env.DB, {
      seriesId: 'unknown_series',
      lastCheckedAt: '2010-03-02T00:00:00.000Z',
      lastSuccessAt: '2010-03-02T00:00:00.000Z',
      lastObservationDate: '2010-02-28',
      lastValue: 1,
      status: 'ok',
      message: 'Unknown row.',
      sourceUrl: 'https://example.com/unknown',
      proxy: false,
    })

    const report = await runEconomicCoverageAudit(env.DB, { checkedAt: '2010-03-02T00:00:00.000Z' })
    expect(report.summary.defined_series).toBe(ECONOMIC_SERIES_DEFINITIONS.length)
    expect(report.summary.status_rows).toBe(2)
    expect(report.findings.some((finding) => finding.code === 'economic_unknown_status_rows')).toBe(true)
    expect(report.findings.some((finding) => finding.code === 'economic_missing_status_rows')).toBe(true)
    const consumerSentiment = report.per_series.find((row) => row.series_id === 'consumer_sentiment')
    expect(consumerSentiment?.observation_row_count).toBeGreaterThan(0)
    expect(consumerSentiment?.stored_status).toBe('ok')
  })

  it('does not treat RBA publication metadata as a release-before-observation failure', async () => {
    const sentimentTable = parseRbaTableCsv(h3Fixture, 'https://www.rba.gov.au/statistics/tables/csv/h3-data.csv')
    const inflationTable = parseRbaTableCsv(g3Fixture, 'https://www.rba.gov.au/statistics/tables/csv/g3-data.csv')
    const sentimentRows = extractRbaSeriesObservations(sentimentTable, 'consumer_sentiment', 'GICWMICS', false)
    const inflationRows = extractRbaSeriesObservations(inflationTable, 'inflation_expectations', 'GCONEXP', false)
    await upsertEconomicObservations(env.DB, [...sentimentRows, ...inflationRows])

    for (const rows of [sentimentRows, inflationRows]) {
      const latest = rows[rows.length - 1]
      await upsertEconomicStatus(env.DB, {
        seriesId: latest.seriesId,
        lastCheckedAt: '2026-04-06T00:00:00.000Z',
        lastSuccessAt: '2026-04-06T00:00:00.000Z',
        lastObservationDate: latest.observationDate,
        lastValue: latest.value,
        status: 'ok',
        message: 'Loaded from real RBA fixture.',
        sourceUrl: latest.sourceUrl,
        proxy: latest.proxy,
      })
    }

    const report = await runEconomicCoverageAudit(env.DB, { checkedAt: '2026-04-06T00:00:00.000Z' })
    expect(report.findings.some((finding) => finding.code === 'economic_release_before_observation')).toBe(false)
    expect(report.per_series.find((row) => row.series_id === 'consumer_sentiment')?.issues).not.toContain(
      'release_before_observation',
    )
    expect(report.per_series.find((row) => row.series_id === 'inflation_expectations')?.issues).not.toContain(
      'release_before_observation',
    )
  })

  it('returns economic summary from admin health history', async () => {
    // Must be within pruneHealthCheckRuns retention (1 day) or the row is deleted before GET /admin/health runs.
    const checkedAt = new Date().toISOString()
    const report = await runEconomicCoverageAudit(env.DB, { checkedAt })
    await insertHealthCheckRun(env.DB, {
      runId: 'health:test:economic',
      checkedAt,
      triggerSource: 'manual',
      overallOk: false,
      durationMs: 25,
      componentsJson: '[]',
      integrityJson: '{"ok":true,"checks":[]}',
      economicJson: JSON.stringify(report),
      e2eJson: JSON.stringify({
        aligned: true,
        reasonCode: 'ok',
        checkedAt,
        targetCollectionDate: null,
        sourceMode: 'all',
        datasets: [],
        criteria: { scheduler: true, runsProgress: true, apiServesLatest: true },
      }),
      e2eAligned: true,
      e2eReasonCode: 'ok',
      e2eReasonDetail: null,
      actionableJson: '[]',
      failuresJson: '[]',
    })

    const response = await SELF.fetch('https://example.com/api/home-loan-rates/admin/health?limit=5', {
      headers: adminHeaders(),
    })
    expect(response.status).toBe(200)
    const json = await response.json() as {
      latest?: { economic?: { summary?: { defined_series?: number } } }
    }
    expect(json.latest?.economic?.summary?.defined_series).toBe(ECONOMIC_SERIES_DEFINITIONS.length)
  })

  it('includes economic findings in integrity audit responses', async () => {
    const response = await SELF.fetch('https://example.com/api/home-loan-rates/admin/integrity-audit/run', {
      method: 'POST',
      headers: adminHeaders(),
    })
    expect(response.status).toBe(200)
    const json = await response.json() as {
      findings?: Array<{ check?: string }>
    }
    expect((json.findings ?? []).some((finding) => String(finding.check || '').startsWith('economic_'))).toBe(true)
  })

  it('lists economic tables and blocks mutation through admin db routes', async () => {
    const tablesResponse = await SELF.fetch('https://example.com/api/home-loan-rates/admin/db/tables?counts=true', {
      headers: adminHeaders(),
    })
    expect(tablesResponse.status).toBe(200)
    const tablesJson = await tablesResponse.json() as {
      tables?: Array<{ name?: string; read_only?: boolean }>
    }
    expect(tablesJson.tables?.some((table) => table.name === 'economic_series_observations' && table.read_only)).toBe(true)
    expect(tablesJson.tables?.some((table) => table.name === 'economic_series_status' && table.read_only)).toBe(true)

    const schemaResponse = await SELF.fetch('https://example.com/api/home-loan-rates/admin/db/tables/economic_series_status/schema', {
      headers: adminHeaders(),
    })
    expect(schemaResponse.status).toBe(200)
    const schemaJson = await schemaResponse.json() as { read_only?: boolean }
    expect(schemaJson.read_only).toBe(true)

    const insertResponse = await SELF.fetch('https://example.com/api/home-loan-rates/admin/db/tables/economic_series_status/rows', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        series_id: 'consumer_sentiment',
        last_checked_at: '2026-03-26T00:00:00.000Z',
      }),
    })
    expect(insertResponse.status).toBe(400)
    const insertJson = await insertResponse.json() as { error?: { code?: string } }
    expect(insertJson.error?.code).toBe('TABLE_READ_ONLY')
  })
})
