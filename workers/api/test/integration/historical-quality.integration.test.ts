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

async function ensureHistoricalQualityAuditRun(): Promise<string> {
  const startResponse = await SELF.fetch('https://example.com/api/home-loan-rates/admin/audits/historical-quality/run', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      start_date: manifest.start_date,
      end_date: manifest.end_date,
    }),
  })
  expect(startResponse.status).toBe(200)
  const started = (await startResponse.json()) as {
    created?: { auditRunId?: string }
    detail?: { run?: { status?: string; last_error?: string } }
  }
  const auditRunId = String(started.created?.auditRunId || '').trim()
  expect(auditRunId).not.toBe('')

  let status = String(started.detail?.run?.status || '')
  let lastError = String(started.detail?.run?.last_error || '')
  for (let attempt = 0; attempt < 50 && status !== 'completed'; attempt += 1) {
    const resumeResponse = await SELF.fetch('https://example.com/api/home-loan-rates/admin/audits/historical-quality/resume', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ audit_run_id: auditRunId }),
    })
    expect(resumeResponse.status).toBe(200)
    const resumed = (await resumeResponse.json()) as { detail?: { run?: { status?: string; last_error?: string } } }
    status = String(resumed.detail?.run?.status || '')
    lastError = String(resumed.detail?.run?.last_error || '')
  }
  expect(status, lastError).toBe('completed')
  return auditRunId
}

describe('historical quality audit integration', () => {
  it('runs the worker audit path against a real production slice fixture', async () => {
    const auditRunId = await ensureHistoricalQualityAuditRun()

    const detailResponse = await SELF.fetch(`https://example.com/api/home-loan-rates/admin/audits/historical-quality/${encodeURIComponent(auditRunId)}`, {
      headers: adminHeaders(),
    })
    expect(detailResponse.status).toBe(200)
    const detail = (await detailResponse.json()) as { run?: { audit_run_id?: string; status?: string } }
    expect(detail.run?.audit_run_id).toBe(auditRunId)
    expect(detail.run?.status).toBe('completed')
  }, 60000)

  it('returns latest day snapshots and detailed copyable day output', async () => {
    await ensureHistoricalQualityAuditRun()

    const criteriaResponse = await SELF.fetch('https://example.com/api/home-loan-rates/admin/audits/historical-quality/criteria', {
      headers: adminHeaders(),
    })
    expect(criteriaResponse.status).toBe(200)
    const criteriaJson = (await criteriaResponse.json()) as {
      criteria_groups?: Array<{ key?: string; criteria?: Array<{ code?: string }> }>
    }
    expect(Array.isArray(criteriaJson.criteria_groups)).toBe(true)
    expect((criteriaJson.criteria_groups ?? []).some((group) => group.key === 'daily_counters')).toBe(true)
    expect((criteriaJson.criteria_groups ?? []).some((group) => (group.criteria ?? []).some((criterion) => criterion.code === 'transition_score_v1'))).toBe(true)

    const daysResponse = await SELF.fetch('https://example.com/api/home-loan-rates/admin/audits/historical-quality/days?limit=20', {
      headers: adminHeaders(),
    })
    expect(daysResponse.status).toBe(200)
    const daysJson = (await daysResponse.json()) as {
      days?: Array<{
        collection_date?: string
        summary?: {
          counts?: {
            new_product_count?: number
            lost_product_count?: number
          }
        }
        overall?: {
          row_count?: number
          bank_count?: number
          product_count?: number
          evidence_confidence_score_v1?: number
        }
      }>
    }
    expect(Array.isArray(daysJson.days)).toBe(true)
    expect((daysJson.days ?? []).length).toBeGreaterThan(0)
    expect((daysJson.days ?? []).some((day) => day.collection_date === '2026-03-29')).toBe(true)
    expect((daysJson.days ?? []).every((day) => typeof day.summary?.counts?.new_product_count === 'number')).toBe(true)

    const dayDetailResponse = await SELF.fetch(
      'https://example.com/api/home-loan-rates/admin/audits/historical-quality/days/2026-03-29',
      { headers: adminHeaders() },
    )
    expect(dayDetailResponse.status).toBe(200)
    const dayDetail = (await dayDetailResponse.json()) as {
      run?: { audit_run_id?: string; status?: string }
      summary?: { counts?: { new_product_count?: number }; top_degraded_lenders?: unknown[] }
      rows?: Array<{ scope?: string; metrics?: { daily_summary?: { top_degraded_lenders?: unknown[] } } }>
      findings?: Array<{ criterion_code?: string }>
      parameters?: Array<{ key?: string; text?: string; debug?: Record<string, unknown> }>
      plain_text?: string
    }
    expect(dayDetail.run?.audit_run_id).toBeTruthy()
    expect(dayDetail.rows?.some((row) => row.scope === 'overall')).toBe(true)
    expect(dayDetail.parameters?.some((parameter) => parameter.key === 'cdr_missing_product_count')).toBe(true)
    expect(dayDetail.parameters?.some((parameter) => parameter.key === 'top_degraded_lenders')).toBe(true)
    expect(dayDetail.parameters?.some((parameter) => parameter.key === 'coverage_score_v1')).toBe(true)
    expect(dayDetail.parameters?.some((parameter) => parameter.key === 'finding_summary')).toBe(true)
    expect(dayDetail.parameters?.every((parameter) => typeof parameter.text === 'string' && parameter.debug && typeof parameter.debug === 'object')).toBe(true)
    expect(Array.isArray(dayDetail.findings)).toBe(true)
    expect(typeof dayDetail.summary?.counts?.new_product_count).toBe('number')
    expect(Array.isArray(dayDetail.summary?.top_degraded_lenders)).toBe(true)
    expect(String(dayDetail.plain_text || '')).toContain('run=')

    const plainTextResponse = await SELF.fetch(
      'https://example.com/api/home-loan-rates/admin/audits/historical-quality/days/2026-03-29/plain-text',
      { headers: adminHeaders() },
    )
    expect(plainTextResponse.status).toBe(200)
    const plainText = await plainTextResponse.text()
    expect(plainText).toContain('2026-03-29')
    expect(plainText).toContain('top_lenders=')
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
