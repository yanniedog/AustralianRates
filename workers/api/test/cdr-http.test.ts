import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchCdrJson, fetchJson } from '../src/ingest/cdr/http'

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

describe('CDR HTTP helpers', () => {
  it('treats CDR error payloads as not ok even when status is 200', async () => {
    const testServer = await startTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ errors: [{ code: 'bad_version' }] }))
    })
    activeServers.push(testServer)

    const result = await fetchJson(`${testServer.baseUrl}/error`)

    expect(result.status).toBe(200)
    expect(result.ok).toBe(false)
  })

  it('treats embedded CDR errorCode payloads as not ok even when status is 200', async () => {
    const testServer = await startTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ errorCode: '400', errorMessage: 'bad request' }))
    })
    activeServers.push(testServer)

    const result = await fetchJson(`${testServer.baseUrl}/error-code`)

    expect(result.status).toBe(200)
    expect(result.ok).toBe(false)
  })

  it('continues CDR version probing when an attempted version returns JSON errors', async () => {
    const requestedVersions: string[] = []
    const testServer = await startTestServer((req, res) => {
      const version = String(req.headers['x-v'] || '')
      requestedVersions.push(version)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (version === '3') {
        res.end(JSON.stringify({ errors: [{ code: 'unsupported' }] }))
        return
      }
      if (version === '4') {
        res.end(JSON.stringify({ data: { products: [] } }))
        return
      }
      res.end(JSON.stringify({ errors: [{ code: 'unexpected' }] }))
    })
    activeServers.push(testServer)

    const result = await fetchCdrJson(`${testServer.baseUrl}/products`, [3, 4])

    expect(result.ok).toBe(true)
    expect(requestedVersions).toContain('3')
    expect(requestedVersions).toContain('4')
  })
})
