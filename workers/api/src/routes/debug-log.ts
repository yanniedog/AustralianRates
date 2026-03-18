import type { Hono } from 'hono'
import type { AppContext } from '../types'
import { initLogger, log } from '../utils/logger'

const DEBUG_LOG_KEY_PREFIX = 'debug:'
const DEBUG_LOG_TTL = 3600
const DEBUG_LOG_MAX_ENTRIES = 100
const MAX_CLIENT_MESSAGE = 2000
const MAX_CLIENT_CONTEXT = 4000

function isClientErrorOrWarn(body: unknown): body is { level: 'error' | 'warn'; message?: string; [k: string]: unknown } {
  if (body == null || typeof body !== 'object' || !('level' in body)) return false
  const level = (body as { level?: string }).level
  return level === 'error' || level === 'warn'
}

export function registerDebugLogRoutes(app: Hono<AppContext>): void {
  app.post('/debug-log', async (c) => {
    const kv = c.env.IDEMPOTENCY_KV
    if (!kv) {
      return c.json({ ok: false, error: 'Debug log not configured' }, 503)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON' }, 400)
    }
    const sessionId = (body && typeof body === 'object' && 'sessionId' in body && typeof (body as { sessionId?: unknown }).sessionId === 'string')
      ? (body as { sessionId: string }).sessionId
      : c.req.header('X-Debug-Session-Id') || 'unknown'
    const key = DEBUG_LOG_KEY_PREFIX + sessionId
    const entry = { ...(body as object), receivedAt: Date.now() }
    let entries: unknown[]
    try {
      const raw = await kv.get(key)
      entries = raw ? (JSON.parse(raw) as unknown[]) : []
    } catch {
      entries = []
    }
    if (!Array.isArray(entries)) entries = []
    entries.push(entry)
    if (entries.length > DEBUG_LOG_MAX_ENTRIES) entries = entries.slice(-DEBUG_LOG_MAX_ENTRIES)
    await kv.put(key, JSON.stringify(entries), { expirationTtl: DEBUG_LOG_TTL })

    if (c.env.DB && isClientErrorOrWarn(body)) {
      initLogger(c.env.DB)
      const msg = (body && typeof body === 'object' && 'message' in body && typeof (body as { message?: unknown }).message === 'string')
        ? String((body as { message: string }).message).slice(0, MAX_CLIENT_MESSAGE)
        : 'Client-reported error'
      const ctx: Record<string, unknown> = { sessionId }
      if (body && typeof body === 'object') {
        const o = body as Record<string, unknown>
        if (typeof o.url === 'string') ctx.url = o.url.slice(0, 500)
        if (typeof o.status === 'number') ctx.status = o.status
        if (typeof o.code === 'string') ctx.code = o.code.slice(0, 100)
        if (o.data != null && typeof o.data === 'object') ctx.data = o.data
      }
      const contextStr = JSON.stringify(ctx).slice(0, MAX_CLIENT_CONTEXT)
      if ((body as { level: string }).level === 'error') {
        log.error('client', msg, { code: 'client_error', context: contextStr })
      } else {
        log.warn('client', msg, { code: 'client_warn', context: contextStr })
      }
    }

    return c.json({ ok: true, sessionId, count: entries.length })
  })

  app.get('/debug-log', async (c) => {
    const kv = c.env.IDEMPOTENCY_KV
    if (!kv) {
      return c.json({ ok: false, error: 'Debug log not configured' }, 503)
    }
    const sessionId = c.req.query('session') || ''
    if (!sessionId) {
      return c.json({ ok: false, error: 'Query parameter session is required' }, 400)
    }
    const key = DEBUG_LOG_KEY_PREFIX + sessionId
    const raw = await kv.get(key)
    const entries = raw ? (JSON.parse(raw) as unknown[]) : []
    return c.json({ ok: true, sessionId, entries })
  })
}
