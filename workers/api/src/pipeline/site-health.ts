import { API_BASE_PATH, SAVINGS_API_BASE_PATH, TD_API_BASE_PATH } from '../constants'
import { runIntegrityChecks } from '../db/integrity-checks'
import { runE2ECheck } from './e2e-alignment'
import type { EnvBindings } from '../types'
import { queryLogs } from '../utils/logger'
import { toActionableIssueSummaries } from '../utils/log-actionable'

type ComponentStatus = {
  key: string
  ok: boolean
  status: number
  duration_ms: number
  detail?: string
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

async function requestJson(origin: string, path: string): Promise<{ ok: boolean; status: number; durationMs: number; detail?: string }> {
  const url = `${normalizeOrigin(origin)}${path}`
  const startedAt = Date.now()
  try {
    const res = await fetch(url)
    const durationMs = Date.now() - startedAt
    if (!res.ok) {
      return { ok: false, status: res.status, durationMs, detail: `HTTP ${res.status}` }
    }
    await res.arrayBuffer()
    return { ok: true, status: res.status, durationMs }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      detail: (error as Error)?.message || String(error),
    }
  }
}

async function checkDataset(origin: string, key: string, basePath: string): Promise<ComponentStatus[]> {
  const [health, filters, latestAll] = await Promise.all([
    requestJson(origin, `${basePath}/health`),
    requestJson(origin, `${basePath}/filters`),
    requestJson(origin, `${basePath}/latest-all?limit=1&source_mode=all`),
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

  const [homeComponents, savingsComponents, tdComponents, homepage, integrity, e2e, logs] = await Promise.all([
    checkDataset(origin, 'home_loans', API_BASE_PATH),
    checkDataset(origin, 'savings', SAVINGS_API_BASE_PATH),
    checkDataset(origin, 'term_deposits', TD_API_BASE_PATH),
    requestJson(origin, '/'),
    runIntegrityChecks(env.DB, env.MELBOURNE_TIMEZONE || 'Australia/Melbourne'),
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
