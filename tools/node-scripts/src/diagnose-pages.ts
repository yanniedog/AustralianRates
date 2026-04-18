/**
 * Production Pages smoke: key HTML routes return 200, HTML, and expected markers.
 * Uses same origin as diagnose-api (TEST_URL or https://www.australianrates.com/).
 *
 * Env: DIAG_PAGES_TIMEOUT_MS (default 25000), DIAG_PAGES_TTFB_WARN_MS (default 8000; warn only).
 * Env: DOCTOR_TOLERATE_CF_ACTIONS_RUNNER_BLOCK + GITHUB_ACTIONS: same cf-runner skip as diagnose-api.
 */

import { publicHealthIs403, tolerateCfActionsRunnerBlock } from './lib/ci-cf-runner-block'

const DEFAULT_TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/'
const ORIGIN = new URL(DEFAULT_TEST_URL).origin
const TIMEOUT_MS = Math.max(5000, Math.floor(Number(process.env.DIAG_PAGES_TIMEOUT_MS || 25_000)))
const TTFB_WARN_MS = Math.max(1000, Math.floor(Number(process.env.DIAG_PAGES_TTFB_WARN_MS || 8000)))

type PageCheck = {
  name: string
  path: string
  /** At least one must appear in response body (case-sensitive). */
  bodyMustIncludeOneOf: string[]
}

const MAIN_PAGES: PageCheck[] = [
  {
    name: 'Home Loans',
    path: '/',
    bodyMustIncludeOneOf: ['Compare Australian Home Loan Rates', 'Headline Rate'],
  },
  {
    name: 'Savings',
    path: '/savings/',
    bodyMustIncludeOneOf: ['Compare Australian Savings Rates'],
  },
  {
    name: 'Term Deposits',
    path: '/term-deposits/',
    bodyMustIncludeOneOf: ['Compare Australian Term Deposit Rates'],
  },
]

const LEGAL_PAGES: PageCheck[] = [
  {
    name: 'About',
    path: '/about/',
    bodyMustIncludeOneOf: ['About AustralianRates', 'Independent rate tracking.'],
  },
  {
    name: 'Privacy',
    path: '/privacy/',
    bodyMustIncludeOneOf: ['Privacy Policy', 'Privacy policy.'],
  },
  {
    name: 'Terms',
    path: '/terms/',
    bodyMustIncludeOneOf: ['Terms of Use', 'Terms of use.'],
  },
  {
    name: 'Contact',
    path: '/contact/',
    bodyMustIncludeOneOf: ['Contact AustralianRates', 'Get in touch.'],
  },
]

async function fetchPage(pathname: string): Promise<{ status: number; durationMs: number; ct: string; text: string }> {
  const url = `${ORIGIN}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS)
  const start = Date.now()
  let res: Response
  try {
    res = await fetch(url, { signal: ac.signal, redirect: 'follow' })
  } finally {
    clearTimeout(t)
  }
  const durationMs = Date.now() - start
  const text = await res.text()
  const ct = res.headers.get('content-type') || ''
  return { status: res.status, durationMs, ct, text }
}

async function runCheck(p: PageCheck): Promise<{ ok: boolean; failures: string[]; warnings: string[]; ms: number; status: number; name: string; path: string }> {
  const failures: string[] = []
  const warnings: string[] = []
  let status = 0
  let ms = 0
  try {
    const r = await fetchPage(p.path)
    status = r.status
    ms = r.durationMs
    if (r.status < 200 || r.status >= 300) {
      failures.push(`HTTP ${r.status}`)
    }
    if (!r.ct.toLowerCase().includes('text/html')) {
      failures.push(`content-type not html: ${r.ct || '(missing)'}`)
    }
    const hit = p.bodyMustIncludeOneOf.some((s) => r.text.includes(s))
    if (!hit) {
      failures.push(`body missing expected marker (one of: ${p.bodyMustIncludeOneOf.map((x) => JSON.stringify(x)).join(', ')})`)
    }
    if (ms > TTFB_WARN_MS) {
      warnings.push(`slow TTFB ${ms}ms (warn>${TTFB_WARN_MS}ms)`)
    }
  } catch (e) {
    failures.push(String((e as Error)?.message || e))
  }
  return { ok: failures.length === 0, failures, warnings, ms, status, name: p.name, path: p.path }
}

async function main(): Promise<void> {
  if (tolerateCfActionsRunnerBlock() && (await publicHealthIs403(ORIGIN))) {
    console.warn(
      '[diagnose-pages] Public health returned HTTP 403 from this environment (Cloudflare vs GitHub runner). Skipping HTML smoke with exit 0.',
    )
    console.log('RESULT: SKIPPED (cf-runner-block)')
    return
  }

  console.log('========================================')
  console.log('AustralianRates Pages Diagnostics')
  console.log('========================================')
  console.log(`Origin: ${ORIGIN}`)
  console.log(`Timeout: ${TIMEOUT_MS}ms`)
  console.log(`Time: ${new Date().toISOString()}`)

  const all: PageCheck[] = [...MAIN_PAGES, ...LEGAL_PAGES]
  const results = await Promise.all(all.map((p) => runCheck(p)))

  for (const r of results) {
    const line = `${r.name.padEnd(14)} ${r.path.padEnd(22)} status=${r.status} ms=${r.ms}`
    console.log(line)
    for (const w of r.warnings) console.log(`  warn: ${w}`)
    if (!r.ok) {
      for (const f of r.failures) console.log(`  FAIL: ${f}`)
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log('\n========================================')
  if (failed.length === 0) {
    console.log('RESULT: PASS')
  } else {
    console.log('RESULT: FAIL')
    console.log(`Failed pages: ${failed.length}`)
    for (const r of failed) {
      console.log(`- ${r.name} ${r.path}: ${r.failures.join('; ')}`)
    }
    process.exit(1)
  }
}

void main()
