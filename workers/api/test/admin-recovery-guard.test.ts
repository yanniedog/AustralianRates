import { describe, expect, it } from 'vitest'
import {
  consumeAdminRecoveryRateLimit,
  hashAdminBearerToken,
  parseRecoveryAuditReason,
} from '../src/utils/admin-recovery-guard'
import type { EnvBindings } from '../src/types'

function memoryKv(): KVNamespace {
  const store = new Map<string, string>()
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v)
    },
  } as unknown as KVNamespace
}

describe('admin recovery guard', () => {
  it('parseRecoveryAuditReason accepts incident_date within 7 days UTC', () => {
    const today = new Date()
    const d = new Date(today.getTime() - 2 * 86400_000).toISOString().slice(0, 10)
    const r = parseRecoveryAuditReason({
      audit_reason: { incident_date: d, note: 'prod recovery' },
    })
    expect(r).toEqual({ incident_date: d, note: 'prod recovery' })
  })

  it('parseRecoveryAuditReason rejects incident_date older than 7 days', () => {
    const old = '2020-01-01'
    expect(
      parseRecoveryAuditReason({
        audit_reason: { incident_date: old, note: 'stale' },
      }),
    ).toBeNull()
  })

  it('consumeAdminRecoveryRateLimit blocks after max requests in window', async () => {
    const env = { IDEMPOTENCY_KV: memoryKv() } as unknown as EnvBindings
    const hash = 'deadbeef'
    for (let i = 0; i < 10; i++) {
      const r = await consumeAdminRecoveryRateLimit(env, 'shorten-lease', hash, 10)
      expect(r.allowed).toBe(true)
    }
    const blocked = await consumeAdminRecoveryRateLimit(env, 'shorten-lease', hash, 10)
    expect(blocked.allowed).toBe(false)
  })

  it('hashAdminBearerToken returns 64-char hex for bearer header', async () => {
    const h = await hashAdminBearerToken('Bearer secret-token-value')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
