/**
 * Admin log routes: download system log (global_log), wipe system log.
 * All routes require admin auth.
 */

import { Hono } from 'hono'
import type { AppContext } from '../types'
import { jsonError, withNoStore } from '../utils/http'
import type { LogLevel } from '../utils/logger'
import { CODE_FILTER_UNSUPPORTED_MESSAGE, getLogStats, queryLogs } from '../utils/logger'
import { toActionableIssueSummaries } from '../utils/log-actionable'

export const adminLogRoutes = new Hono<AppContext>()

/** GET /admin/logs/system - download system log as text (same format as public /logs) */
adminLogRoutes.get('/logs/system', async (c) => {
  withNoStore(c)
  const query = c.req.query()
  const level = query.level as LogLevel | undefined
  const source = query.source
  const code = query.code
  const limit = Math.min(Number(query.limit || 5000) || 5000, 10000)
  const offset = Math.max(Number(query.offset || 0) || 0, 0)

  let entries: Array<Record<string, unknown>>
  let total: number
  try {
    const result = await queryLogs(c.env.DB, { level, source, code, limit, offset })
    entries = result.entries
    total = result.total
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === CODE_FILTER_UNSUPPORTED_MESSAGE) {
      return jsonError(c, 503, 'CODE_FILTER_UNSUPPORTED', message, {
        hint: 'Apply migration 0019_health_checks_and_log_codes.sql to add global_log.code.',
      })
    }
    throw err
  }

  const lines = entries.map((e: Record<string, unknown>) => {
    const parts = [
      String(e.ts ?? ''),
      `[${String(e.level ?? 'info').toUpperCase()}]`,
      `[${String(e.source ?? 'api')}]`,
      String(e.message ?? ''),
    ]
    if (e.code) parts.push(`code=${String(e.code)}`)
    if (e.run_id) parts.push(`run=${e.run_id}`)
    if (e.lender_code) parts.push(`lender=${e.lender_code}`)
    if (e.context) parts.push(String(e.context))
    return parts.join(' ')
  })

  c.header('Content-Type', 'text/plain; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="australianrates-system-log.txt"')
  return c.body(
    `# AustralianRates System Log (${total} entries total, showing ${entries.length})\n# Downloaded at ${new Date().toISOString()}\n\n${lines.join('\n')}\n`,
  )
})

/** POST /admin/logs/system/wipe - delete all rows from global_log */
adminLogRoutes.post('/logs/system/wipe', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM global_log').run()
  const deleted = r.meta.changes ?? 0
  return c.json({ ok: true, deleted })
})

/** GET /admin/logs/system/stats - system log row count and latest ts (for UI) */
adminLogRoutes.get('/logs/system/stats', async (c) => {
  withNoStore(c)
  const stats = await getLogStats(c.env.DB)
  return c.json({ ok: true, ...stats })
})

/** GET /admin/logs/system/actionable - grouped operational issues with actions */
adminLogRoutes.get('/logs/system/actionable', async (c) => {
  withNoStore(c)
  const limit = Math.max(1, Math.min(500, Number(c.req.query('limit') || 150)))
  const { entries } = await queryLogs(c.env.DB, { limit })
  const problemRows = entries.filter((entry) => {
    const level = String(entry.level || '').toLowerCase()
    return level === 'warn' || level === 'error'
  })
  const issues = toActionableIssueSummaries(problemRows)
  return c.json({
    ok: true,
    count: issues.length,
    scanned: problemRows.length,
    issues,
  })
})
