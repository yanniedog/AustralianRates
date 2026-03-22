import { Hono } from 'hono'
import { applyKnownCdrAnomalyRepair, previewKnownCdrAnomalyRepair } from '../pipeline/cdr-known-anomaly-repair'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'
import { log } from '../utils/logger'

export const adminKnownCdrRepairRoutes = new Hono<AppContext>()

adminKnownCdrRepairRoutes.post('/repairs/known-cdr-anomalies', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const dryRun = Boolean(body.dry_run ?? body.dryRun)

  try {
    const result = dryRun
      ? await previewKnownCdrAnomalyRepair(c.env.DB)
      : await applyKnownCdrAnomalyRepair(c.env.DB)
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode ?? null,
      dry_run: dryRun,
      result,
    })
  } catch (error) {
    const message = (error as Error)?.message || String(error)
    log.error('admin', 'known_cdr_anomaly_repair_failed', {
      error,
      context: JSON.stringify({ route: '/admin/repairs/known-cdr-anomalies', dryRun }),
    })
    return jsonError(c, 500, 'KNOWN_CDR_ANOMALY_REPAIR_FAILED', message)
  }
})
