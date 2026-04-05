import { Hono, type Context } from 'hono'
import { listHistoricalQualityCriteria } from '../db/historical-quality-criteria'
import { getHistoricalQualityDayDetail, listLatestHistoricalQualityDays } from '../db/historical-quality-day-reports'
import { runRetentionSizeAudit } from '../db/retention-size-audit'
import { jsonError } from '../utils/http'
import type { AppContext } from '../types'
import { getHistoricalQualityRunDetail, listHistoricalQualityRunHistory } from '../pipeline/historical-quality-runner'

const DO_NAME = 'historical-quality-orchestrator'

async function callHistoricalQualityDo(c: Context<AppContext>, body: Record<string, unknown>) {
  if (!c.env.HISTORICAL_QUALITY_AUDIT_DO) {
    throw new Error('historical_quality_audit_do_not_configured')
  }
  const id = c.env.HISTORICAL_QUALITY_AUDIT_DO.idFromName(DO_NAME)
  const stub = c.env.HISTORICAL_QUALITY_AUDIT_DO.get(id)
  const response = await stub.fetch('https://historical-quality.internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json<Record<string, unknown>>()
}

export const adminHistoricalQualityRoutes = new Hono<AppContext>()

adminHistoricalQualityRoutes.get('/audits/historical-quality', async (c) => {
  const limit = Math.max(1, Math.min(100, Math.floor(Number(c.req.query('limit') || 20))))
  const runs = await listHistoricalQualityRunHistory(c.env, limit)
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    runs: runs.map((run) => ({
      ...run,
      filters: JSON.parse(run.filters_json || '{}'),
      summary: JSON.parse(run.summary_json || '{}'),
      artifacts: JSON.parse(run.artifacts_json || '{}'),
    })),
  })
})

adminHistoricalQualityRoutes.get('/audits/historical-quality/days', async (c) => {
  const limit = Math.max(1, Math.min(5000, Math.floor(Number(c.req.query('limit') || 3650))))
  const days = await listLatestHistoricalQualityDays(c.env.DB, limit)
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    days: days.map((day) => ({
      ...day,
      summary: day.summary,
      metrics: JSON.parse(day.overall.metrics_json || '{}'),
      evidence: JSON.parse(day.overall.evidence_json || '{}'),
    })),
  })
})

adminHistoricalQualityRoutes.get('/audits/historical-quality/criteria', async (c) => {
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    criteria_groups: listHistoricalQualityCriteria(),
  })
})

adminHistoricalQualityRoutes.get('/audits/historical-quality/days/:collectionDate', async (c) => {
  const collectionDate = String(c.req.param('collectionDate') || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate)) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'collectionDate must be YYYY-MM-DD.')
  }
  const detail = await getHistoricalQualityDayDetail(c.env.DB, collectionDate)
  if (!detail.run) {
    return jsonError(c, 404, 'NOT_FOUND', 'Historical quality day not found.')
  }
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    run: detail.run,
    summary: detail.summary,
    rows: detail.rows.map((row) => ({
      ...row,
      metrics: JSON.parse(row.metrics_json || '{}'),
      evidence: JSON.parse(row.evidence_json || '{}'),
    })),
    findings: detail.findings.map((finding) => ({
      ...finding,
      sample_identifiers: JSON.parse(finding.sample_identifiers_json || '{}'),
      metrics: JSON.parse(finding.metrics_json || '{}'),
      evidence: JSON.parse(finding.evidence_json || '{}'),
      drilldown_sql: JSON.parse(finding.drilldown_sql_json || '{}'),
    })),
    plain_text: detail.plain_text,
    parameters: detail.parameters,
  })
})

adminHistoricalQualityRoutes.get('/audits/historical-quality/days/:collectionDate/plain-text', async (c) => {
  const collectionDate = String(c.req.param('collectionDate') || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate)) {
    return c.text('collectionDate must be YYYY-MM-DD.', 400)
  }
  const detail = await getHistoricalQualityDayDetail(c.env.DB, collectionDate)
  if (!detail.run) {
    return c.text('Historical quality day not found.', 404)
  }
  return c.text(detail.plain_text, 200, {
    'content-type': 'text/plain; charset=utf-8',
  })
})

adminHistoricalQualityRoutes.get('/audits/historical-quality/retention-size-audit', async (c) => {
  const audit = await runRetentionSizeAudit(c.env.DB)
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    ...audit,
  })
})

adminHistoricalQualityRoutes.post('/audits/historical-quality/run', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const payload = await callHistoricalQualityDo(c, {
    action: 'start',
    startDate: typeof body.start_date === 'string' ? body.start_date : typeof body.startDate === 'string' ? body.startDate : undefined,
    endDate: typeof body.end_date === 'string' ? body.end_date : typeof body.endDate === 'string' ? body.endDate : undefined,
    triggerSource: 'manual',
    targetDb: 'australianrates_api',
  })
  return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode || null, ...payload })
})

adminHistoricalQualityRoutes.post('/audits/historical-quality/resume', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const auditRunId = String(body.audit_run_id ?? body.auditRunId ?? '').trim()
  if (!auditRunId) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'audit_run_id is required.')
  }
  const payload = await callHistoricalQualityDo(c, { action: 'resume', auditRunId })
  return c.json({ ok: true, auth_mode: c.get('adminAuthState')?.mode || null, ...payload })
})

adminHistoricalQualityRoutes.get('/audits/historical-quality/:runId', async (c) => {
  const runId = String(c.req.param('runId') || '').trim()
  if (!runId) return jsonError(c, 400, 'INVALID_REQUEST', 'runId is required.')
  const detail = await getHistoricalQualityRunDetail(c.env, runId)
  if (!detail.run) return jsonError(c, 404, 'NOT_FOUND', 'Historical quality run not found.')
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    run: {
      ...detail.run,
      filters: JSON.parse(detail.run.filters_json || '{}'),
      summary: JSON.parse(detail.run.summary_json || '{}'),
      artifacts: JSON.parse(detail.run.artifacts_json || '{}'),
    },
    daily: detail.daily.map((row) => ({
      ...row,
      metrics: JSON.parse(row.metrics_json || '{}'),
      evidence: JSON.parse(row.evidence_json || '{}'),
    })),
    findings: detail.findings.map((finding) => ({
      ...finding,
      sample_identifiers: JSON.parse(finding.sample_identifiers_json || '{}'),
      metrics: JSON.parse(finding.metrics_json || '{}'),
      evidence: JSON.parse(finding.evidence_json || '{}'),
      drilldown_sql: JSON.parse(finding.drilldown_sql_json || '{}'),
    })),
  })
})
