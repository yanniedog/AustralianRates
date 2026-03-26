const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 40

function isTransientD1Error(error: unknown): boolean {
  const message = ((error as Error)?.message || String(error)).toLowerCase()
  return (
    message.includes('d1_error') ||
    message.includes('sqlite_busy') ||
    message.includes('database is locked') ||
    message.includes('temporarily unavailable') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('queued for too long')
  )
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withD1TransientRetry<T>(
  task: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(Number(options?.maxAttempts) || DEFAULT_MAX_ATTEMPTS))
  const baseDelayMs = Math.max(1, Math.floor(Number(options?.baseDelayMs) || DEFAULT_BASE_DELAY_MS))
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      const retryable = isTransientD1Error(error)
      if (!retryable || attempt >= maxAttempts) break
      await sleep(baseDelayMs * attempt)
    }
  }

  throw lastError
}
