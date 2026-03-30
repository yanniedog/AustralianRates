/**
 * Run production health check and CDR audit, then output results as JSON.
 * Requires ADMIN_API_TOKEN in repo root .env.
 * Usage: node run-admin-status-checks.js [--no-run] [--health-only] [--cdr-only]
 *   --no-run   Skip POST (only GET current status)
 *   --health-only  Only run health run and fetch health
 *   --cdr-only     Only run CDR audit and fetch report
 */

import { buildAdminHeaders, fetchWithTimeout, resolveAdminToken, resolveEnvOrigin } from './lib/admin-api'

const ORIGIN = resolveEnvOrigin(['API_BASE'])
const BASE = `${ORIGIN}/api/home-loan-rates/admin`

const token = resolveAdminToken(['ADMIN_API_TOKEN', 'ADMIN_API_TOKENS'])

const FETCH_TIMEOUT_MS = 120_000

type HealthRunResponse = {
  run?: {
    duration_ms?: number
  }
}

async function fetchAdmin(
  path: string,
  options: { method?: string; body?: string } = {}
): Promise<Response> {
  const url = BASE + path
  return await fetchWithTimeout(url, {
    method: options.method || 'GET',
    headers: buildAdminHeaders(token, 'application/json', options.body ? { 'Content-Type': 'application/json' } : {}),
    body: options.body,
  }, FETCH_TIMEOUT_MS)
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
    economicCollectRun?: { status: number; ok: boolean; failed_series?: number }
    healthRun?: { status: number; ok: boolean; duration_ms?: number }
    cdrAuditRun?: { status: number; ok: boolean }
    health?: unknown
    economic?: unknown
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
      const economicRes = await fetchAdmin('/economic/collect', { method: 'POST' })
      const economicJson = economicRes.ok
        ? ((await economicRes.json().catch(() => ({}))) as { result?: { failed_series?: unknown[] } })
        : null
      const failedSeries = Array.isArray(economicJson?.result?.failed_series)
        ? economicJson?.result?.failed_series.length
        : undefined
      out.economicCollectRun = {
        status: economicRes.status,
        ok: economicRes.ok,
        failed_series: failedSeries,
      }
      if (!economicRes.ok) {
        out.errors.push(`economic/collect: HTTP ${economicRes.status}`)
      }
    }

    if (!noRun && !cdrOnly) {
      const runRes = await fetchAdmin('/health/run', { method: 'POST' })
      const runJson = runRes.ok
        ? ((await runRes.json().catch(() => ({}))) as HealthRunResponse)
        : null
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
        const latest = (out.health as { latest?: { economic?: unknown } } | undefined)?.latest
        out.economic = latest && typeof latest === 'object' && 'economic' in latest
          ? (latest as { economic?: unknown }).economic
          : null
        const severity = (
          out.economic as { summary?: { severity?: string } } | null | undefined
        )?.summary?.severity
        if (severity === 'red') {
          out.errors.push('economic: red coverage severity')
        }
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
  if (out.errors.length > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
