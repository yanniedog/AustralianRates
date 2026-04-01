import type { EnvBindings } from '../types'
import {
  getHistoricalQualityRunDetail,
  processHistoricalQualityRunStep,
  startHistoricalQualityRun,
} from '../pipeline/historical-quality-runner'

type AuditDoRequest =
  | { action: 'start'; startDate?: string; endDate?: string; triggerSource?: 'manual' | 'script' | 'scheduled'; targetDb?: string }
  | { action: 'resume'; auditRunId: string }
  | { action: 'status'; auditRunId: string }

export class HistoricalQualityAuditDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: EnvBindings,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const body = await request.json<AuditDoRequest>().catch(() => null)
    if (!body || !body.action) {
      return Response.json({ ok: false, error: 'invalid_historical_quality_request' }, { status: 400 })
    }
    return this.state.blockConcurrencyWhile(async () => {
      if (body.action === 'start') {
        const created = await startHistoricalQualityRun(this.env, body)
        const step = await processHistoricalQualityRunStep(this.env, created.auditRunId).catch((error) => ({
          auditRunId: created.auditRunId,
          status: 'partial',
          error: error instanceof Error ? error.message : String(error),
        }))
        const detail = await getHistoricalQualityRunDetail(this.env, created.auditRunId)
        return Response.json({ ok: true, created, step, detail })
      }
      if (!body.auditRunId) {
        return Response.json({ ok: false, error: 'missing_audit_run_id' }, { status: 400 })
      }
      if (body.action === 'resume') {
        const step = await processHistoricalQualityRunStep(this.env, body.auditRunId).catch((error) => ({
          auditRunId: body.auditRunId,
          status: 'partial',
          error: error instanceof Error ? error.message : String(error),
        }))
        const detail = await getHistoricalQualityRunDetail(this.env, body.auditRunId)
        return Response.json({ ok: true, step, detail })
      }
      const detail = await getHistoricalQualityRunDetail(this.env, body.auditRunId)
      return Response.json({ ok: true, detail })
    })
  }
}
