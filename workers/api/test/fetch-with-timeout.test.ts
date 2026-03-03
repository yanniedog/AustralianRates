import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FetchWithTimeoutError,
  fetchJsonWithTimeout,
  fetchWithTimeout,
} from '../src/utils/fetch-with-timeout'

type TestServer = {
  server: Server
  baseUrl: string
  close: () => Promise<void>
}

async function startTestServer(
  handler: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void,
): Promise<TestServer> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve test server address')
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

const activeServers: TestServer[] = []

afterEach(async () => {
  while (activeServers.length > 0) {
    const next = activeServers.pop()
    if (next) await next.close()
  }
})

describe('fetchWithTimeout', () => {
  it('aborts on timeout and reports timeout metadata', async () => {
    const testServer = await startTestServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      }, 250)
    })
    activeServers.push(testServer)

    const captured = fetchWithTimeout(`${testServer.baseUrl}/timeout`, undefined, {
      timeoutMs: 40,
      maxRetries: 0,
    }).catch((err) => err as FetchWithTimeoutError)

    const error = await captured

    expect(error).toBeInstanceOf(FetchWithTimeoutError)
    expect(error.meta.timed_out).toBe(true)
    expect(error.meta.attempts).toBe(1)
    expect(error.meta.status).toBeNull()
    expect(error.meta.last_error_class).toBe('timeout')
  })

  it.each([
    { status: 500, reason: 'http_5xx:status=500' },
    { status: 429, reason: 'http_429:status=429' },
    { status: 408, reason: 'http_408:status=408' },
  ])('retries on retryable status $status', async ({ status, reason }) => {
    let requests = 0
    const testServer = await startTestServer((_req, res) => {
      requests += 1
      if (requests === 1) {
        res.writeHead(status, { 'Content-Type': 'text/plain' })
        res.end('retryable')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
    activeServers.push(testServer)

    const result = await fetchWithTimeout(`${testServer.baseUrl}/retry`, undefined, {
      maxRetries: 2,
      retryBaseMs: 5,
      retryCapMs: 5,
    })

    expect(result.response.status).toBe(200)
    expect(result.meta.attempts).toBe(2)
    expect(result.meta.retry_reasons).toEqual([reason])
    expect(requests).toBe(2)
  })

  it.each([400, 401, 403, 404])('does not retry non-retryable status %s', async (status) => {
    let requests = 0
    const testServer = await startTestServer((_req, res) => {
      requests += 1
      res.writeHead(status, { 'Content-Type': 'text/plain' })
      res.end('no retry')
    })
    activeServers.push(testServer)

    const result = await fetchWithTimeout(`${testServer.baseUrl}/non-retry`, undefined, {
      maxRetries: 2,
    })

    expect(result.response.status).toBe(status)
    expect(result.meta.attempts).toBe(1)
    expect(result.meta.retry_reasons).toEqual([])
    expect(requests).toBe(1)
  })

  it('fetchJsonWithTimeout parses JSON and preserves retry metadata', async () => {
    let requests = 0
    const testServer = await startTestServer((_req, res) => {
      requests += 1
      if (requests === 1) {
        res.writeHead(503, { 'Content-Type': 'text/plain' })
        res.end('upstream busy')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true,"source":"test"}')
    })
    activeServers.push(testServer)

    const result = await fetchJsonWithTimeout(`${testServer.baseUrl}/json`, undefined, {
      maxRetries: 2,
      retryBaseMs: 5,
      retryCapMs: 5,
    })

    expect(result.response.status).toBe(200)
    expect(result.json).toEqual({ ok: true, source: 'test' })
    expect(result.meta.attempts).toBe(2)
    expect(result.meta.retry_reasons).toEqual(['http_5xx:status=503'])
  })
})
