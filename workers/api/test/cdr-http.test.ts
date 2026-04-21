import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCdrJson, fetchJson } from '../src/ingest/cdr/http'
import { log } from '../src/utils/logger'

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
  vi.restoreAllMocks()
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

  it('sends x-min-v equal to x-v on each probe so strict-version servers accept the request', async () => {
    const probes: Array<{ xv: string; xminv: string }> = []
    const testServer = await startTestServer((req, res) => {
      const xv = String(req.headers['x-v'] || '')
      const xminv = String(req.headers['x-min-v'] || '')
      probes.push({ xv, xminv })
      // Simulate NAB: reject unless x-min-v >= 4 AND x-v within [4, 6].
      const xvNum = Number(xv)
      const xminvNum = Number(xminv)
      if (!Number.isFinite(xvNum) || !Number.isFinite(xminvNum) || xminvNum < 4 || xvNum < 4 || xvNum > 6) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            errors: [
              {
                code: 'urn:au-cds:error:cds-all:Header/UnsupportedVersion',
                title: 'Unsupported Version',
                detail: 'Minimum version supported is 4 and Maximum version supported is 6',
              },
            ],
          }),
        )
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: { products: [{ productId: 'ok' }] } }))
    })
    activeServers.push(testServer)

    const result = await fetchCdrJson(`${testServer.baseUrl}/products`, [6, 5, 4, 3])

    expect(result.ok).toBe(true)
    // First probe should satisfy the strict server (x-v=6, x-min-v=6).
    expect(probes[0]).toEqual({ xv: '6', xminv: '6' })
    // Every probe should carry x-min-v equal to x-v; never the old `x-min-v: 1` default.
    for (const probe of probes) {
      expect(probe.xminv).toBe(probe.xv)
    }
  })

  it('returns the last probe response when every version attempt fails (no unversioned final request)', async () => {
    const probes: string[] = []
    const testServer = await startTestServer((req, res) => {
      const xv = String(req.headers['x-v'] || '(none)')
      probes.push(xv)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          errors: [
            {
              code: 'urn:au-cds:error:cds-all:Header/UnsupportedVersion',
              title: 'Unsupported Version',
              detail: 'Minimum version supported is 99',
            },
          ],
        }),
      )
    })
    activeServers.push(testServer)

    const result = await fetchCdrJson(`${testServer.baseUrl}/products`, [6, 5, 4, 3])

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    // Confirm no probe was sent without an x-v header (that path was removed; it never
    // produced a usable CDR response and caused noisy `status=0` fetch events).
    expect(probes).not.toContain('(none)')
    expect(probes.length).toBeGreaterThan(0)
  })

  it('does not warn for 406 version probes when a later fallback version succeeds', async () => {
    const requestedVersions: string[] = []
    const warnSpy = vi.spyOn(log, 'warn')
    const testServer = await startTestServer((req, res) => {
      const version = String(req.headers['x-v'] || '')
      requestedVersions.push(version)
      res.writeHead(version === '2' ? 200 : 406, { 'Content-Type': 'application/json' })
      if (version === '2') {
        res.end(JSON.stringify({ data: { products: [] } }))
        return
      }
      res.end(
        JSON.stringify({
          errors: [
            {
              code: 'PCUA006',
              title: 'Unsupported Version',
              detail: 'Unable to find the version requested in x-v',
            },
          ],
        }),
      )
    })
    activeServers.push(testServer)

    const result = await fetchCdrJson(`${testServer.baseUrl}/products`, [3, 4])

    expect(result.ok).toBe(true)
    expect(requestedVersions).toContain('3')
    expect(requestedVersions).toContain('4')
    expect(requestedVersions).toContain('2')
    expect(
      warnSpy.mock.calls.some((call) => call[1] === 'cdr_406_no_versions_advertised'),
    ).toBe(false)
  })
})
