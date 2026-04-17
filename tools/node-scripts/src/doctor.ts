/**
 * Production triage prelude: public API diagnostics, Pages smoke, admin log stats/actionable,
 * optional status-debug-bundle, optional archive ping and verify:prod-hosting.
 *
 * Usage: node doctor.js [flags]
 *   --skip-bundle              Omit bundle fetch and DB/CDR gate
 *   --tolerate-actionable      Do not fail on actionable issue groups
 *   --tolerate-bundle-db       Ignore integrity / structural CDR failures in bundle
 *   --quick                    Pass through to diagnose-api (fewer benchmarks)
 *   --dump-bundle-diagnostics  Print full status_page_diagnostics, diagnostics, integrity_audit JSON
 *   --with-hosting             Run npm run verify:prod-hosting (DNS/TLS/Pages fetch)
 *   --strict-archive           Fail if ARCHIVE_ORIGIN is set but /api/health fails
 *
 * Env: ADMIN_API_TOKEN (bundle, logs), ARCHIVE_ORIGIN (optional workers URL for archive /api/health)
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const STATUS_DEBUG_BUNDLE_FILE = 'status-debug-bundle-latest.json'
const ARCHIVE_FETCH_MS = Math.max(3000, Math.floor(Number(process.env.DOCTOR_ARCHIVE_TIMEOUT_MS || 15_000)))

function runNodeCapture(scriptRelative: string, args: string[]): number {
  const scriptPath = path.join(root, scriptRelative)
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    cwd: root,
    env: process.env,
    shell: false,
  })
  if (r.error) {
    console.error(r.error.message)
    return 1
  }
  if (r.status == null) return 1
  return r.status
}

function runNpmScriptCapture(scriptName: string): number {
  const r = spawnSync('npm', ['run', scriptName], {
    stdio: 'inherit',
    cwd: root,
    env: process.env,
    shell: true,
  })
  if (r.error) {
    console.error(r.error.message)
    return 1
  }
  if (r.status == null) return 1
  return r.status
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
      /* ignore */
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

  return true
}

const CDR_STRUCTURAL_CHECK_IDS = new Set([
  'retrieved_fetch_raw_linkage',
  'stored_missing_fetch_event_links',
  'stored_missing_series_keys',
  'archived_fetch_created_without_raw_object',
  'tracked_presence_coverage',
])

function cdrAuditHasStructuralFailure(report: unknown): boolean {
  const r = report as {
    stages?: Record<string, Array<{ id?: string; passed?: boolean; severity?: string }>>
  }
  const stages = r.stages
  if (!stages || typeof stages !== 'object') return false
  for (const stage of Object.values(stages)) {
    if (!Array.isArray(stage)) continue
    for (const check of stage) {
      if (!check || typeof check !== 'object') continue
      const id = String(check.id || '')
      if (!CDR_STRUCTURAL_CHECK_IDS.has(id)) continue
      if (check.passed === false && String(check.severity || 'error').toLowerCase() === 'error') return true
    }
  }
  return false
}

/** Throws Error when bundle must fail the gate. */
function assertStatusBundleNoDbFailures(bundleAbsPath: string): void {
  let raw: string
  try {
    raw = readFileSync(bundleAbsPath, 'utf8')
  } catch (e) {
    throw new Error(`Cannot read bundle for DB validation: ${(e as Error).message}`)
  }
  let j: Record<string, unknown>
  try {
    j = JSON.parse(raw) as Record<string, unknown>
  } catch (e) {
    throw new Error(`Bundle JSON parse failed: ${(e as Error).message}`)
  }

  if (j.ok === false) {
    throw new Error('status-debug-bundle returned ok=false (refusing to ignore).')
  }

  const health = j.health as Record<string, unknown> | undefined
  const latest = health?.latest as Record<string, unknown> | undefined
  const integrity = latest?.integrity as
    | { ok?: boolean; checks?: Array<{ name?: string; passed?: boolean }> }
    | undefined

  if (integrity && integrity.ok === false) {
    const checks = Array.isArray(integrity.checks) ? integrity.checks : []
    const lines = checks
      .filter((c) => c && c.passed === false)
      .map((c) => String(c.name || '(unnamed check)'))
    throw new Error(
      `Health integrity failed (database / invariants). Failed checks: ${lines.length ? lines.join(', ') : '(see bundle)'}`,
    )
  }

  const iaLatest = (j.integrity_audit as { latest?: Record<string, unknown> | null } | undefined)?.latest
  if (iaLatest && typeof iaLatest === 'object') {
    const st = String(iaLatest.status || '').toLowerCase()
    const okRaw = iaLatest.overall_ok
    const ok = okRaw === true || okRaw === 1
    if (st === 'red' || !ok) {
      throw new Error(
        `Stored D1 data integrity audit failed. run_id=${String(iaLatest.run_id || '')} status=${String(iaLatest.status || '')} overall_ok=${String(okRaw)}`,
      )
    }
  }

  const cdrReport = (j.cdr_audit as { report?: unknown } | undefined)?.report
  if (cdrReport && cdrAuditHasStructuralFailure(cdrReport)) {
    throw new Error(
      'CDR audit: structural / linkage check failed (fetch_event↔raw_object, series keys, presence). Inspect bundle cdr_audit.report.stages.',
    )
  }
}

function printStatusPageDiagnostics(bundleAbsPath: string): void {
  try {
    const raw = readFileSync(bundleAbsPath, 'utf8')
    const j = JSON.parse(raw) as {
      status_page_diagnostics?: unknown
      diagnostics?: unknown
      integrity_audit?: unknown
    }
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
    if (j.integrity_audit != null && typeof j.integrity_audit === 'object') {
      console.log('\n--- D1 data integrity audit (integrity_audit; same as admin Data integrity page) ---\n')
      console.log(JSON.stringify(j.integrity_audit, null, 2))
    } else {
      console.warn('\n[doctor] Bundle missing integrity_audit (API may need deploy or sections= omitted it).')
    }
  } catch (e) {
    console.warn('[doctor] Could not print status diagnostics:', (e as Error).message)
  }
}

type BundleMetrics = {
  health_run_id: string | null
  health_checked_at: string | null
  remediation_hints: number | null
  replay_queue_count: number | null
  coverage_report_present: boolean
  log_problem_row_total: number | null
  product_classification_ok: boolean | null
  product_classification_issues: number | null
  product_classification_affected: number | null
}

function readBundleMetrics(bundleAbsPath: string): BundleMetrics | null {
  try {
    const raw = readFileSync(bundleAbsPath, 'utf8')
    const j = JSON.parse(raw) as {
      meta?: { health_run_id?: string | null; health_checked_at?: string | null }
      remediation?: { hints?: unknown[] }
      replay_queue?: { count?: number }
      coverage_gaps?: { report?: unknown }
      product_classification?: {
        report?: {
          ok?: boolean
          totals?: { issues?: number; affected_products?: number }
        } | null
      }
      logs?: { total?: number }
    }
    const hints = Array.isArray(j.remediation?.hints) ? j.remediation.hints.length : null
    const rq = j.replay_queue?.count
    const logTotal = j.logs?.total
    const pc = j.product_classification?.report ?? null
    return {
      health_run_id: j.meta?.health_run_id ?? null,
      health_checked_at: j.meta?.health_checked_at ?? null,
      remediation_hints: hints,
      replay_queue_count: typeof rq === 'number' ? rq : null,
      coverage_report_present: j.coverage_gaps?.report != null,
      log_problem_row_total: typeof logTotal === 'number' ? logTotal : null,
      product_classification_ok: typeof pc?.ok === 'boolean' ? pc.ok : null,
      product_classification_issues:
        typeof pc?.totals?.issues === 'number' ? pc.totals.issues : null,
      product_classification_affected:
        typeof pc?.totals?.affected_products === 'number' ? pc.totals.affected_products : null,
    }
  } catch {
    return null
  }
}

function passLabel(code: number): string {
  return code === 0 ? 'PASS' : 'FAIL'
}

async function pingArchiveHealth(): Promise<number> {
  const origin = (process.env.ARCHIVE_ORIGIN || '').trim().replace(/\/$/, '')
  if (!origin) {
    console.log('\n[doctor] Archive: skip (ARCHIVE_ORIGIN unset).')
    return 0
  }
  const url = `${origin}/api/health`
  console.log(`\n--- Archive worker (ARCHIVE_ORIGIN) ---\nGET ${url}\n`)
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), ARCHIVE_FETCH_MS)
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow' })
    clearTimeout(t)
    if (!res.ok) {
      console.warn(`[doctor] Archive /api/health HTTP ${res.status}`)
      return 1
    }
    console.log(`[doctor] Archive health OK (HTTP ${res.status})`)
    return 0
  } catch (e) {
    console.warn('[doctor] Archive health failed:', (e as Error).message)
    return 1
  }
}

async function mainAsync(): Promise<void> {
  const skipBundle = process.argv.includes('--skip-bundle')
  const strictActionable = !process.argv.includes('--tolerate-actionable')
  const tolerateBundleDb = process.argv.includes('--tolerate-bundle-db')
  const dumpBundle = process.argv.includes('--dump-bundle-diagnostics')
  const withHosting = process.argv.includes('--with-hosting')
  const strictArchive = process.argv.includes('--strict-archive')
  const quick = process.argv.includes('--quick')

  console.log('========================================')
  console.log('AustralianRates doctor (production triage)')
  console.log('========================================')
  console.log(`Time: ${new Date().toISOString()}`)
  if (quick) console.log('Quick mode: diagnose-api uses reduced benchmarks.')

  console.log('\n--- Step 1: diagnose-api (public endpoints + benchmarks) ---\n')
  const apiArgs = quick ? ['--quick'] : []
  const apiCode = runNodeCapture('diagnose-api.js', apiArgs)

  console.log('\n--- Step 2: diagnose-pages (HTML smoke) ---\n')
  const pagesCode = runNodeCapture('diagnose-pages.js', [])

  console.log('\n--- Step 3: admin log stats + actionable (requires token) ---\n')
  const logArgs = ['--stats', '--actionable']
  if (strictActionable) logArgs.push('--fail-on-actionable')
  const logsCode = runNodeCapture('fetch-production-logs.js', logArgs)

  let hostingCode = 0
  if (withHosting) {
    console.log('\n--- Step 3b: verify:prod-hosting (DNS/TLS/Pages) ---\n')
    hostingCode = runNpmScriptCapture('verify:prod-hosting')
  }

  const archiveCode = await pingArchiveHealth()

  let bundleWritten = false
  if (!skipBundle) {
    console.log('\n--- Step 4: full status-debug-bundle (file) ---\n')
    bundleWritten = fetchFullStatusBundleToFile()
  }

  if (bundleWritten && dumpBundle) {
    printStatusPageDiagnostics(path.join(root, STATUS_DEBUG_BUNDLE_FILE))
  }

  let bundleGateCode = 0
  if (bundleWritten && !tolerateBundleDb) {
    console.log('\n--- Step 5: bundle database / integrity gate ---\n')
    try {
      assertStatusBundleNoDbFailures(path.join(root, STATUS_DEBUG_BUNDLE_FILE))
      console.log('[doctor] Bundle integrity + CDR audit gates passed.')
    } catch (e) {
      bundleGateCode = 1
      console.error('[doctor]', (e as Error).message)
    }
  } else if (!skipBundle && !bundleWritten && hasAdminToken()) {
    console.warn(
      '[doctor] No bundle file: skipped database/integrity gate (fetch failed). Use a working token or fix API.',
    )
  } else if (skipBundle && hasAdminToken()) {
    console.warn(
      '[doctor] --skip-bundle: database/integrity gate not run (no bundle). Remove --skip-bundle for full DB checks.',
    )
  }

  const bundlePath = path.join(root, STATUS_DEBUG_BUNDLE_FILE)
  const metrics = bundleWritten && existsSync(bundlePath) ? readBundleMetrics(bundlePath) : null

  console.log('\n--- Doctor scorecard ---')
  console.log(`API diagnostics (diagnose-api):     ${passLabel(apiCode)}${apiCode !== 0 ? ` (exit ${apiCode})` : ''}`)
  console.log(`Pages smoke (diagnose-pages):        ${passLabel(pagesCode)}${pagesCode !== 0 ? ` (exit ${pagesCode})` : ''}`)
  console.log(`Admin logs (stats + actionable):     ${passLabel(logsCode)}${logsCode !== 0 ? ` (exit ${logsCode})` : ''}`)
  if (withHosting) {
    console.log(`Production hosting check:            ${passLabel(hostingCode)}${hostingCode !== 0 ? ` (exit ${hostingCode})` : ''}`)
  }
  const archiveOriginSet = Boolean((process.env.ARCHIVE_ORIGIN || '').trim())
  if (archiveOriginSet) {
    console.log(`Archive /api/health:                 ${passLabel(archiveCode)}${archiveCode !== 0 ? ` (exit ${archiveCode})` : ''}`)
  }
  console.log(`Status debug bundle file:            ${bundleWritten ? `yes (./${STATUS_DEBUG_BUNDLE_FILE})` : 'no'}`)
  if (metrics) {
    console.log(`  health_run_id:                     ${metrics.health_run_id ?? '(null)'}`)
    console.log(`  health_checked_at:                 ${metrics.health_checked_at ?? '(null)'}`)
    console.log(`  remediation_hints:                 ${metrics.remediation_hints ?? '(n/a)'}`)
    console.log(`  replay_queue_count:                ${metrics.replay_queue_count ?? '(n/a)'}`)
    console.log(`  coverage_gaps.report:              ${metrics.coverage_report_present ? 'present' : 'absent'}`)
    const pcOkLabel = metrics.product_classification_ok == null
      ? '(n/a)'
      : metrics.product_classification_ok
        ? 'ok'
        : `${metrics.product_classification_issues ?? 0} issues / ${metrics.product_classification_affected ?? 0} rows`
    console.log(`  product_classification:            ${pcOkLabel}`)
    console.log(`  logs.total (problem rows in bundle): ${metrics.log_problem_row_total ?? '(n/a)'}`)
  }
  if (!dumpBundle && bundleWritten) {
    console.log(`  (use --dump-bundle-diagnostics for full status_page_diagnostics / diagnostics / integrity_audit JSON)`)
  }
  console.log(
    `Bundle DB + structural CDR gate:     ${!bundleWritten ? 'skipped' : tolerateBundleDb ? 'tolerated' : passLabel(bundleGateCode)}`,
  )

  const failArchive = strictArchive && archiveOriginSet && archiveCode !== 0
  const fatal =
    apiCode !== 0 ||
    pagesCode !== 0 ||
    logsCode !== 0 ||
    hostingCode !== 0 ||
    failArchive ||
    bundleGateCode !== 0

  console.log('\n========================================')
  if (fatal) {
    console.log('Doctor finished with failures.')
  } else {
    console.log('Doctor prelude finished (all executed steps passed).')
  }
  if (bundleWritten) {
    console.log(`Triage: read ./${STATUS_DEBUG_BUNDLE_FILE} for full E2E JSON (gitignored; delete after analysis).`)
  }
  console.log('After fixes + deploy: npm run doctor:verify')
  console.log('========================================')

  if (fatal) process.exit(1)
}

function main(): void {
  void mainAsync().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}

main()
