import { describe, expect, it } from 'vitest'
import {
  activeClaimRetryDelaySeconds,
  claimIdempotency,
  completeIdempotencyClaim,
  releaseIdempotencyClaim,
} from '../src/queue/consumer/idempotency'
import type { EnvBindings, IngestMessage } from '../src/types'

class MemoryKv {
  readonly values = new Map<string, string>()
  putCalls = 0

  async get(key: string): Promise<string | null> {
    return this.values.has(key) ? this.values.get(key) ?? null : null
  }

  async put(key: string, value: string): Promise<void> {
    this.putCalls += 1
    this.values.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

function makeEnv(overrides?: Partial<EnvBindings>): EnvBindings {
  return {
    DB: {} as D1Database,
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    ...overrides,
  }
}

describe('queue idempotency claim', () => {
  it('allows first claim and skips duplicate claim', async () => {
    const kv = new MemoryKv()
    const env = makeEnv({
      FEATURE_QUEUE_IDEMPOTENCY_ENABLED: 'true',
      IDEMPOTENCY_TTL_SECONDS: '604800',
      IDEMPOTENCY_KV: kv as unknown as KVNamespace,
    })

    const first = await claimIdempotency(env, {
      kind: 'daily_lender_fetch',
      idempotencyKey: 'run:abc:lender:anz',
      runId: 'run:abc',
      lenderCode: 'anz',
    })
    expect(first.shouldProcess).toBe(true)
    expect(first.duplicate).toBe(false)
    expect(first.reason).toBe('claimed')
    expect(kv.putCalls).toBe(1)

    const second = await claimIdempotency(env, {
      kind: 'daily_lender_fetch',
      idempotencyKey: 'run:abc:lender:anz',
      runId: 'run:abc',
      lenderCode: 'anz',
    })
    expect(second.shouldProcess).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.reason).toBe('active_claim')
    expect(kv.putCalls).toBe(1)

    await completeIdempotencyClaim(env, {
      kind: 'daily_lender_fetch',
      idempotencyKey: 'run:abc:lender:anz',
    })

    const completedDuplicate = await claimIdempotency(env, {
      kind: 'daily_lender_fetch',
      idempotencyKey: 'run:abc:lender:anz',
      runId: 'run:abc',
      lenderCode: 'anz',
    })
    expect(completedDuplicate.shouldProcess).toBe(false)
    expect(completedDuplicate.duplicate).toBe(true)
    expect(completedDuplicate.reason).toBe('duplicate')
  })

  it('releases the claim so retries can process again', async () => {
    const kv = new MemoryKv()
    const env = makeEnv({
      FEATURE_QUEUE_IDEMPOTENCY_ENABLED: 'true',
      IDEMPOTENCY_TTL_SECONDS: '604800',
      IDEMPOTENCY_LEASE_SECONDS: '900',
      IDEMPOTENCY_KV: kv as unknown as KVNamespace,
    })

    const first = await claimIdempotency(env, {
      kind: 'product_detail_fetch',
      idempotencyKey: 'run:abc:detail:1',
      runId: 'run:abc',
      lenderCode: 'anz',
    })
    expect(first.shouldProcess).toBe(true)

    await releaseIdempotencyClaim(env, {
      kind: 'product_detail_fetch',
      idempotencyKey: 'run:abc:detail:1',
    })

    const retryClaim = await claimIdempotency(env, {
      kind: 'product_detail_fetch',
      idempotencyKey: 'run:abc:detail:1',
      runId: 'run:abc',
      lenderCode: 'anz',
    })
    expect(retryClaim.shouldProcess).toBe(true)
    expect(retryClaim.duplicate).toBe(false)
    expect(retryClaim.reason).toBe('claimed')
  })

  it('passes through when feature is disabled', async () => {
    const kv = new MemoryKv()
    const env = makeEnv({
      FEATURE_QUEUE_IDEMPOTENCY_ENABLED: 'false',
      IDEMPOTENCY_KV: kv as unknown as KVNamespace,
    })

    const claim = await claimIdempotency(env, {
      kind: 'product_detail_fetch',
      idempotencyKey: 'run:abc:detail:1',
      runId: 'run:abc',
      lenderCode: 'anz',
    })
    expect(claim.shouldProcess).toBe(true)
    expect(claim.duplicate).toBe(false)
    expect(claim.enforced).toBe(false)
    expect(claim.reason).toBe('feature_disabled')
    expect(kv.putCalls).toBe(0)
  })

  it('computes retry delay from the active lease window', () => {
    expect(activeClaimRetryDelaySeconds('2026-03-29T17:57:00.000Z', 900, Date.parse('2026-03-29T17:50:00.000Z'))).toBe(300)
    expect(activeClaimRetryDelaySeconds(null, 900, Date.parse('2026-03-29T17:50:00.000Z'))).toBe(300)
    expect(activeClaimRetryDelaySeconds('2026-03-29T17:50:05.000Z', 900, Date.parse('2026-03-29T17:50:00.000Z'))).toBe(15)
  })
})
