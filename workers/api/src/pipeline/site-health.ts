import { API_BASE_PATH, SAVINGS_API_BASE_PATH, TD_API_BASE_PATH } from '../constants'
import { runIntegrityChecks } from '../db/integrity-checks'
import { runE2ECheck } from './e2e-alignment'
import type { EnvBindings } from '../types'
import { FetchWithTimeoutError, fetchWithTimeout, hostFromUrl } from '../utils/fetch-with-timeout'
import { log, queryLogs } from '../utils/logger'
import { toActionableIssueSummaries } from '../utils/log-actionable'

type ComponentStatus = {
  key: string
  ok: boolean
  status: number
  duration_ms: number
  detail?: string
}

function isEnabled(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export type SiteHealthRunResult = {
  runId: string
  checkedAt: string
  overallOk: boolean
  durationMs: number
  origin: string
  components: ComponentStatus[]
  integrity: Awaited<ReturnType<typeof runIntegrityChecks>>
  e2e: Awaited<ReturnType<typeof runE2ECheck>>
  failures: string[]
  actionableIssues: ReturnType<typeof toActionableIssueSummaries>
}

function normalizeOrigin(origin: string): string {
  return String(origin || '').replace(/\/+$/, '')
}

async function requestJson(
  env: EnvBindings,
  origin: string,
  path: string,
): Promise<{ ok: boolean; status: number; durationMs: number; detail?: string }> {
  const url = `${normalizeOrigin(origin)}${path}`
  const startedAt = Date.now()
  try {
    const fetched = await fetchWithTimeout(url, undefined, { env })
    const res = fetched.response
    const durationMs = Date.now() - startedAt
    log.info('pipeline', 'upstream_fetch', {
      context:
        `source=site_health_probe host=${hostFromUrl(url)}` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} upstream_ms=${fetched.meta.elapsed_ms}` +
        ` attempts=${fetched.meta.attempts} retry_count=${Math.max(0, fetched.meta.attempts - 1)}` +
        ` timed_out=${fetched.meta.timed_out ? 1 : 0} timeout=${fetched.meta.timed_out ? 1 : 0}` +
        ` status=${fetched.meta.status ?? res.status}`,
    })
    if (!res.ok) {
      return { ok: false, status: res.status, durationMs, detail: `HTTP ${res.status}` }
    }
    await res.arrayBuffer()
    return { ok: true, status: res.status, durationMs }
  } catch (error) {
    const meta = error instanceof FetchWithTimeoutError ? error.meta : null
    log.warn('pipeline', 'upstream_fetch', {
      error,
      context:
        `source=site_health_probe host=${hostFromUrl(url)}` +
        ` elapsed_ms=${meta?.elapsed_ms ?? 0} upstream_ms=${meta?.elapsed_ms ?? 0}` +
        ` attempts=${meta?.attempts ?? 1} retry_count=${Math.max(0, (meta?.attempts ?? 1) - 1)}` +
        ` timed_out=${meta?.timed_out ? 1 : 0} timeout=${meta?.timed_out ? 1 : 0}` +
        ` status=${meta?.status ?? 0}`,
    })
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      detail: (error as Error)?.message || String(error),
    }
  }
}

async function checkDataset(env: EnvBindings, origin: string, key: string, basePath: string): Promise<ComponentStatus[]> {
  const [health, filters, latestAll] = await Promise.all([
    requestJson(env, origin, `${basePath}/health`),
    requestJson(env, origin, `${basePath}/filters`),
    requestJson(env, origin, `${basePath}/latest-all?limit=1&source_mode=all`),
  ])
  return [
    {
      key: `${key}_health`,
      ok: health.ok,
      status: health.status,
      duration_ms: health.durationMs,
      detail: health.detail,
    },
    {
      key: `${key}_filters`,
      ok: filters.ok,
      status: filters.status,
      duration_ms: filters.durationMs,
      detail: filters.detail,
    },
    {
      key: `${key}_latest_all`,
      ok: latestAll.ok,
      status: latestAll.status,
      duration_ms: latestAll.durationMs,
      detail: latestAll.detail,
    },
  ]
}

export async function runSiteHealthChecks(
  env: EnvBindings,
  input: { triggerSource: 'scheduled' | 'manual'; origin: string },
): Promise<SiteHealthRunResult> {
  const checkedAt = new Date().toISOString()
  const runId = `health:${input.triggerSource}:${checkedAt}:${crypto.randomUUID()}`
  const startedAt = Date.now()
  const origin = normalizeOrigin(input.origin)
  const integrityPromise = runIntegrityChecks(env.DB, env.MELBOURNE_TIMEZONE || 'Australia/Melbourne', {
    includeAnomalyProbes: isEnabled(env.FEATURE_INTEGRITY_PROBES_ENABLED),
  }).catch((error) => ({
      ok: false,
      checked_at: new Date().toISOString(),
      checks: [
        {
          name: 'integrity_runtime_error',
          passed: false,
          detail: {
            error: (error as Error)?.message || String(error),
          },
        },
      ],
    }))

  const [homeComponents, savingsComponents, tdComponents, homepage, integrity, e2e, logs] = await Promise.all([
    checkDataset(env, origin, 'home_loans', API_BASE_PATH),
    checkDataset(env, origin, 'savings', SAVINGS_API_BASE_PATH),
    checkDataset(env, origin, 'term_deposits', TD_API_BASE_PATH),
    requestJson(env, origin, '/'),
    integrityPromise,
    runE2ECheck(env, { origin }),
    queryLogs(env.DB, { limit: 200 }),
  ])

  const components: ComponentStatus[] = [
    ...homeComponents,
    ...savingsComponents,
    ...tdComponents,
    {
      key: 'homepage',
      ok: homepage.ok,
      status: homepage.status,
      duration_ms: homepage.durationMs,
      detail: homepage.detail,
    },
  ]

  const failures = components
    .filter((c) => !c.ok)
    .map((c) => `${c.key}: status=${c.status}${c.detail ? ` detail=${c.detail}` : ''}`)

  if (!integrity.ok) failures.push('integrity_checks_failed')
  if (!e2e.aligned) failures.push(`e2e_not_aligned:${e2e.reasonCode}`)

  const actionableIssues = toActionableIssueSummaries(
    logs.entries.filter((entry) => {
      const level = String(entry.level || '').toLowerCase()
      return level === 'warn' || level === 'error'
    }),
  )

  return {
    runId,
    checkedAt,
    overallOk: failures.length === 0,
    durationMs: Date.now() - startedAt,
    origin,
    components,
    integrity,
    e2e,
    failures,
    actionableIssues,
  }
}
