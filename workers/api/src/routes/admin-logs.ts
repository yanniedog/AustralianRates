/**
 * Admin log routes: download system log (global_log), wipe system log.
 * All routes require admin auth.
 */

import { Hono } from 'hono'
import type { AppContext } from '../types'
import { withNoStore } from '../utils/http'
import type { LogLevel } from '../utils/logger'
import { getLogStats, queryLogs } from '../utils/logger'

export const adminLogRoutes = new Hono<AppContext>()

/** GET /admin/logs/system - download system log as text (same format as public /logs) */
adminLogRoutes.get('/logs/system', async (c) => {
  withNoStore(c)
  const query = c.req.query()
  const level = query.level as LogLevel | undefined
  const source = query.source
  const limit = Math.min(Number(query.limit || 5000) || 5000, 10000)
  const offset = Math.max(Number(query.offset || 0) || 0, 0)

  const { entries, total } = await queryLogs(c.env.DB, { level, source, limit, offset })

  const lines = entries.map((e: Record<string, unknown>) => {
    const parts = [
      String(e.ts ?? ''),
      `[${String(e.level ?? 'info').toUpperCase()}]`,
      `[${String(e.source ?? 'api')}]`,
      String(e.message ?? ''),
    ]
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
