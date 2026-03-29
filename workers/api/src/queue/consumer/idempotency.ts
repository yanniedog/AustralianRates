import type { EnvBindings, IngestMessage } from '../../types'
import { parseIntegerEnv } from '../../utils/time'

const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60
const MIN_IDEMPOTENCY_TTL_SECONDS = 60
const MAX_IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60
const DEFAULT_IDEMPOTENCY_LEASE_SECONDS = 15 * 60

type IdempotencyReason =
  | 'feature_disabled'
  | 'missing_key'
  | 'kv_missing'
  | 'kv_error'
  | 'claimed'
  | 'active_claim'
  | 'duplicate'

type StoredIdempotencyClaim = {
  state: 'in_progress' | 'completed'
  kind: IngestMessage['kind']
  idempotency_key: string
  run_id: string | null
  lender_code: string | null
  claimed_at: string
  lease_until: string
  completed_at?: string
}

export type IdempotencyClaimResult = {
  shouldProcess: boolean
  duplicate: boolean
  enforced: boolean
  key: string | null
  ttlSeconds: number
  leaseSeconds: number
  reason: IdempotencyReason
  claimedAt?: string | null
  leaseUntil?: string | null
  error?: string
}

function isEnabled(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function idempotencyTtlSeconds(env: EnvBindings): number {
  const parsed = parseIntegerEnv(env.IDEMPOTENCY_TTL_SECONDS, DEFAULT_IDEMPOTENCY_TTL_SECONDS)
  return Math.max(MIN_IDEMPOTENCY_TTL_SECONDS, Math.min(MAX_IDEMPOTENCY_TTL_SECONDS, parsed))
}

function idempotencyLeaseSeconds(env: EnvBindings): number {
  return Math.max(MIN_IDEMPOTENCY_TTL_SECONDS, parseIntegerEnv(env.IDEMPOTENCY_LEASE_SECONDS, DEFAULT_IDEMPOTENCY_LEASE_SECONDS))
}

function keyFor(kind: IngestMessage['kind'], idempotencyKey: string): string {
  return `idem:${kind}:${idempotencyKey}`
}

function parseStoredClaim(raw: string | null): StoredIdempotencyClaim | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredIdempotencyClaim
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function leaseActive(leaseUntil: string | undefined): boolean {
  const leaseMs = Date.parse(String(leaseUntil || ''))
  return Number.isFinite(leaseMs) && leaseMs > Date.now()
}

export function activeClaimRetryDelaySeconds(
  leaseUntil: string | null | undefined,
  leaseSeconds: number,
  nowMs = Date.now(),
): number {
  const fallback = Math.max(15, Math.min(300, Math.floor(Number(leaseSeconds) || 0)))
  const leaseMs = Date.parse(String(leaseUntil || ''))
  if (!Number.isFinite(leaseMs) || leaseMs <= nowMs) return fallback
  const remainingSeconds = Math.ceil((leaseMs - nowMs) / 1000)
  return Math.max(15, Math.min(300, remainingSeconds + 5))
}

export async function claimIdempotency(
  env: EnvBindings,
  input: {
    kind: IngestMessage['kind']
    idempotencyKey: string | null
    runId?: string | null
    lenderCode?: string | null
  },
): Promise<IdempotencyClaimResult> {
  const ttlSeconds = idempotencyTtlSeconds(env)
  const leaseSeconds = idempotencyLeaseSeconds(env)
  if (!isEnabled(env.FEATURE_QUEUE_IDEMPOTENCY_ENABLED)) {
    return {
      shouldProcess: true,
      duplicate: false,
      enforced: false,
      key: null,
      ttlSeconds,
      leaseSeconds,
      reason: 'feature_disabled',
    }
  }

  const keyPart = String(input.idempotencyKey || '').trim()
  if (!keyPart) {
    return {
      shouldProcess: true,
      duplicate: false,
      enforced: true,
      key: null,
      ttlSeconds,
      leaseSeconds,
      reason: 'missing_key',
    }
  }

  if (!env.IDEMPOTENCY_KV) {
    return {
      shouldProcess: true,
      duplicate: false,
      enforced: true,
      key: keyFor(input.kind, keyPart),
      ttlSeconds,
      leaseSeconds,
      reason: 'kv_missing',
    }
  }

  const key = keyFor(input.kind, keyPart)
  try {
    const existing = parseStoredClaim(await env.IDEMPOTENCY_KV.get(key))
    if (existing?.state === 'completed') {
      return {
        shouldProcess: false,
        duplicate: true,
        enforced: true,
        key,
        ttlSeconds,
        leaseSeconds,
        reason: 'duplicate',
        claimedAt: existing.claimed_at,
        leaseUntil: existing.lease_until,
      }
    }
    if (existing?.state === 'in_progress' && leaseActive(existing.lease_until)) {
      return {
        shouldProcess: false,
        duplicate: true,
        enforced: true,
        key,
        ttlSeconds,
        leaseSeconds,
        reason: 'active_claim',
        claimedAt: existing.claimed_at,
        leaseUntil: existing.lease_until,
      }
    }

    const claimedAt = new Date().toISOString()
    const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString()

    await env.IDEMPOTENCY_KV.put(
      key,
      JSON.stringify({
        state: 'in_progress',
        kind: input.kind,
        idempotency_key: keyPart,
        run_id: input.runId ?? null,
        lender_code: input.lenderCode ?? null,
        claimed_at: claimedAt,
        lease_until: leaseUntil,
      }),
      { expirationTtl: ttlSeconds },
    )

    return {
      shouldProcess: true,
      duplicate: false,
      enforced: true,
      key,
      ttlSeconds,
      leaseSeconds,
      reason: 'claimed',
      claimedAt,
      leaseUntil,
    }
  } catch (error) {
    return {
      shouldProcess: true,
      duplicate: false,
      enforced: true,
      key,
      ttlSeconds,
      leaseSeconds,
      reason: 'kv_error',
      error: (error as Error)?.message || String(error),
    }
  }
}

export async function completeIdempotencyClaim(
  env: EnvBindings,
  input: { kind: IngestMessage['kind']; idempotencyKey: string | null },
): Promise<void> {
  if (!isEnabled(env.FEATURE_QUEUE_IDEMPOTENCY_ENABLED)) return
  if (!env.IDEMPOTENCY_KV) return
  const keyPart = String(input.idempotencyKey || '').trim()
  if (!keyPart) return
  const key = keyFor(input.kind, keyPart)
  const ttlSeconds = idempotencyTtlSeconds(env)
  const existing = parseStoredClaim(await env.IDEMPOTENCY_KV.get(key))
  const now = new Date().toISOString()
  await env.IDEMPOTENCY_KV.put(
    key,
    JSON.stringify({
      ...(existing || {
        kind: input.kind,
        idempotency_key: keyPart,
        run_id: null,
        lender_code: null,
      }),
      state: 'completed',
      lease_until: now,
      completed_at: now,
    }),
    { expirationTtl: ttlSeconds },
  )
}

export async function releaseIdempotencyClaim(
  env: EnvBindings,
  input: { kind: IngestMessage['kind']; idempotencyKey: string | null },
): Promise<void> {
  if (!isEnabled(env.FEATURE_QUEUE_IDEMPOTENCY_ENABLED)) return
  if (!env.IDEMPOTENCY_KV || typeof env.IDEMPOTENCY_KV.delete !== 'function') return
  const keyPart = String(input.idempotencyKey || '').trim()
  if (!keyPart) return
  await env.IDEMPOTENCY_KV.delete(keyFor(input.kind, keyPart))
}
