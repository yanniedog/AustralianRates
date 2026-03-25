#!/usr/bin/env node
/**
 * E2E: trigger admin reconcile for UBank + date, then poll coverage-gaps until
 * ubank/savings is no longer an error (or timeout).
 *
 * Usage:
 *   node verify-ubank-savings-gap.mjs [YYYY-MM-DD]
 *
 * Requires ADMIN_API_TOKEN in environment or .env (same as production API worker).
 * API base: API_BASE or https://www.australianrates.com
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadDotEnv() {
  const p = resolve(process.cwd(), '.env')
  if (!existsSync(p)) return
  const raw = readFileSync(p, 'utf8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}

loadDotEnv()

const base = (process.env.API_BASE || 'https://www.australianrates.com').replace(/\/$/, '')
const token = process.env.ADMIN_API_TOKEN || ''
const collectionDate = process.argv[2] || process.env.COLLECTION_DATE
const pollMs = Math.max(5000, Number(process.env.VERIFY_POLL_MS || 20000))
const maxAttempts = Math.max(1, Number(process.env.VERIFY_MAX_ATTEMPTS || 45))
const logPath = resolve(process.cwd(), 'debug-cfdd1c.log')

function ndlog(payload) {
  appendFileSync(logPath, `${JSON.stringify({ ...payload, timestamp: Date.now() })}\n`)
}

async function adminFetch(path, init) {
  const url = `${base}/api/home-loan-rates/admin${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { _raw: text }
  }
  return { res, json }
}

function findUbankSavingsError(rows) {
  if (!Array.isArray(rows)) return null
  return (
    rows.find(
      (r) =>
        r.lender_code === 'ubank' &&
        r.dataset_kind === 'savings' &&
        r.collection_date === collectionDate &&
        r.severity === 'error',
    ) || null
  )
}

async function main() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate || '')) {
    console.error('Usage: node verify-ubank-savings-gap.mjs YYYY-MM-DD')
    process.exit(1)
  }
  if (!token) {
    console.error('Missing ADMIN_API_TOKEN (set in .env or environment).')
    process.exit(1)
  }

  console.log(`verify-ubank-savings-gap: collection_date=${collectionDate} base=${base}`)

  const reconcile = await adminFetch('/runs/reconcile-lender-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collection_date: collectionDate,
      lender_code: 'ubank',
      datasets: ['savings', 'term_deposits'],
    }),
  })

  ndlog({
    sessionId: 'cfdd1c',
    hypothesisId: 'E2E',
    location: 'verify-ubank-savings-gap.mjs',
    message: 'reconcile_response',
    data: { status: reconcile.res.status, ok: reconcile.json?.ok, result: reconcile.json?.result },
  })

  if (!reconcile.res.ok) {
    console.error('reconcile HTTP', reconcile.res.status, JSON.stringify(reconcile.json).slice(0, 500))
    process.exit(1)
  }

  console.log('reconcile queued:', JSON.stringify(reconcile.json?.result || {}, null, 0).slice(0, 300))

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const gaps = await adminFetch(
      `/diagnostics/coverage-gaps?lender_code=ubank&collection_date=${encodeURIComponent(collectionDate)}&dataset=savings&limit=50`,
      { method: 'GET' },
    )
    const rows = gaps.json?.report?.rows
    const bad = findUbankSavingsError(rows)
    ndlog({
      sessionId: 'cfdd1c',
      hypothesisId: 'E2E',
      location: 'verify-ubank-savings-gap.mjs',
      message: 'poll_coverage_gaps',
      data: {
        attempt,
        httpStatus: gaps.res.status,
        gapCount: Array.isArray(rows) ? rows.length : null,
        ubankSavingsError: bad
          ? { severity: bad.severity, reasons: bad.reasons, index_fetch_succeeded: bad.index_fetch_succeeded }
          : null,
      },
    })

    if (!bad) {
      console.log(`OK: no ubank/savings error row for ${collectionDate} (attempt ${attempt}).`)
      ndlog({
        sessionId: 'cfdd1c',
        hypothesisId: 'E2E',
        message: 'verify_pass',
        data: { collectionDate, attempts: attempt },
      })
      process.exit(0)
    }

    console.log(
      `attempt ${attempt}/${maxAttempts}: still error:`,
      bad.reasons?.join(', ') || bad.severity,
      `(sleep ${pollMs}ms)`,
    )
    await new Promise((r) => setTimeout(r, pollMs))
  }

  console.error('TIMEOUT: ubank savings still shows coverage error after', maxAttempts, 'polls')
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
