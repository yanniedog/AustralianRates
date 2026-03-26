/**
 * Production triage prelude (elite-debugger workflow): public API diagnostics, admin log stats/actionable,
 * optional slim status-debug-bundle (meta + remediation counts). Does not write local log copies.
 *
 * Usage: node doctor.js [--skip-bundle]
 * Requires ADMIN_API_TOKEN in repo root .env for log/actionable/bundle slices.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'

/** Repo root; `npm run doctor` runs with cwd = package root. */
const root = process.cwd()

function runNode(scriptRelative: string, args: string[]): void {
  const scriptPath = path.join(root, scriptRelative)
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    cwd: root,
    env: process.env,
  })
  if (r.error) {
    console.error(r.error.message)
    process.exit(1)
  }
  if (r.status !== 0 && r.status != null) {
    process.exit(r.status)
  }
}

async function fetchSlimBundle(): Promise<void> {
  const token = (
    process.env.ADMIN_API_TOKEN ||
    process.env.ADMIN_API_TOKENS?.split(',')[0]?.trim() ||
    process.env.ADMIN_TEST_TOKEN ||
    process.env.LOCAL_ADMIN_API_TOKEN ||
    ''
  ).trim()
  if (!token) {
    console.log('\n[doctor] Skip status-debug-bundle slice: no ADMIN_API_TOKEN in env.')
    return
  }

  const origin = process.env.API_BASE
    ? new URL(process.env.API_BASE).origin
    : 'https://www.australianrates.com'
  const url = `${origin}/api/home-loan-rates/admin/diagnostics/status-debug-bundle?sections=meta%2Cremediation`

  const controller = new AbortController()
  const to = setTimeout(() => controller.abort(), 90_000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    clearTimeout(to)
    if (res.status === 401) {
      console.warn('[doctor] status-debug-bundle: 401 (check ADMIN_API_TOKEN matches worker secret).')
      return
    }
    if (res.status === 404) {
      console.warn(
        '[doctor] status-debug-bundle: 404 (deploy API worker with /admin/diagnostics/status-debug-bundle).',
      )
      return
    }
    if (!res.ok) {
      console.warn(`[doctor] status-debug-bundle: HTTP ${res.status}`)
      return
    }
    const j = (await res.json()) as {
      meta?: { health_run_id?: string | null; health_checked_at?: string | null }
      remediation?: { hints?: unknown[] }
    }
    const hints = Array.isArray(j.remediation?.hints) ? j.remediation.hints.length : 0
    console.log('\n[doctor] status-debug-bundle (sections=meta,remediation only):')
    console.log(
      JSON.stringify(
        {
          health_run_id: j.meta?.health_run_id ?? null,
          health_checked_at: j.meta?.health_checked_at ?? null,
          remediation_hint_count: hints,
        },
        null,
        2,
      ),
    )
  } catch (e) {
    clearTimeout(to)
    console.warn('[doctor] status-debug-bundle fetch failed:', (e as Error).message)
  }
}

async function main(): Promise<void> {
  const skipBundle = process.argv.includes('--skip-bundle')

  console.log('========================================')
  console.log('AustralianRates doctor (production triage)')
  console.log('========================================')
  console.log(`Time: ${new Date().toISOString()}`)
  console.log('\n--- Step 1: diagnose-api (public endpoints + benchmarks) ---\n')
  runNode('diagnose-api.js', [])

  console.log('\n--- Step 2: admin log stats + actionable (requires token) ---\n')
  runNode('fetch-production-logs.js', ['--stats', '--actionable'])

  if (!skipBundle) {
    console.log('\n--- Step 3: slim status-debug-bundle ---\n')
    await fetchSlimBundle()
  }

  console.log('\n========================================')
  console.log('Doctor prelude finished.')
  console.log('Full E2E JSON: npm run fetch-status-debug-bundle')
  console.log('After fixes + deploy: npm run doctor:verify')
  console.log('========================================')
}

void main()
