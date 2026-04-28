/**
 * Production cache refresh via admin API.
 * - Default: public snapshot KV only (`/public-packages/refresh`) — usually enough to "flush"
 *   stale snapshot keys after a deploy; bounded CPU.
 * - `--chart-pivot`: also runs full `chart-cache/refresh` (rebuilds D1 chart caches + snapshots).
 *   **Warning:** That route can exceed Worker CPU limits on large DBs (Cloudflare 1102). Use sparingly.
 *
 * Loads repo root .env for ADMIN_API_TOKEN.
 *
 * Usage:
 *   CACHE_FLUSH_ORIGIN=https://www.australianrates.com node flush-production-caches.mjs
 *   … same … --chart-pivot
 * Or pass `--origin=https://…` (overrides env when both set — env wins if you omit CLI).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Agent, fetch as undiciFetch } from 'undici'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv
const wantChartPivot = argv.includes('--chart-pivot')

function parseOriginCli(args) {
  const raw = args.find((a) => typeof a === 'string' && a.startsWith('--origin='))
  return raw ? raw.slice('--origin='.length).trim() : ''
}

const LONG_MS = 900_000
const dispatcher = new Agent({
  headersTimeout: LONG_MS,
  bodyTimeout: LONG_MS,
  connectTimeout: 120_000,
})

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env')
  let raw
  try {
    raw = fs.readFileSync(envPath, 'utf8')
  } catch {
    return
  }
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eq = trimmed.indexOf('=')
    if (eq <= 0) return
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = val
  })
}

async function postJson(url, token) {
  const res = await undiciFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${String(token).trim()}`,
      Accept: 'application/json',
    },
    dispatcher,
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text }
  }
  return { status: res.status, body }
}

async function main() {
  loadDotEnv()
  const token = process.env.ADMIN_API_TOKEN
  if (!token) {
    console.error('Missing ADMIN_API_TOKEN in environment or .env')
    process.exit(1)
  }
  const origin = String(process.env.CACHE_FLUSH_ORIGIN || '').trim() || parseOriginCli(argv)
  if (!origin) {
    console.error(
      'Set CACHE_FLUSH_ORIGIN or pass --origin=https://… (no implicit production default). Example: CACHE_FLUSH_ORIGIN=https://www.australianrates.com',
    )
    process.exit(1)
  }
  const baseHl = `${origin.replace(/\/$/, '')}/api/home-loan-rates/admin`

  if (wantChartPivot) {
    console.log('POST chart-cache/refresh (heavy — may 1102 on large DBs)...')
    const chart = await postJson(`${baseHl}/chart-cache/refresh`, token)
    console.log('chart-cache/refresh', chart.status, JSON.stringify(chart.body, null, 2))
    if (chart.status === 503) {
      console.error(
        'chart-cache/refresh returned 503 (often Worker CPU limit). Omit --chart-pivot or retry off-peak.',
      )
      process.exit(1)
    }
    if (chart.status >= 400) process.exit(1)
  }

  console.log('POST public-packages/refresh?full=1&force=1 ...')
  const pkg = await postJson(`${baseHl}/public-packages/refresh?full=1&force=1`, token)
  console.log('public-packages/refresh', pkg.status, JSON.stringify(pkg.body, null, 2))
  if (pkg.status >= 400 || (pkg.body && pkg.body.ok === false)) process.exit(1)

  console.log('done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

