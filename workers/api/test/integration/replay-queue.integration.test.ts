import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  claimReplayQueueRows,
  getReplayQueueRow,
  queueReplayFromExhaustedMessage,
  requeueStaleDispatchingReplayRows,
} from '../../src/db/ingest-replay-queue'
import type { IngestMessage } from '../../src/types'

const RUN_ID = 'daily:2026-04-25:replay-queue-integration'

function detailMessage(productId: string, dataset: 'term_deposits' | 'savings' = 'term_deposits'): IngestMessage {
  return {
    kind: 'product_detail_fetch',
    runId: RUN_ID,
    runSource: 'scheduled',
    lenderCode: 'anz',
    dataset,
    productId,
    collectionDate: '2026-04-25',
    attempt: 0,
    idempotencyKey: `${RUN_ID}:anz:${dataset}:${productId}`,
  }
}

describe('ingest replay queue recovery', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM ingest_replay_queue WHERE run_id = ?1').bind(RUN_ID).run()
  })

  it('requeues stale dispatching rows so due replay work is not stranded', async () => {
    const queued = await queueReplayFromExhaustedMessage(env.DB, {
      message: detailMessage('td-requeue'),
      errorMessage: 'queue_message_duplicate_active_claim',
      maxReplayAttempts: 2,
      baseDelaySeconds: 60,
    })
    await env.DB.prepare("UPDATE ingest_replay_queue SET next_attempt_at = '2026-04-25T00:00:00.000Z' WHERE replay_id = ?1")
      .bind(queued.replay_id)
      .run()

    const claimed = await claimReplayQueueRows(env.DB, { limit: 5, collectionDate: '2026-04-25' })
    expect(claimed.map((row) => row.replay_id)).toContain(queued.replay_id)

    await env.DB.prepare("UPDATE ingest_replay_queue SET updated_at = '2026-04-25T00:00:00.000Z' WHERE replay_id = ?1")
      .bind(queued.replay_id)
      .run()
    expect(await requeueStaleDispatchingReplayRows(env.DB, { staleMinutes: 15, limit: 5 })).toBe(1)

    const recovered = await getReplayQueueRow(env.DB, queued.replay_id)
    expect(recovered?.status).toBe('queued')
    expect(recovered?.last_error).toBe('replay_dispatching_stale_requeued')
  })

  it('fails stale dispatching rows once the replay attempt budget is exhausted', async () => {
    const queued = await queueReplayFromExhaustedMessage(env.DB, {
      message: detailMessage('td-fail-budget'),
      errorMessage: 'detail_fetch_failed',
      maxReplayAttempts: 1,
      baseDelaySeconds: 60,
    })
    await env.DB.prepare("UPDATE ingest_replay_queue SET status = 'dispatching', replay_attempt_count = 1, updated_at = '2026-04-25T00:00:00.000Z' WHERE replay_id = ?1")
      .bind(queued.replay_id)
      .run()

    expect(await requeueStaleDispatchingReplayRows(env.DB, { staleMinutes: 15, limit: 5 })).toBe(1)

    const failed = await getReplayQueueRow(env.DB, queued.replay_id)
    expect(failed?.status).toBe('failed')
    expect(failed?.last_error).toBe('replay_dispatching_stale_exhausted')
    expect(failed?.resolved_at).toBeTruthy()
  })

  it('limits stale dispatching recovery to the requested dataset scope', async () => {
    const td = await queueReplayFromExhaustedMessage(env.DB, {
      message: detailMessage('td-filtered'),
      errorMessage: 'queue_message_duplicate_active_claim',
      maxReplayAttempts: 2,
      baseDelaySeconds: 60,
    })
    const savings = await queueReplayFromExhaustedMessage(env.DB, {
      message: detailMessage('savings-filtered', 'savings'),
      errorMessage: 'queue_message_duplicate_active_claim',
      maxReplayAttempts: 2,
      baseDelaySeconds: 60,
    })
    await env.DB.prepare(
      "UPDATE ingest_replay_queue SET status = 'dispatching', replay_attempt_count = 1, updated_at = '2026-04-25T00:00:00.000Z' WHERE replay_id IN (?1, ?2)",
    )
      .bind(td.replay_id, savings.replay_id)
      .run()

    expect(
      await requeueStaleDispatchingReplayRows(env.DB, {
        staleMinutes: 15,
        limit: 5,
        dataset: 'term_deposits',
      }),
    ).toBe(1)

    expect((await getReplayQueueRow(env.DB, td.replay_id))?.status).toBe('queued')
    expect((await getReplayQueueRow(env.DB, savings.replay_id))?.status).toBe('dispatching')
  })
})
