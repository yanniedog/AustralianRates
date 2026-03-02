import type { EnvBindings, IngestMessage } from '../../types'
import { parseIntegerEnv } from '../../utils/time'

const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60
const MIN_IDEMPOTENCY_TTL_SECONDS = 60
const MAX_IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60

type IdempotencyReason =
  | 'feature_disabled'
  | 'missing_key'
  | 'kv_missing'
  | 'kv_error'
  | 'claimed'
  | 'duplicate'

export type IdempotencyClaimResult = {
  shouldProcess: boolean
  duplicate: boolean
  enforced: boolean
  key: string | null
  ttlSeconds: number
  reason: IdempotencyReason
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

function keyFor(kind: IngestMessage['kind'], idempotencyKey: string): string {
  return `idem:${kind}:${idempotencyKey}`
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
  if (!isEnabled(env.FEATURE_QUEUE_IDEMPOTENCY_ENABLED)) {
    return {
      shouldProcess: true,
      duplicate: false,
      enforced: false,
      key: null,
      ttlSeconds,
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
      reason: 'kv_missing',
    }
  }

  const key = keyFor(input.kind, keyPart)
  try {
    const existing = await env.IDEMPOTENCY_KV.get(key)
    if (existing != null) {
      return {
        shouldProcess: false,
        duplicate: true,
        enforced: true,
        key,
        ttlSeconds,
        reason: 'duplicate',
      }
    }

    await env.IDEMPOTENCY_KV.put(
      key,
      JSON.stringify({
        kind: input.kind,
        idempotency_key: keyPart,
        run_id: input.runId ?? null,
        lender_code: input.lenderCode ?? null,
        claimed_at: new Date().toISOString(),
      }),
      { expirationTtl: ttlSeconds },
    )

    return {
      shouldProcess: true,
      duplicate: false,
      enforced: true,
      key,
      ttlSeconds,
      reason: 'claimed',
    }
  } catch (error) {
    return {
      shouldProcess: true,
      duplicate: false,
      enforced: true,
      key,
      ttlSeconds,
      reason: 'kv_error',
      error: (error as Error)?.message || String(error),
    }
  }
}
