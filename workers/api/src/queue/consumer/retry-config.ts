import { persistRawPayload } from '../../db/raw-payloads'
import type { EnvBindings } from '../../types'
import { parseIntegerEnv } from '../../utils/time'
import { isKnownIngestOutcome, isNonRetryableDetailFetchStatus, isNonRetryableIngestOutcome } from './ingest-outcomes'

export function calculateRetryDelaySeconds(attempts: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempts))
  return Math.min(900, 15 * Math.pow(2, safeAttempt - 1))
}

export function maxCdrProductPages(): number {
  return Number.MAX_SAFE_INTEGER
}

export function maxProductsPerLender(env: EnvBindings): number {
  return Math.max(100, Math.min(50000, parseIntegerEnv(env.MAX_PRODUCTS_PER_LENDER, 20000)))
}

export async function persistProductDetailPayload(
  env: EnvBindings,
  _runSource: 'scheduled' | 'manual' | undefined,
  input: Parameters<typeof persistRawPayload>[1],
): Promise<Awaited<ReturnType<typeof persistRawPayload>> | null> {
  return persistRawPayload(env, input)
}

export function isNonRetryableErrorMessage(message: string): boolean {
  if (message.startsWith('detail_fetch_failed:')) {
    const outcome = message.match(/:outcome=([a-z_]+)/)?.[1]
    if (outcome && isKnownIngestOutcome(outcome)) {
      return isNonRetryableIngestOutcome(outcome)
    }
    const status = Number(message.match(/status=(\d+)/)?.[1] ?? 0)
    return isNonRetryableDetailFetchStatus(status)
  }
  return (
    message === 'invalid_queue_message_shape' ||
    message.startsWith('unknown_lender_code:') ||
    message.startsWith('daily_ingest_no_valid_rows:') ||
    message.startsWith('product_detail_missing_context:') ||
    message.startsWith('lender_finalize_missing_run_state:') ||
    message.startsWith('historical_run_not_found:') ||
    message.startsWith('historical_task_claim_failed:') ||
    message.startsWith('historical_task_lender_not_found:')
  )
}
