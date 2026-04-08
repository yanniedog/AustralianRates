type D1RetryOptions = {
  maxAttempts?: number
  baseDelayMs?: number
  shouldRetry?: (error: unknown) => boolean
  onRetry?: (input: { attempt: number; maxAttempts: number; backoffMs: number; error: unknown }) => void | Promise<void>
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 50

export function isTransientD1Error(error: unknown): boolean {
  const message = ((error as Error)?.message || String(error)).toLowerCase()
  return (
    message.includes('d1_error') ||
    message.includes('sqlite_busy') ||
    message.includes('database is locked') ||
    message.includes('temporarily unavailable') ||
    message.includes('network connection lost') ||
    message.includes('object to be reset') ||
    message.includes('timed out') ||
    message.includes('timeout')
  )
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runWithD1Retry<T>(
  task: () => Promise<T>,
  options: D1RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(Number(options.maxAttempts) || DEFAULT_MAX_ATTEMPTS))
  const baseDelayMs = Math.max(1, Math.floor(Number(options.baseDelayMs) || DEFAULT_BASE_DELAY_MS))
  const shouldRetry = options.shouldRetry ?? isTransientD1Error
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (!shouldRetry(error) || attempt >= maxAttempts) break
      const backoffMs = baseDelayMs * attempt
      await options.onRetry?.({ attempt, maxAttempts, backoffMs, error })
      await sleep(backoffMs)
    }
  }

  throw lastError
}

export async function withD1TransientRetry<T>(task: () => Promise<T>): Promise<T> {
  return runWithD1Retry(task)
}
