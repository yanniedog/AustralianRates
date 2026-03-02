import { describe, expect, it } from 'vitest'
import { claimIdempotency } from '../src/queue/consumer/idempotency'
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
    expect(second.reason).toBe('duplicate')
    expect(kv.putCalls).toBe(1)
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
})
