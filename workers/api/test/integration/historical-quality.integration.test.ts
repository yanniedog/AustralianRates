import { SELF, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import manifest from '../fixtures/historical-quality/production-slice-20260318-20260401.manifest.json'
import { gzipBase64 } from '../fixtures/historical-quality/production-slice-20260318-20260401.fixture'
import { loadHistoricalQualityFixture, resetHistoricalQualityFixtureTables } from './historical-quality-fixture'

function adminHeaders() {
  return {
    Authorization: `Bearer ${String(env.ADMIN_API_TOKEN || '').trim()}`,
    'Content-Type': 'application/json',
  }
}

beforeAll(async () => {
  await resetHistoricalQualityFixtureTables()
  await loadHistoricalQualityFixture(gzipBase64)
}, 60000)

describe('historical quality audit integration', () => {
  it('runs the worker audit path against a real production slice fixture', async () => {
    const startResponse = await SELF.fetch('https://example.com/api/home-loan-rates/admin/audits/historical-quality/run', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        start_date: manifest.start_date,
        end_date: manifest.end_date,
      }),
    })
    expect(startResponse.status).toBe(200)
    const started = await startResponse.json() as {
      created?: { auditRunId?: string }
      detail?: { run?: { status?: string } }
    }
    const auditRunId = String(started.created?.auditRunId || '').trim()
    expect(auditRunId).not.toBe('')

    let status = String(started.detail?.run?.status || '')
    let lastError = String((started.detail?.run as { last_error?: string } | undefined)?.last_error || '')
    for (let attempt = 0; attempt < 50 && status !== 'completed'; attempt += 1) {
      const resumeResponse = await SELF.fetch('https://example.com/api/home-loan-rates/admin/audits/historical-quality/resume', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ audit_run_id: auditRunId }),
      })
      expect(resumeResponse.status).toBe(200)
      const resumed = await resumeResponse.json() as { detail?: { run?: { status?: string; last_error?: string } } }
      status = String(resumed.detail?.run?.status || '')
      lastError = String(resumed.detail?.run?.last_error || '')
    }
    expect(status, lastError).toBe('completed')

    const detailResponse = await SELF.fetch(`https://example.com/api/home-loan-rates/admin/audits/historical-quality/${encodeURIComponent(auditRunId)}`, {
      headers: adminHeaders(),
    })
    expect(detailResponse.status).toBe(200)
    const detail = await detailResponse.json() as {
      run?: { summary?: { cutoff_candidates?: unknown } }
      daily?: Array<{ collection_date?: string; scope?: string; evidence_confidence_score_v1?: number }>
      findings?: Array<{ criterion_code?: string }>
    }

    const daily = detail.daily ?? []
    expect(daily.some((row) => row.collection_date === '2026-03-29' && row.scope === 'home_loans')).toBe(true)
    expect(daily.some((row) => row.collection_date === '2026-03-30' && row.scope === 'home_loans')).toBe(true)
    expect(daily.some((row) => row.scope === 'overall')).toBe(true)
    expect((detail.findings ?? []).some((finding) => finding.criterion_code === 'product_id_churn')).toBe(true)
    expect((detail.findings ?? []).length).toBeGreaterThan(0)
    expect(detail.run?.summary?.cutoff_candidates).toBeTruthy()
  }, 60000)

  it('returns a retention size audit report from the admin route', async () => {
    const response = await SELF.fetch('https://example.com/api/home-loan-rates/admin/audits/historical-quality/retention-size-audit', {
      headers: adminHeaders(),
    })
    expect(response.status).toBe(200)
    const json = await response.json() as {
      current_backend_retention_days?: number
      fetch_events_retention_days?: number
      evidence_backfill?: { has_permanent_evidence_backfill?: boolean }
      raw_run_state_projection?: { candidates?: Array<{ candidate_days?: number }>; recommendation?: { recommended_days?: number } }
      tables?: Array<{ name?: string }>
    }
    expect(json.current_backend_retention_days).toBe(30)
    expect(json.fetch_events_retention_days).toBe(3650)
    expect(Array.isArray(json.raw_run_state_projection?.candidates)).toBe(true)
    expect((json.raw_run_state_projection?.candidates ?? []).map((row) => row.candidate_days)).toEqual([7, 14, 30])
    expect((json.tables ?? []).some((table) => table.name === 'run_reports')).toBe(true)
    expect((json.tables ?? []).some((table) => table.name === 'historical_provenance_recovery_log')).toBe(true)
    expect(typeof json.evidence_backfill?.has_permanent_evidence_backfill).toBe('boolean')
    expect([7, 14, 30]).toContain(Number(json.raw_run_state_projection?.recommendation?.recommended_days ?? 0))
  })
})
