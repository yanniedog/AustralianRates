/**
 * Run production health check and CDR audit, then output results as JSON.
 * Requires ADMIN_API_TOKEN in repo root .env.
 * Usage: node run-admin-status-checks.js [--no-run] [--health-only] [--cdr-only]
 *   --no-run   Skip POST (only GET current status)
 *   --health-only  Only run health run and fetch health
 *   --cdr-only     Only run CDR audit and fetch report
 */

const ORIGIN = process.env.API_BASE
  ? new URL(process.env.API_BASE).origin
  : 'https://www.australianrates.com'
const BASE = `${ORIGIN}/api/home-loan-rates/admin`

const token = (
  process.env.ADMIN_API_TOKEN ||
  process.env.ADMIN_API_TOKENS?.split(',')[0]?.trim() ||
  ''
).trim()

const FETCH_TIMEOUT_MS = 120_000

async function fetchAdmin(
  path: string,
  options: { method?: string; body?: string } = {}
): Promise<Response> {
  const url = BASE + path
  const controller = new AbortController()
  const to = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const res = await fetch(url, {
    signal: controller.signal,
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body,
  })
  clearTimeout(to)
  return res
}

async function main(): Promise<void> {
  if (!token) {
    console.error('Missing ADMIN_API_TOKEN in environment. Set it in repo root .env.')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const noRun = args.includes('--no-run')
  const healthOnly = args.includes('--health-only')
  const cdrOnly = args.includes('--cdr-only')

  const out: {
    reconcileClosedStaleRuns?: number
    healthRun?: { status: number; ok: boolean; duration_ms?: number }
    cdrAuditRun?: { status: number; ok: boolean }
    health?: unknown
    cdrAudit?: unknown
    coverageGaps?: unknown
    actionable?: unknown
    errors: string[]
  } = { errors: [] }

  try {
    if (!noRun) {
      const reconcileRes = await fetchAdmin('/runs/reconcile', {
        method: 'POST',
        body: JSON.stringify({ dry_run: false }),
      })
      if (reconcileRes.ok) {
        const rec = await reconcileRes.json().catch(() => ({}))
        const stale = (rec as { result?: { stale_runs?: { closed_runs?: number } } })?.result?.stale_runs
        if (stale && Number((stale as { closed_runs?: number }).closed_runs) > 0) {
          out.reconcileClosedStaleRuns = (stale as { closed_runs: number }).closed_runs
        }
      }
    }

    if (!noRun && !cdrOnly) {
      const runRes = await fetchAdmin('/health/run', { method: 'POST' })
      const runJson = runRes.ok ? await runRes.json().catch(() => ({})) : null
      out.healthRun = {
        status: runRes.status,
        ok: runRes.ok,
        duration_ms: runJson?.run?.duration_ms,
      }
      if (!runRes.ok) {
        out.errors.push(`health/run: HTTP ${runRes.status}`)
      }
    }

    if (!noRun && !healthOnly) {
      const cdrRes = await fetchAdmin('/cdr-audit/run', { method: 'POST' })
      out.cdrAuditRun = { status: cdrRes.status, ok: cdrRes.ok }
      if (!cdrRes.ok) {
        out.errors.push(`cdr-audit/run: HTTP ${cdrRes.status}`)
      }
    }

    if (!cdrOnly) {
      const healthRes = await fetchAdmin('/health?limit=48')
      if (healthRes.ok) {
        out.health = await healthRes.json()
      } else {
        out.errors.push(`health: HTTP ${healthRes.status}`)
      }
    }

    if (!healthOnly) {
      const cdrRes = await fetchAdmin('/cdr-audit')
      if (cdrRes.ok) {
        out.cdrAudit = await cdrRes.json()
      } else {
        out.errors.push(`cdr-audit: HTTP ${cdrRes.status}`)
      }
    }

    const gapsRes = await fetchAdmin('/diagnostics/coverage-gaps?refresh=1')
    if (gapsRes.ok) {
      out.coverageGaps = await gapsRes.json()
    } else {
      out.errors.push(`coverage-gaps: HTTP ${gapsRes.status}`)
    }

    const actionableRes = await fetchAdmin('/logs/system/actionable?limit=100')
    if (actionableRes.ok) {
      out.actionable = await actionableRes.json()
    }
  } catch (err) {
    out.errors.push((err as Error).message || String(err))
  }

  console.log(JSON.stringify(out, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
