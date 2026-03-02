import { persistRawPayload } from '../../db/raw-payloads'
import type { EnvBindings } from '../../types'
import { parseIntegerEnv } from '../../utils/time'

export function calculateRetryDelaySeconds(attempts: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempts))
  return Math.min(900, 15 * Math.pow(2, safeAttempt - 1))
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

export function maxCdrProductPages(): number {
  return Number.MAX_SAFE_INTEGER
}

export function maxProductsPerLender(env: EnvBindings): number {
  return Math.max(100, Math.min(50000, parseIntegerEnv(env.MAX_PRODUCTS_PER_LENDER, 20000)))
}

export async function persistProductDetailPayload(
  env: EnvBindings,
  runSource: 'scheduled' | 'manual' | undefined,
  input: Parameters<typeof persistRawPayload>[1],
): Promise<Awaited<ReturnType<typeof persistRawPayload>> | null> {
  const persistSuccessful = parseBooleanEnv(env.PERSIST_SUCCESSFUL_PRODUCT_DETAILS, false)
  const isScheduled = (runSource ?? 'scheduled') === 'scheduled'
  const isSuccess = (input.httpStatus ?? 200) < 400
  if (isScheduled && isSuccess && !persistSuccessful) {
    return null
  }
  return persistRawPayload(env, input)
}

export function isNonRetryableErrorMessage(message: string): boolean {
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
