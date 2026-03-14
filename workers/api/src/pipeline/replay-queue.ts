import {
  claimReplayQueueRows,
  markReplayQueueSuccess,
  parseReplayPayload,
  queueReplayFromExhaustedMessage,
  rescheduleReplayQueueRow,
  replayScopeSummary,
  type ReplayQueueRow,
} from '../db/ingest-replay-queue'
import type { DatasetKind } from '../../../../packages/shared/src'
import type { EnvBindings, IngestMessage } from '../types'
import { log } from '../utils/logger'
import { parseIntegerEnv } from '../utils/time'

const DEFAULT_MAX_REPLAY_ATTEMPTS = 2
const DEFAULT_REPLAY_BASE_DELAY_SECONDS = 900

function replayConfig(env: EnvBindings): { maxReplayAttempts: number; baseDelaySeconds: number } {
  return {
    maxReplayAttempts: Math.max(1, parseIntegerEnv(env.MAX_REPLAY_ATTEMPTS, DEFAULT_MAX_REPLAY_ATTEMPTS)),
    baseDelaySeconds: Math.max(60, parseIntegerEnv(env.REPLAY_BASE_DELAY_SECONDS, DEFAULT_REPLAY_BASE_DELAY_SECONDS)),
  }
}

function replayMessage(row: ReplayQueueRow): IngestMessage {
  const message = parseReplayPayload(row) as IngestMessage
  return {
    ...message,
    replayTicketId: row.replay_id,
    replayAttempt: Number(row.replay_attempt_count || 0),
  }
}

export async function scheduleReplayForExhaustedMessage(
  env: EnvBindings,
  input: { message: IngestMessage; errorMessage: string },
): Promise<ReplayQueueRow> {
  const config = replayConfig(env)
  return queueReplayFromExhaustedMessage(env.DB, {
    message: input.message,
    errorMessage: input.errorMessage,
    maxReplayAttempts: config.maxReplayAttempts,
    baseDelaySeconds: config.baseDelaySeconds,
  })
}

export async function handleReplayAttemptFailure(
  env: EnvBindings,
  input: { replayTicketId: string; errorMessage: string },
): Promise<ReplayQueueRow | null> {
  const config = replayConfig(env)
  return rescheduleReplayQueueRow(env.DB, {
    replayId: input.replayTicketId,
    errorMessage: input.errorMessage,
    baseDelaySeconds: config.baseDelaySeconds,
  })
}

export async function handleReplayAttemptSuccess(
  env: EnvBindings,
  replayTicketId: string,
): Promise<void> {
  await markReplayQueueSuccess(env.DB, replayTicketId)
}

export async function dispatchReplayQueue(
  env: EnvBindings,
  input: {
    limit?: number
    lenderCode?: string
    collectionDate?: string
    dataset?: DatasetKind
    forceDue?: boolean
  } = {},
): Promise<{
    claimed: number
    dispatched: number
    failed: number
    rows: Array<{ replay_id: string; message_kind: string; scope: string }>
  }> {
  const claimedRows = await claimReplayQueueRows(env.DB, {
    limit: input.limit ?? 50,
    lenderCode: input.lenderCode,
    collectionDate: input.collectionDate,
    dataset: input.dataset,
    forceDue: input.forceDue,
  })
  if (claimedRows.length === 0) {
    return {
      claimed: 0,
      dispatched: 0,
      failed: 0,
      rows: [],
    }
  }

  try {
    await env.INGEST_QUEUE.sendBatch(
      claimedRows.map((row) => ({
        body: replayMessage(row),
      })),
    )
    claimedRows.forEach((row) => {
      log.warn('consumer', 'replay_queue_dispatched', {
        code: 'replay_queue_dispatched',
        runId: row.run_id ?? undefined,
        lenderCode: row.lender_code ?? undefined,
        context:
          `replay_id=${row.replay_id} message_kind=${row.message_kind}` +
          ` replay_attempt=${row.replay_attempt_count} scope=${replayScopeSummary(row)}`,
      })
    })
    return {
      claimed: claimedRows.length,
      dispatched: claimedRows.length,
      failed: 0,
      rows: claimedRows.map((row) => ({
        replay_id: row.replay_id,
        message_kind: row.message_kind,
        scope: replayScopeSummary(row),
      })),
    }
  } catch (error) {
    const errorMessage = (error as Error)?.message || String(error)
    await Promise.all(
      claimedRows.map((row) =>
        handleReplayAttemptFailure(env, {
          replayTicketId: row.replay_id,
          errorMessage: `replay_dispatch_failed:${errorMessage}`,
        }),
      ),
    )
    log.error('consumer', 'replay_queue_dispatch_failed', {
      code: 'replay_queue_dispatch_failed',
      error,
      context: `claimed=${claimedRows.length} error=${errorMessage}`,
    })
    return {
      claimed: claimedRows.length,
      dispatched: 0,
      failed: claimedRows.length,
      rows: claimedRows.map((row) => ({
        replay_id: row.replay_id,
        message_kind: row.message_kind,
        scope: replayScopeSummary(row),
      })),
    }
  }
}
