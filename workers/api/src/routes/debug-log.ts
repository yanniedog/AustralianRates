import type { Hono } from 'hono'
import type { AppContext } from '../types'

const DEBUG_LOG_KEY_PREFIX = 'debug:'
const DEBUG_LOG_TTL = 3600
const DEBUG_LOG_MAX_ENTRIES = 100

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
