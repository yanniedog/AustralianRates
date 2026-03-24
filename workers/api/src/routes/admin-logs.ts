/**
 * Admin log routes: download system log (global_log), wipe system log.
 * All routes require admin auth.
 */

import { Hono } from 'hono'
import { getIngestPauseConfig } from '../db/app-config'
import type { AppContext } from '../types'
import { jsonError, withNoStore } from '../utils/http'
import type { LogLevel } from '../utils/logger'
import {
  CODE_FILTER_UNSUPPORTED_MESSAGE,
  extractTraceback,
  getLogStats,
  log,
  parseLogContext,
  queryLogs,
  queryProblemLogs,
} from '../utils/logger'
import { toActionableIssueSummaries } from '../utils/log-actionable'
import { shouldIgnoreStatusActionableLog } from '../utils/status-actionable-filter'

export const adminLogRoutes = new Hono<AppContext>()

/** GET /admin/logs/system - download system log as text (same format as public /logs). Query: level, source, code, format, limit, offset, since (ISO timestamp). */
adminLogRoutes.get('/logs/system', async (c) => {
  withNoStore(c)
  const query = c.req.query()
  const level = query.level as LogLevel | undefined
  const source = query.source
  const code = query.code
  const format = String(query.format || 'text').toLowerCase()
  const limit = Math.min(Number(query.limit || 5000) || 5000, 10000)
  const offset = Math.max(Number(query.offset || 0) || 0, 0)
  const sinceRaw = query.since ?? query.since_ts ?? ''
  const sinceTs = sinceRaw.trim() ? String(sinceRaw).trim() : undefined

  let entries: Array<Record<string, unknown>>
  let total: number
  try {
    const result = await queryLogs(c.env.DB, { level, source, code, sinceTs, limit, offset })
    entries = result.entries
    total = result.total
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === CODE_FILTER_UNSUPPORTED_MESSAGE) {
      return jsonError(c, 503, 'CODE_FILTER_UNSUPPORTED', message, {
        hint: 'Apply migration 0019_health_checks_and_log_codes.sql to add global_log.code.',
      })
    }
    log.error('admin-logs', 'query_logs_failed', {
      code: 'admin_logs_query_failed',
      error: err,
      context: JSON.stringify({ path: '/logs/system', message }),
    })
    throw err
  }

  if (format === 'jsonl') {
    const lines = entries.map((entry) =>
      JSON.stringify({
        id: entry.id ?? null,
        ts: entry.ts ?? null,
        level: entry.level ?? null,
        source: entry.source ?? null,
        message: entry.message ?? null,
        code: entry.code ?? null,
        run_id: entry.run_id ?? null,
        lender_code: entry.lender_code ?? null,
        context: parseLogContext(entry.context),
        traceback: extractTraceback(entry.context),
      }),
    )
    c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="australianrates-system-log.jsonl"')
    return c.body(`${lines.join('\n')}\n`)
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
  try {
    const r = await c.env.DB.prepare('DELETE FROM global_log').run()
    const deleted = r.meta.changes ?? 0
    return c.json({ ok: true, deleted })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('admin-logs', 'wipe_failed', {
      code: 'admin_logs_wipe_failed',
      error: err,
      context: message,
    })
    return jsonError(c, 500, 'WIPE_FAILED', 'Failed to wipe system log.', { message })
  }
})

/** POST /admin/logs/ingest - insert one log entry (for archive worker or other services). Body: { level, source, message, code?, context?, run_id?, lender_code? }. Auth: admin. */
adminLogRoutes.post('/logs/ingest', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return jsonError(c, 400, 'INVALID_JSON', 'Request body must be valid JSON.')
  }
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  if (!o || typeof o.level !== 'string' || typeof o.source !== 'string' || typeof o.message !== 'string') {
    return jsonError(c, 400, 'BAD_REQUEST', 'Body must include level, source, and message (strings).')
  }
  const level = ['debug', 'info', 'warn', 'error'].includes(o.level) ? o.level : 'info'
  const source = String(o.source).slice(0, 200) || 'ingest'
  const message = String(o.message).slice(0, 2000)
  const code = typeof o.code === 'string' ? o.code.slice(0, 100) : null
  const context = o.context != null ? String(JSON.stringify(o.context)).slice(0, 8000) : null
  const runId = typeof o.run_id === 'string' ? o.run_id.slice(0, 200) : null
  const lenderCode = typeof o.lender_code === 'string' ? o.lender_code.slice(0, 100) : null
  try {
    await c.env.DB.prepare(
      `INSERT INTO global_log (level, source, message, code, context, run_id, lender_code)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind(level, source, message, code, context, runId, lenderCode)
      .run()
    return c.json({ ok: true })
  } catch {
    try {
      await c.env.DB.prepare(
        `INSERT INTO global_log (level, source, message, context, run_id, lender_code)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
        .bind(level, source, message, context, runId, lenderCode)
        .run()
      return c.json({ ok: true })
    } catch (err) {
      log.error('admin-logs', 'ingest_failed', {
        code: 'admin_logs_ingest_failed',
        error: err,
        context: JSON.stringify({ source, message: message.slice(0, 200) }),
      })
      return jsonError(c, 500, 'INGEST_FAILED', 'Failed to persist log entry.')
    }
  }
})

/** GET /admin/logs/system/stats - system log row count and latest ts (for UI) */
adminLogRoutes.get('/logs/system/stats', async (c) => {
  withNoStore(c)
  const stats = await getLogStats(c.env.DB)
  return c.json({ ok: true, ...stats })
})

/** GET /admin/logs/system/actionable - grouped operational issues with actions. Uses same filter as status health run (status-actionable-filter). */
adminLogRoutes.get('/logs/system/actionable', async (c) => {
  withNoStore(c)
  const limit = Math.max(1, Math.min(500, Number(c.req.query('limit') || 150)))
  const pauseConfig = await getIngestPauseConfig(c.env.DB).catch(() => ({ mode: 'active' as const, reason: null }))
  const { entries } = await queryProblemLogs(c.env.DB, { limit })
  const problemRows = entries.filter((entry) => {
    const level = String(entry.level || '').toLowerCase()
    if (level !== 'warn' && level !== 'error') return false
    if (shouldIgnoreStatusActionableLog(entry, pauseConfig.mode)) return false
    return true
  })
  const issues = toActionableIssueSummaries(problemRows)
  return c.json({
    ok: true,
    count: issues.length,
    scanned: problemRows.length,
    issues,
  })
})
