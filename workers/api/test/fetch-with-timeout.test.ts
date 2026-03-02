import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FetchWithTimeoutError,
  fetchJsonWithTimeout,
  fetchWithTimeout,
} from '../src/utils/fetch-with-timeout'

const originalFetch = globalThis.fetch

function makeAbortError(message: string): Error {
  const err = new Error(message)
  Object.defineProperty(err, 'name', { value: 'AbortError' })
  return err
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('fetchWithTimeout', () => {
  it('aborts on timeout and reports timeout metadata', async () => {
    vi.useFakeTimers()
    const fetchStub = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            reject(makeAbortError('aborted'))
          },
          { once: true },
        )
      })
    })
    globalThis.fetch = fetchStub as typeof fetch

    const pending = fetchWithTimeout('https://example.com/timeout', undefined, {
      timeoutMs: 100,
      maxRetries: 0,
    })
    const captured = pending.catch((err) => err as FetchWithTimeoutError)

    await vi.advanceTimersByTimeAsync(100)
    const error = await captured

    expect(error).toBeInstanceOf(FetchWithTimeoutError)
    expect(error.meta.timed_out).toBe(true)
    expect(error.meta.attempts).toBe(1)
    expect(error.meta.status).toBeNull()
    expect(error.meta.last_error_class).toBe('timeout')
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it.each([
    { status: 500, reason: 'http_5xx:status=500' },
    { status: 429, reason: 'http_429:status=429' },
    { status: 408, reason: 'http_408:status=408' },
  ])('retries on retryable status $status', async ({ status, reason }) => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(new Response('retryable', { status }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    globalThis.fetch = fetchStub as typeof fetch

    const pending = fetchWithTimeout('https://example.com/retry', undefined, {
      maxRetries: 2,
      retryBaseMs: 10,
      retryCapMs: 10,
    })

    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.response.status).toBe(200)
    expect(result.meta.attempts).toBe(2)
    expect(result.meta.status).toBe(200)
    expect(result.meta.retry_reasons).toEqual([reason])
    expect(fetchStub).toHaveBeenCalledTimes(2)
  })

  it.each([400, 401, 403, 404])('does not retry non-retryable status %s', async (status) => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('no retry', { status }))
    globalThis.fetch = fetchStub as typeof fetch

    const result = await fetchWithTimeout('https://example.com/non-retry', undefined, {
      maxRetries: 2,
    })

    expect(result.response.status).toBe(status)
    expect(result.meta.attempts).toBe(1)
    expect(result.meta.retry_reasons).toEqual([])
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('fetchJsonWithTimeout parses JSON and preserves retry metadata', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true,"source":"test"}', { status: 200 }))
    globalThis.fetch = fetchStub as typeof fetch

    const pending = fetchJsonWithTimeout('https://example.com/json', undefined, {
      maxRetries: 2,
      retryBaseMs: 5,
      retryCapMs: 5,
    })

    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.response.status).toBe(200)
    expect(result.json).toEqual({ ok: true, source: 'test' })
    expect(result.meta.attempts).toBe(2)
    expect(result.meta.status).toBe(200)
    expect(result.meta.retry_reasons).toEqual(['http_5xx:status=503'])
    expect(result.meta.last_error_class).toBe('http_5xx')
  })
})
