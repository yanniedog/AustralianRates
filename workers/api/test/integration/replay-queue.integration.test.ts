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

function detailMessage(productId: string): IngestMessage {
  return {
    kind: 'product_detail_fetch',
    runId: RUN_ID,
    runSource: 'scheduled',
    lenderCode: 'anz',
    dataset: 'term_deposits',
    productId,
    collectionDate: '2026-04-25',
    attempt: 0,
    idempotencyKey: `${RUN_ID}:anz:term_deposits:${productId}`,
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
})
