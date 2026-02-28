import { Resolver } from 'node:dns/promises'
import tls from 'node:tls'

const HOSTS = ['www.australianrates.com', 'australianrates.com']
const API_PATHS = [
  '/',
  '/api/home-loan-rates/health',
  '/api/savings-rates/health',
  '/api/term-deposit-rates/health',
]
const RESOLVERS = ['1.1.1.1', '8.8.8.8']

async function resolveHost(host) {
  const results = []
  for (const server of RESOLVERS) {
    const resolver = new Resolver()
    resolver.setServers([server])
    try {
      const addresses = await resolver.resolve4(host)
      results.push({ resolver: server, ok: true, addresses })
    } catch (error) {
      results.push({ resolver: server, ok: false, error: String(error?.message || error) })
    }
  }
  return results
}

async function verifyTls(host) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        rejectUnauthorized: true,
      },
      () => {
        const cert = socket.getPeerCertificate()
        resolve({
          ok: socket.authorized,
          authorized: socket.authorized,
          authorizationError: socket.authorizationError || null,
          subject: cert?.subject?.CN || null,
          issuer: cert?.issuer?.CN || null,
        })
        socket.end()
      },
    )
    socket.setTimeout(15000, () => {
      resolve({ ok: false, authorized: false, authorizationError: 'tls_timeout' })
      socket.destroy()
    })
    socket.on('error', (error) => {
      resolve({ ok: false, authorized: false, authorizationError: String(error?.message || error) })
    })
  })
}

async function fetchUrl(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'australianrates-prod-verifier/1.0',
      },
    })
    const text = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      snippet: text.slice(0, 160),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      error: String(error?.message || error),
    }
  }
}

async function main() {
  const summary = []
  let failed = false

  for (const host of HOSTS) {
    const dns = await resolveHost(host)
    const tlsCheck = await verifyTls(host)
    const fetches = []
    for (const path of API_PATHS) {
      fetches.push(await fetchUrl(`https://${host}${path}`))
    }

    const hostFailed =
      dns.some((item) => !item.ok) ||
      !tlsCheck.ok ||
      fetches.some((item) => !item.ok)

    failed ||= hostFailed
    summary.push({
      host,
      dns,
      tls: tlsCheck,
      fetches,
    })
  }

  console.log(JSON.stringify({ ok: !failed, checked_at: new Date().toISOString(), summary }, null, 2))
  if (failed) {
    process.exitCode = 1
  }
}

await main()
