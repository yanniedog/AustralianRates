import type { Context } from 'hono'
import { getPublicRunProgress } from '../db/run-progress'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'

export async function handlePublicRunStatus(c: Context<AppContext>) {
  const runId = String(c.req.param('runId') || '').trim()
  if (!runId) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'runId is required.')
  }

  const run = await getPublicRunProgress(c.env.DB, runId)
  if (!run) {
    return jsonError(c, 404, 'RUN_NOT_FOUND', 'Run not found.')
  }

  return c.json({ ok: true, run })
}
