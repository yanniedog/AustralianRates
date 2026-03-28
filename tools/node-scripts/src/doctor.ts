/**
 * Production triage prelude (elite-debugger workflow): public API diagnostics, admin log stats/actionable,
 * optional full status-debug-bundle written to repo-root status-debug-bundle-latest.json (gitignored) plus
 * a short console summary. Does not write production log streams to disk (use fetch-production-logs for that).
 *
 * Usage: node doctor.js [--skip-bundle] [--tolerate-actionable] [--tolerate-bundle-db]
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

/** CDR audit checks that indicate broken linkage / schema-level invariants (not reconciliation lag). */
const CDR_STRUCTURAL_CHECK_IDS = new Set([
  'retrieved_fetch_raw_linkage',
  'stored_missing_fetch_event_links',
  'stored_missing_series_keys',
  'archived_fetch_created_without_raw_object',
  'tracked_presence_coverage',
])

function cdrAuditHasStructuralFailure(report: unknown): boolean {
  const r = report as {
    stages?: Record<string, Array<{ id?: string; passed?: boolean }>>
  }
  const stages = r.stages
  if (!stages || typeof stages !== 'object') return false
  for (const stage of Object.values(stages)) {
    if (!Array.isArray(stage)) continue
    for (const check of stage) {
      if (!check || typeof check !== 'object') continue
      const id = String(check.id || '')
      if (!CDR_STRUCTURAL_CHECK_IDS.has(id)) continue
      if (check.passed === false) return true
    }
  }
  return false
}

/**
 * Fail the run when the bundle reports D1/consistency failures that actionable logs may not list.
 * Economic/upstream probe noise does not set integrity ok=false.
 * CDR: only structural linkage/presence checks fail the gate (not stale run_reports / unfinalized lender rows).
 */
function assertStatusBundleNoDbFailures(bundleAbsPath: string): void {
  let raw: string
  try {
    raw = readFileSync(bundleAbsPath, 'utf8')
  } catch (e) {
    console.error('[doctor] Cannot read bundle for DB validation:', (e as Error).message)
    process.exit(1)
  }
  let j: Record<string, unknown>
  try {
    j = JSON.parse(raw) as Record<string, unknown>
  } catch (e) {
    console.error('[doctor] Bundle JSON parse failed:', (e as Error).message)
    process.exit(1)
  }

  if (j.ok === false) {
    console.error('[doctor] status-debug-bundle returned ok=false (refusing to ignore).')
    process.exit(1)
  }

  const health = j.health as Record<string, unknown> | undefined
  const latest = health?.latest as Record<string, unknown> | undefined
  const integrity = latest?.integrity as
    | { ok?: boolean; checks?: Array<{ name?: string; passed?: boolean }> }
    | undefined

  if (integrity && integrity.ok === false) {
    console.error('[doctor] Health integrity failed (database / invariants). Fix D1 data or pipeline, then redeploy.')
    const checks = Array.isArray(integrity.checks) ? integrity.checks : []
    for (const c of checks) {
      if (c && c.passed === false) {
        console.error(`  - ${String(c.name || '(unnamed check)')}: FAILED`)
      }
    }
    process.exit(1)
  }

  const cdrReport = (j.cdr_audit as { report?: unknown } | undefined)?.report
  if (cdrReport && cdrAuditHasStructuralFailure(cdrReport)) {
    console.error(
      '[doctor] CDR audit: structural / linkage check failed (fetch_event↔raw_object, series keys, presence). Inspect bundle cdr_audit.report.stages.',
    )
    process.exit(1)
  }
}

function printStatusPageDiagnostics(bundleAbsPath: string): void {
  try {
    const raw = readFileSync(bundleAbsPath, 'utf8')
    const j = JSON.parse(raw) as { status_page_diagnostics?: unknown; diagnostics?: unknown }
    if (j.status_page_diagnostics != null && typeof j.status_page_diagnostics === 'object') {
      console.log('\n--- Status page / full backend diagnostics (status_page_diagnostics) ---\n')
      console.log(JSON.stringify(j.status_page_diagnostics, null, 2))
    } else {
      console.warn('\n[doctor] Bundle missing status_page_diagnostics (API may need deploy).')
    }
    if (j.diagnostics != null && typeof j.diagnostics === 'object') {
      console.log('\n--- Economic + E2E detail (diagnostics) ---\n')
      console.log(JSON.stringify(j.diagnostics, null, 2))
    }
  } catch (e) {
    console.warn('[doctor] Could not print status diagnostics:', (e as Error).message)
  }
}

function main(): void {
  const skipBundle = process.argv.includes('--skip-bundle')
  const strictActionable = !process.argv.includes('--tolerate-actionable')
  const tolerateBundleDb = process.argv.includes('--tolerate-bundle-db')

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

  if (bundleWritten) {
    printStatusPageDiagnostics(path.join(root, STATUS_DEBUG_BUNDLE_FILE))
  }

  if (bundleWritten && !tolerateBundleDb) {
    console.log('\n--- Step 4: bundle database / integrity gate ---\n')
    assertStatusBundleNoDbFailures(path.join(root, STATUS_DEBUG_BUNDLE_FILE))
    console.log('[doctor] Bundle integrity + CDR audit gates passed.')
  } else if (!skipBundle && !bundleWritten && hasAdminToken()) {
    console.warn(
      '[doctor] No bundle file: skipped database/integrity gate (fetch failed). Use a working token or fix API.',
    )
  } else if (skipBundle && hasAdminToken()) {
    console.warn(
      '[doctor] --skip-bundle: database/integrity gate not run (no bundle). Remove --skip-bundle for full DB checks.',
    )
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
