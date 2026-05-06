import type { Context } from 'hono'
import { parseBearerToken } from '../auth/admin'
import type { AppContext, EnvBindings } from '../types'
import { jsonError } from './http'
import { log } from './logger'
import { isD1EmergencyMinimumWrites } from './d1-emergency'
import { isD1NonEssentialWorkDisabled } from './d1-budget'

const RATE_WINDOW_MS = 600_000

export type RecoveryAuditReason = { incident_date: string; note: string }

const FORCE_AUDIT_MESSAGE =
  'force_recovery requires audit_reason: { incident_date (YYYY-MM-DD), note } with incident_date within the last 7 days UTC.'

export async function guardAdminRecoveryMutation(
  c: Context<AppContext>,
  input: {
    routePath: string
    rateRouteKey: string
    maxInWindow: number
    rateLimitedDetail: string
    body: Record<string, unknown>
  },
): Promise<{ ok: true; bypassReason: RecoveryAuditReason | null } | { ok: false; response: Response }> {
  const force = recoveryBypassRequested(c.req.query('force_recovery'))
  const auditReason = parseRecoveryAuditReason(input.body)
  if (force && !auditReason) {
    return { ok: false, response: jsonError(c, 400, 'BAD_REQUEST', FORCE_AUDIT_MESSAGE) }
  }
  const bypassReason = force ? auditReason : null
  if (bypassReason) {
    logRecoveryBypass(input.routePath, bypassReason)
  }

  if (!bypassReason && (await adminRecoveryBudgetActive(c.env))) {
    return { ok: false, response: c.json({ error: 'budget_emergency_or_nonessential_disabled' }, 503) }
  }

  const tokenHash = await hashAdminBearerToken(c.req.header('Authorization'))
  if (tokenHash && !bypassReason) {
    const rate = await consumeAdminRecoveryRateLimit(c.env, input.rateRouteKey, tokenHash, input.maxInWindow)
    if (!rate.allowed) {
      return { ok: false, response: jsonError(c, 429, 'RATE_LIMITED', input.rateLimitedDetail) }
    }
  }

  return { ok: true, bypassReason }
}

export async function hashAdminBearerToken(authHeader: string | undefined): Promise<string | null> {
  const token = parseBearerToken(authHeader)
  if (!token) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function adminRecoveryBudgetActive(env: EnvBindings): Promise<boolean> {
  return isD1EmergencyMinimumWrites(env) || (await isD1NonEssentialWorkDisabled(env))
}

export function parseRecoveryAuditReason(body: unknown): RecoveryAuditReason | null {
  if (!body || typeof body !== 'object') return null
  const ar = (body as Record<string, unknown>).audit_reason
  if (!ar || typeof ar !== 'object') return null
  const incidentDate = String((ar as Record<string, unknown>).incident_date ?? '').trim()
  const note = String((ar as Record<string, unknown>).note ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate) || !note) return null
  const incMs = Date.parse(`${incidentDate}T00:00:00.000Z`)
  if (!Number.isFinite(incMs)) return null
  const minMs = Date.now() - 7 * 86400_000
  if (incMs < minMs) return null
  return { incident_date: incidentDate, note }
}

export function recoveryBypassRequested(queryVal: string | undefined): boolean {
  return String(queryVal ?? '').trim() === '1'
}

export function logRecoveryBypass(route: string, audit: RecoveryAuditReason): void {
  log.warn('admin', 'admin_recovery_bypass', {
    code: 'admin_recovery_bypass',
    context: JSON.stringify({ route, audit_reason: audit }),
  })
}

export async function consumeAdminRecoveryRateLimit(
  env: EnvBindings,
  routeKey: string,
  tokenHash: string,
  maxInWindow: number,
): Promise<{ allowed: boolean }> {
  const kv = env.IDEMPOTENCY_KV || env.CHART_CACHE_KV
  if (!kv) return { allowed: true }
  const bucket = Math.floor(Date.now() / RATE_WINDOW_MS)
  const key = `ratelimit:${routeKey}:${tokenHash}:${bucket}`
  const raw = await kv.get(key)
  const count = raw ? Math.max(0, Math.floor(Number(raw))) : 0
  if (count >= maxInWindow) return { allowed: false }
  await kv.put(key, String(count + 1), { expirationTtl: 660 })
  return { allowed: true }
}
