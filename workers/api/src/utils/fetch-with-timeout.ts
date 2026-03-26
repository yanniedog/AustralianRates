export type RetryClass = 'timeout' | 'network' | 'http_5xx' | 'http_429' | 'http_408' | 'other'

export type FetchRetryEnv = {
  FETCH_TIMEOUT_MS?: string
  FETCH_MAX_RETRIES?: string
  FETCH_RETRY_BASE_MS?: string
  FETCH_RETRY_CAP_MS?: string
}

export type FetchWithTimeoutMeta = {
  attempts: number
  elapsed_ms: number
  timed_out: boolean
  status: number | null
  retry_reasons: string[]
  last_error_class: RetryClass
}

export type FetchWithTimeoutResult = {
  response: Response
  meta: FetchWithTimeoutMeta
}

export type FetchWithTimeoutOptions = {
  env?: FetchRetryEnv
  timeoutMs?: number
  maxRetries?: number
  retryBaseMs?: number
  retryCapMs?: number
}

/** rba.gov.au often responds 403 to generic fetch clients (e.g. default Workers User-Agent). */
export const RBA_GOV_AU_FETCH_INIT: RequestInit = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; AustralianRates/1.0; +https://www.australianrates.com)',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/csv,text/plain,*/*;q=0.8',
    'Accept-Language': 'en-AU,en;q=0.9',
  },
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_BASE_MS = 250
const DEFAULT_RETRY_CAP_MS = 5_000

function parseInteger(value: string | undefined, fallback: number, min = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.floor(parsed))
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'invalid_url'
  }
}

function resolveConfig(options?: FetchWithTimeoutOptions) {
  const env = options?.env
  return {
    timeoutMs: options?.timeoutMs ?? parseInteger(env?.FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1),
    maxRetries: options?.maxRetries ?? parseInteger(env?.FETCH_MAX_RETRIES, DEFAULT_MAX_RETRIES, 0),
    retryBaseMs: options?.retryBaseMs ?? parseInteger(env?.FETCH_RETRY_BASE_MS, DEFAULT_RETRY_BASE_MS, 1),
    retryCapMs: options?.retryCapMs ?? parseInteger(env?.FETCH_RETRY_CAP_MS, DEFAULT_RETRY_CAP_MS, 1),
  }
}

function classifyStatus(status: number): RetryClass {
  if (status === 408) return 'http_408'
  if (status === 429) return 'http_429'
  if (status >= 500 && status <= 599) return 'http_5xx'
  return 'other'
}

function shouldRetryStatus(status: number): boolean {
  if (status === 408 || status === 429) return true
  return status >= 500 && status <= 599
}

function classifyError(error: unknown, timedOut: boolean): RetryClass {
  if (timedOut) return 'timeout'
  const name = (error as { name?: string })?.name || ''
  if (name === 'AbortError') return 'network'
  return 'network'
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function maybeAttachExternalAbort(controller: AbortController, signal: AbortSignal | null | undefined): () => void {
  if (!signal) return () => {}
  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => {}
  }
  const forwardAbort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', forwardAbort, { once: true })
  return () => signal.removeEventListener('abort', forwardAbort)
}

export function computeRetryDelayMs(
  retryAttempt: number,
  retryBaseMs: number,
  retryCapMs: number,
  randomValue = Math.random(),
): number {
  const multiplier = Math.max(1, Math.floor(retryAttempt))
  const exponential = retryBaseMs * 2 ** (multiplier - 1)
  const bounded = Math.min(retryCapMs, exponential)
  const jitter = 0.7 + 0.6 * Math.max(0, Math.min(1, randomValue))
  return Math.max(1, Math.floor(bounded * jitter))
}

export class FetchWithTimeoutError extends Error {
  readonly meta: FetchWithTimeoutMeta

  constructor(message: string, meta: FetchWithTimeoutMeta) {
    super(message)
    this.name = 'FetchWithTimeoutError'
    this.meta = meta
  }
}

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  options?: FetchWithTimeoutOptions,
): Promise<FetchWithTimeoutResult> {
  const startedAt = Date.now()
  const config = resolveConfig(options)
  const maxAttempts = config.maxRetries + 1
  const retryReasons: string[] = []
  let timedOut = false
  let lastErrorClass: RetryClass = 'other'
  let status: number | null = null
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    let timeoutTriggered = false
    const timeoutId = setTimeout(() => {
      timeoutTriggered = true
      controller.abort(new Error(`fetch_timeout_${config.timeoutMs}ms`))
    }, config.timeoutMs)
    const detach = maybeAttachExternalAbort(controller, init?.signal)

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      detach()

      status = response.status
      if (shouldRetryStatus(response.status) && attempt < maxAttempts) {
        lastErrorClass = classifyStatus(response.status)
        retryReasons.push(`${lastErrorClass}:status=${response.status}`)
        const delayMs = computeRetryDelayMs(attempt, config.retryBaseMs, config.retryCapMs)
        await sleep(delayMs)
        continue
      }

      return {
        response,
        meta: {
          attempts: attempt,
          elapsed_ms: Date.now() - startedAt,
          timed_out: timedOut,
          status: response.status,
          retry_reasons: retryReasons,
          last_error_class: shouldRetryStatus(response.status) ? classifyStatus(response.status) : lastErrorClass,
        },
      }
    } catch (error) {
      clearTimeout(timeoutId)
      detach()
      status = null
      timedOut = timedOut || timeoutTriggered
      lastErrorClass = classifyError(error, timeoutTriggered)
      lastError = error
      retryReasons.push(lastErrorClass)

      if (attempt < maxAttempts) {
        const delayMs = computeRetryDelayMs(attempt, config.retryBaseMs, config.retryCapMs)
        await sleep(delayMs)
        continue
      }
      break
    }
  }

  const meta: FetchWithTimeoutMeta = {
    attempts: maxAttempts,
    elapsed_ms: Date.now() - startedAt,
    timed_out: timedOut,
    status,
    retry_reasons: retryReasons,
    last_error_class: lastErrorClass,
  }
  const message = (lastError as Error)?.message || `fetch failed for ${url}`
  throw new FetchWithTimeoutError(message, meta)
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function fetchJsonWithTimeout(
  url: string,
  init?: RequestInit,
  options?: FetchWithTimeoutOptions,
): Promise<{ json: unknown; response: Response; meta: FetchWithTimeoutMeta }> {
  const { response, meta } = await fetchWithTimeout(url, init, options)
  const text = await response.text()
  return {
    json: parseJsonSafe(text),
    response,
    meta,
  }
}
