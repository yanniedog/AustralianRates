/**
 * Production triage prelude (elite-debugger workflow): public API diagnostics, admin log stats/actionable,
 * optional full status-debug-bundle written to repo-root status-debug-bundle-latest.json (gitignored) plus
 * a short console summary. Does not write production log streams to disk (use fetch-production-logs for that).
 *
 * Usage: node doctor.js [--skip-bundle] [--strict-actionable]
 * Requires ADMIN_API_TOKEN in repo root .env for log/actionable/bundle slices.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

/** Repo root; `npm run doctor` runs with cwd = package root. */
const root = process.cwd()

/** Ephemeral full bundle for triage; gitignored — delete after analysis if desired. */
const STATUS_DEBUG_BUNDLE_FILE = 'status-debug-bundle-latest.json'

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

function hasAdminToken(): boolean {
  const t = (
    process.env.ADMIN_API_TOKEN ||
    process.env.ADMIN_API_TOKENS?.split(',')[0]?.trim() ||
    process.env.ADMIN_TEST_TOKEN ||
    process.env.LOCAL_ADMIN_API_TOKEN ||
    ''
  ).trim()
  return Boolean(t)
}

/** Full bundle via fetch-status-debug-bundle.js (same auth and origin as manual npm script). */
function fetchFullStatusBundleToFile(): boolean {
  if (!hasAdminToken()) {
    console.log('\n[doctor] Skip status-debug-bundle file: no ADMIN_API_TOKEN in env.')
    return false
  }

  const outAbs = path.join(root, STATUS_DEBUG_BUNDLE_FILE)
  if (existsSync(outAbs)) {
    try {
      unlinkSync(outAbs)
    } catch {
      /* ignore — fetch script may still overwrite */
    }
  }

  console.log(`\n[doctor] Fetching full status-debug-bundle to ./${STATUS_DEBUG_BUNDLE_FILE} ...\n`)
  const scriptPath = path.join(root, 'fetch-status-debug-bundle.js')
  const r = spawnSync(process.execPath, [scriptPath, `--out=${outAbs}`], {
    stdio: 'inherit',
    cwd: root,
    env: process.env,
    shell: false,
  })

  if (r.error) {
    console.warn('[doctor] status-debug-bundle:', r.error.message)
    return false
  }
  if (r.status !== 0) {
    console.warn(
      `[doctor] status-debug-bundle not written (fetch-status-debug-bundle exited ${r.status}). Check token and API.`,
    )
    return false
  }

  try {
    const raw = readFileSync(outAbs, 'utf8')
    const j = JSON.parse(raw) as {
      meta?: { health_run_id?: string | null; health_checked_at?: string | null }
      remediation?: { hints?: unknown[] }
    }
    const hints = Array.isArray(j.remediation?.hints) ? j.remediation.hints.length : 0
    console.log('\n[doctor] status-debug-bundle summary (full JSON in file above):')
    console.log(
      JSON.stringify(
        {
          bundle_file: STATUS_DEBUG_BUNDLE_FILE,
          health_run_id: j.meta?.health_run_id ?? null,
          health_checked_at: j.meta?.health_checked_at ?? null,
          remediation_hint_count: hints,
        },
        null,
        2,
      ),
    )
    return true
  } catch (e) {
    console.warn('[doctor] Bundle file written but summary parse failed:', (e as Error).message)
    return true
  }
}

function main(): void {
  const skipBundle = process.argv.includes('--skip-bundle')
  const strictActionable =
    process.argv.includes('--strict-actionable') ||
    process.argv.includes('--fail-on-actionable') ||
    process.argv.includes('--no-tolerate-actionable')

  console.log('========================================')
  console.log('AustralianRates doctor (production triage)')
  console.log('========================================')
  console.log(`Time: ${new Date().toISOString()}`)
  console.log('\n--- Step 1: diagnose-api (public endpoints + benchmarks) ---\n')
  runNode('diagnose-api.js', [])

  console.log('\n--- Step 2: admin log stats + actionable (requires token) ---\n')
  const logArgs = ['--stats', '--actionable']
  if (strictActionable) logArgs.push('--fail-on-actionable')
  runNode('fetch-production-logs.js', logArgs)

  let bundleWritten = false
  if (!skipBundle) {
    console.log('\n--- Step 3: full status-debug-bundle (file + summary) ---\n')
    bundleWritten = fetchFullStatusBundleToFile()
  }

  console.log('\n========================================')
  console.log('Doctor prelude finished.')
  if (bundleWritten) {
    console.log(`Triage: read ./${STATUS_DEBUG_BUNDLE_FILE} for full E2E JSON (gitignored; delete after analysis).`)
  }
  console.log('After fixes + deploy: npm run doctor:verify')
  console.log('========================================')
}

try {
  main()
} catch (e) {
  console.error(e)
  process.exit(1)
}
