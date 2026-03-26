import { Hono } from 'hono'
import { healStaleUbankZeroExpectedUnindexedLenderDatasets } from '../pipeline/heal-stale-ubank-lender-datasets'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'

export const adminLenderDatasetRepairRoutes = new Hono<AppContext>()

/**
 * Bulk-finalize UBank lender_dataset_runs stuck with expected=0 and no index success
 * (legacy rows predating the ubank-fallback handler fix). Body: { dry_run?: boolean }.
 */
adminLenderDatasetRepairRoutes.post('/repairs/stale-ubank-zero-expected-lender-datasets', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const dryRun = Boolean(body.dry_run ?? body.dryRun)
  try {
    const result = await healStaleUbankZeroExpectedUnindexedLenderDatasets(c.env.DB, { dryRun })
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode ?? null,
      result,
    })
  } catch (error) {
    return jsonError(c, 500, 'HEAL_FAILED', (error as Error)?.message ?? 'Heal failed', {})
  }
})
