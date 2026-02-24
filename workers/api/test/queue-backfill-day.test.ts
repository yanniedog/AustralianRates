import { describe, expect, it, vi } from 'vitest'
import { consumeIngestQueue } from '../src/queue/consumer'
import type { EnvBindings, IngestMessage } from '../src/types'

function makeMockD1(): D1Database {
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => null as unknown,
        all: async () => ({ results: [], meta: { duration: 0 } }),
        run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
      }),
      first: async () => null as unknown,
      all: async () => ({ results: [], meta: { duration: 0 } }),
      run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
    }),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database
}

function makeEnv(): EnvBindings {
  return {
    DB: makeMockD1(),
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    MAX_QUEUE_ATTEMPTS: '3',
  }
}

describe('queue backfill day message', () => {
  it('acks non-retryable unknown lender error', async () => {
    const ack = vi.fn()
    const retry = vi.fn()
    const message = {
      body: {
        kind: 'backfill_day_fetch',
        runId: 'run-1',
        runSource: 'scheduled',
        lenderCode: 'unknown_lender',
        collectionDate: '2026-02-24',
        attempt: 0,
        idempotencyKey: 'k-1',
      },
      attempts: 1,
      ack,
      retry,
    }

    await consumeIngestQueue({ messages: [message] } as unknown as MessageBatch<IngestMessage>, makeEnv())

    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
  })
})
