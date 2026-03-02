import { DEFAULT_MAX_QUEUE_ATTEMPTS } from '../../constants'
import { recordRunQueueOutcome } from '../../db/run-reports'
import type { EnvBindings, IngestMessage } from '../../types'
import { log } from '../../utils/logger'
import { parseIntegerEnv } from '../../utils/time'
import { processMessage } from './dispatch'
import { claimIdempotency } from './idempotency'
import { elapsedMs, serializeForLog } from './log-helpers'
import { extractRunContext, isIngestMessage, isObject } from './message-shape'
import { calculateRetryDelaySeconds, isNonRetryableErrorMessage } from './retry-config'

export async function consumeIngestQueue(batch: MessageBatch<IngestMessage>, env: EnvBindings): Promise<void> {
  const startedAt = Date.now()
  const maxAttempts = parseIntegerEnv(env.MAX_QUEUE_ATTEMPTS, DEFAULT_MAX_QUEUE_ATTEMPTS)
  const metrics = {
    processed: 0,
    acked: 0,
    retried: 0,
    success: 0,
    failed: 0,
    nonRetryable: 0,
    exhausted: 0,
    invalidShape: 0,
    duplicates: 0,
  }
  log.info('consumer', `queue_batch received ${batch.messages.length} messages`, {
    context: `max_attempts=${maxAttempts}`,
  })

  for (const msg of batch.messages) {
    const messageStartedAt = Date.now()
    const attempts = Number(msg.attempts || 1)
    const body = msg.body
    const context = extractRunContext(body)
    const messageKind = isObject(body) && typeof body.kind === 'string' ? body.kind : 'unknown'
    const bodyAttempt = isObject(body) && Number.isFinite(Number(body.attempt)) ? Number(body.attempt) : null
    const idempotencyKey = isObject(body) && typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null
    const messageContext =
      `kind=${messageKind}` +
      ` queue_attempt=${attempts}/${maxAttempts}` +
      ` body_attempt=${bodyAttempt ?? 'na'}` +
      ` idempotency=${idempotencyKey ?? 'na'}`

    log.info('consumer', 'queue_message_start', {
      runId: context.runId ?? undefined,
      lenderCode: context.lenderCode ?? undefined,
      context: messageContext,
    })

    try {
      if (!isIngestMessage(body)) {
        metrics.invalidShape += 1
        log.error('consumer', 'invalid_queue_message_shape', {
          context: `${messageContext} body=${serializeForLog(body)}`,
        })
        throw new Error('invalid_queue_message_shape')
      }

      const claim = await claimIdempotency(env, {
        kind: body.kind,
        idempotencyKey,
        runId: context.runId,
        lenderCode: context.lenderCode,
      })
      if (claim.reason === 'missing_key' || claim.reason === 'kv_missing' || claim.reason === 'kv_error') {
        log.warn('consumer', 'queue_idempotency_degraded', {
          runId: context.runId ?? undefined,
          lenderCode: context.lenderCode ?? undefined,
          context:
            `${messageContext} reason=${claim.reason}` +
            ` key=${claim.key ?? 'none'} ttl=${claim.ttlSeconds}` +
            `${claim.error ? ` error=${claim.error}` : ''}`,
        })
      }
      if (claim.duplicate) {
        metrics.duplicates += 1
        msg.ack()
        metrics.acked += 1
        log.info('consumer', 'queue_message_duplicate_ack', {
          runId: context.runId ?? undefined,
          lenderCode: context.lenderCode ?? undefined,
          context:
            `${messageContext} key=${claim.key ?? 'none'}` +
            ` ttl=${claim.ttlSeconds} elapsed_ms=${elapsedMs(messageStartedAt)}`,
        })
        continue
      }

      await processMessage(env, body)

      if (context.runId && context.lenderCode) {
        await recordRunQueueOutcome(env.DB, {
          runId: context.runId,
          lenderCode: context.lenderCode,
          success: true,
        })
      }

      msg.ack()
      metrics.success += 1
      metrics.acked += 1
      log.info('consumer', 'queue_message_ack', {
        runId: context.runId ?? undefined,
        lenderCode: context.lenderCode ?? undefined,
        context: `${messageContext} elapsed_ms=${elapsedMs(messageStartedAt)}`,
      })
    } catch (error) {
      metrics.failed += 1
      const errorMessage = (error as Error)?.message || String(error)
      log.error('consumer', `queue_message_failed attempt=${attempts}/${maxAttempts}: ${errorMessage}`, {
        runId: context.runId ?? undefined,
        lenderCode: context.lenderCode ?? undefined,
        context: `${messageContext} elapsed_ms=${elapsedMs(messageStartedAt)}`,
      })

      if (isNonRetryableErrorMessage(errorMessage)) {
        metrics.nonRetryable += 1
        log.warn('consumer', 'queue_message_non_retryable', {
          runId: context.runId ?? undefined,
          lenderCode: context.lenderCode ?? undefined,
          context: `${messageContext} error=${errorMessage}`,
        })
        if (context.runId && context.lenderCode) {
          await recordRunQueueOutcome(env.DB, {
            runId: context.runId,
            lenderCode: context.lenderCode,
            success: false,
            errorMessage,
          })
        }
        msg.ack()
        metrics.acked += 1
        continue
      }

      if (attempts >= maxAttempts) {
        metrics.exhausted += 1
        log.error('consumer', `queue_message_exhausted max_attempts=${maxAttempts}`, {
          runId: context.runId ?? undefined,
          lenderCode: context.lenderCode ?? undefined,
          context: `${messageContext} error=${errorMessage}`,
        })
        if (context.runId && context.lenderCode) {
          await recordRunQueueOutcome(env.DB, {
            runId: context.runId,
            lenderCode: context.lenderCode,
            success: false,
            errorMessage,
          })
        }
        msg.ack()
        metrics.acked += 1
        continue
      }

      const retryDelaySeconds = calculateRetryDelaySeconds(attempts)
      msg.retry({
        delaySeconds: retryDelaySeconds,
      })
      metrics.retried += 1
      log.warn('consumer', 'queue_message_retry_scheduled', {
        runId: context.runId ?? undefined,
        lenderCode: context.lenderCode ?? undefined,
        context:
          `${messageContext} delay_seconds=${retryDelaySeconds}` +
          ` error=${errorMessage} elapsed_ms=${elapsedMs(messageStartedAt)}`,
      })
    } finally {
      metrics.processed += 1
    }
  }

  log.info('consumer', 'queue_batch completed', {
    context:
      `messages=${batch.messages.length} processed=${metrics.processed}` +
      ` acked=${metrics.acked} retried=${metrics.retried}` +
      ` success=${metrics.success} failed=${metrics.failed}` +
      ` non_retryable=${metrics.nonRetryable} exhausted=${metrics.exhausted}` +
      ` invalid_shape=${metrics.invalidShape} duplicates=${metrics.duplicates}` +
      ` total_ms=${elapsedMs(startedAt)}`,
  })
}
