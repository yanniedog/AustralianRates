import { SITE_HEALTH_CRON_EXPRESSION } from '../constants'
import { getDiagnosticsBacklog } from '../db/diagnostics-backlog'
import { readFetchEventPayloadTruncated, getRecentFetchEvents } from '../db/fetch-events'
import { getLatestHealthCheckRun, listHealthCheckRuns } from '../db/health-check-runs'
import { listReplayQueueRows } from '../db/ingest-replay-queue'
import { getCachedCdrAuditReport, runCdrPipelineAudit } from './cdr-audit'
import {
  getCachedCoverageGapAuditReport,
  loadCoverageGapAuditReport,
  runCoverageGapAudit,
} from './coverage-gap-audit'
import {
  getCachedCoverageGapRemediationReport,
  loadCoverageGapRemediationReport,
} from './coverage-gap-remediation'
import {
  getCachedLenderUniverseAuditReport,
  loadLenderUniverseAuditReport,
  runLenderUniverseAudit,
} from './lender-universe-audit'
import type { EnvBindings } from '../types'
import { extractTraceback, parseLogContext, queryProblemLogs } from '../utils/logger'
import { mapHealthCheckRunRow, type ParsedHealthRun } from '../utils/map-health-run'
import {
  mergeRemediationHints,
  remediationFromActionableCodes,
  remediationFromCoverageGapRows,
  remediationFromReplayQueueRows,
} from './status-debug-remediation'
import type { CoverageGapAuditReport } from './coverage-gap-audit'

const DEFAULT_SECTIONS = [
  'health',
  'logs',
  'cdr',
  'coverage',
  'lender_universe',
  'replay',
  'probes',
  'backlog',
  'remediation',
] as const

export function parseStatusDebugSections(raw: string | undefined): Set<string> {
  if (raw == null || String(raw).trim() === '') {
    return new Set(DEFAULT_SECTIONS)
  }
  const parts = String(raw)
    .split(/[,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return new Set(parts)
}

function truthyQuery(v: string | undefined): boolean {
  const n = String(v || '').trim().toLowerCase()
  return n === '1' || n === 'true' || n === 'yes'
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function collectFailedComponentFetchEventIds(health: ParsedHealthRun | null): number[] {
  const ids: number[] = []
  const comps = health && Array.isArray(health.components) ? health.components : []
  for (const c of comps) {
    if (!c || typeof c !== 'object') continue
    const rec = c as Record<string, unknown>
    if (rec.ok === true) continue
    const id = rec.fetch_event_id
    if (typeof id === 'number' && Number.isFinite(id) && id > 0) ids.push(Math.floor(id))
  }
  return ids
}

function collectProbeEventIdsForPayloads(
  events: Awaited<ReturnType<typeof getRecentFetchEvents>>,
  maxExtra: number,
): number[] {
  const ids: number[] = []
  for (const ev of events) {
    if (ids.length >= maxExtra) break
    const eid = ev.id
    if (typeof eid !== 'number' || !Number.isFinite(eid) || eid <= 0) continue
    const st = ev.httpStatus
    if (st != null && (st < 200 || st >= 300)) {
      ids.push(eid)
      continue
    }
    if (!ev.rawObjectCreated) ids.push(eid)
  }
  return ids
}

function logSinceFromHealth(checkedAt: string | undefined, hoursBefore: number): string | undefined {
  if (!checkedAt) return undefined
  const t = Date.parse(checkedAt)
  if (!Number.isFinite(t)) return undefined
  const ms = Math.max(1, hoursBefore) * 60 * 60 * 1000
  return new Date(t - ms).toISOString()
}

function actionableCodesFromHealth(health: ParsedHealthRun | null): string[] {
  const list = health && Array.isArray(health.actionable) ? health.actionable : []
  const codes: string[] = []
  for (const item of list) {
    if (item && typeof item === 'object' && 'code' in item) {
      const c = String((item as { code?: unknown }).code || '').trim()
      if (c) codes.push(c)
    }
  }
  return codes
}

function logCodes(entries: Array<Record<string, unknown>>): string[] {
  const codes: string[] = []
  for (const e of entries) {
    const c = String(e.code ?? '').trim()
    if (c) codes.push(c)
  }
  return codes
}

export type BuildStatusDebugBundleQuery = {
  sections?: string
  healthHistoryLimit?: string
  refreshCoverage?: string
  refreshLenderUniverse?: string
  logLimit?: string
  since?: string
  logHoursBeforeHealth?: string
  includeProbePayloads?: string
  maxProbePayloads?: string
  maxProbePayloadBytes?: string
  backlogLimit?: string
  coverageLimit?: string
  replayLimit?: string
  probeEventLimit?: string
}

export async function buildStatusDebugBundle(
  env: EnvBindings,
  query: BuildStatusDebugBundleQuery,
  authMode: string | null,
): Promise<Record<string, unknown>> {
  const sections = parseStatusDebugSections(query.sections)
  const healthHistoryLimit = clamp(Math.floor(Number(query.healthHistoryLimit) || 12), 1, 48)
  const refreshCoverage = truthyQuery(query.refreshCoverage)
  const refreshLenderUniverse = truthyQuery(query.refreshLenderUniverse)
  const logLimit = clamp(Math.floor(Number(query.logLimit) || 500), 1, 10000)
  const logHoursBeforeHealth = clamp(Math.floor(Number(query.logHoursBeforeHealth) || 24), 1, 168)
  const includeProbePayloads = truthyQuery(query.includeProbePayloads)
  const maxProbePayloads = clamp(Math.floor(Number(query.maxProbePayloads) || 8), 1, 20)
  const maxProbePayloadBytes = clamp(Math.floor(Number(query.maxProbePayloadBytes) || 262_144), 4096, 2_000_000)
  const backlogLimit = clamp(Math.floor(Number(query.backlogLimit) || 200), 1, 1000)
  const coverageLimit = clamp(Math.floor(Number(query.coverageLimit) || 100), 1, 500)
  const replayLimit = clamp(Math.floor(Number(query.replayLimit) || 50), 1, 200)
  const probeEventLimit = clamp(Math.floor(Number(query.probeEventLimit) || 40), 1, 100)

  const sinceExplicit = String(query.since || '').trim() || undefined

  const out: Record<string, unknown> = {
    ok: true,
    auth_mode: authMode,
    meta: {
      generated_at: new Date().toISOString(),
      next_cron_expression: SITE_HEALTH_CRON_EXPRESSION,
      sections: Array.from(sections),
    },
  }

  const needsHealthSnapshot =
    sections.has('health') ||
    sections.has('logs') ||
    sections.has('remediation') ||
    includeProbePayloads

  let latestHealth: ParsedHealthRun | null = null
  if (needsHealthSnapshot) {
    const latest = await getLatestHealthCheckRun(env.DB)
    latestHealth = mapHealthCheckRunRow(latest)
    ;(out.meta as Record<string, unknown>).health_run_id = latestHealth?.run_id ?? null
    ;(out.meta as Record<string, unknown>).health_checked_at = latestHealth?.checked_at ?? null
  }

  if (sections.has('health')) {
    const history = await listHealthCheckRuns(env.DB, healthHistoryLimit)
    out.health = {
      latest: latestHealth,
      history: history.map((row) => mapHealthCheckRunRow(row)).filter(Boolean),
    }
  }

  let coverageRowsSnapshot: CoverageGapAuditReport['rows'] = []
  let replayRows: Awaited<ReturnType<typeof listReplayQueueRows>> = []
  let probeEvents: Awaited<ReturnType<typeof getRecentFetchEvents>> = []
  let logEntriesOut: Array<Record<string, unknown>> = []

  const parallel: Promise<void>[] = []

  if (sections.has('logs')) {
    parallel.push(
      (async () => {
        const sinceTs = sinceExplicit ?? logSinceFromHealth(latestHealth?.checked_at, logHoursBeforeHealth)
        const { entries, total } = await queryProblemLogs(env.DB, { sinceTs, limit: logLimit })
        logEntriesOut = entries.map((e) => ({
          id: e.id,
          ts: e.ts,
          level: e.level,
          source: e.source,
          message: e.message,
          code: e.code ?? null,
          run_id: e.run_id ?? null,
          lender_code: e.lender_code ?? null,
          context: parseLogContext(e.context),
          traceback: extractTraceback(e.context),
        }))
        out.logs = {
          total,
          since_ts: sinceTs ?? null,
          entries: logEntriesOut,
        }
      })(),
    )
  }

  if (sections.has('cdr')) {
    parallel.push(
      (async () => {
        let report = getCachedCdrAuditReport()
        if (!report) {
          report = await runCdrPipelineAudit(env)
        }
        out.cdr_audit = { report }
      })(),
    )
  }

  if (sections.has('coverage')) {
    parallel.push(
      (async () => {
        let report =
          getCachedCoverageGapAuditReport() || (await loadCoverageGapAuditReport(env.DB))
        if (!report || refreshCoverage) {
          report = await runCoverageGapAudit(env, {
            runSource: 'scheduled',
            idleMinutes: 120,
            limit: coverageLimit,
            persist: true,
          })
        }
        coverageRowsSnapshot = report.rows
        const lastRemediation =
          getCachedCoverageGapRemediationReport() || (await loadCoverageGapRemediationReport(env.DB))
        out.coverage_gaps = { report, last_remediation: lastRemediation }
      })(),
    )
  }

  if (sections.has('lender_universe')) {
    parallel.push(
      (async () => {
        let report =
          getCachedLenderUniverseAuditReport() || (await loadLenderUniverseAuditReport(env.DB))
        if (!report || refreshLenderUniverse) {
          report = await runLenderUniverseAudit(env, { persist: true })
        }
        out.lender_universe = { report }
      })(),
    )
  }

  if (sections.has('replay')) {
    parallel.push(
      (async () => {
        replayRows = await listReplayQueueRows(env.DB, { limit: replayLimit })
        out.replay_queue = { count: replayRows.length, rows: replayRows }
      })(),
    )
  }

  if (sections.has('probes') || includeProbePayloads) {
    parallel.push(
      (async () => {
        probeEvents = await getRecentFetchEvents(env.DB, {
          sourceTypePrefix: 'probe_',
          limit: probeEventLimit,
        })
        if (sections.has('probes')) {
          out.probe_fetch_events = { count: probeEvents.length, events: probeEvents }
        }
      })(),
    )
  }

  if (sections.has('backlog')) {
    parallel.push(
      (async () => {
        const backlog = await getDiagnosticsBacklog(env.DB, { limit: backlogLimit })
        out.diagnostics_backlog = backlog
      })(),
    )
  }

  await Promise.all(parallel)

  if (includeProbePayloads) {
    const fromHealth = collectFailedComponentFetchEventIds(latestHealth)
    const fromEvents = collectProbeEventIdsForPayloads(probeEvents, maxProbePayloads)
    const idSet = new Set<number>([...fromHealth, ...fromEvents])
    const ids = Array.from(idSet).slice(0, maxProbePayloads)
    const payloads: Array<Record<string, unknown>> = []
    for (const id of ids) {
      const r = await readFetchEventPayloadTruncated(env, id, maxProbePayloadBytes)
      if (r.ok) {
        payloads.push({
          fetch_event_id: id,
          event: r.event,
          content_type: r.content_type,
          truncated: r.truncated,
          body: r.body,
        })
      } else {
        payloads.push({
          fetch_event_id: id,
          error: r.error,
          event: r.event,
        })
      }
    }
    out.probe_payloads = { items: payloads }
  }

  if (sections.has('remediation')) {
    const entriesForCodes =
      logEntriesOut.length > 0
        ? logEntriesOut
        : out.logs && typeof out.logs === 'object' && 'entries' in out.logs
          ? ((out.logs as { entries: Array<Record<string, unknown>> }).entries ?? [])
          : []
    const codes = new Set<string>([
      ...actionableCodesFromHealth(latestHealth),
      ...logCodes(entriesForCodes),
    ])
    const merged = mergeRemediationHints([
      remediationFromCoverageGapRows(coverageRowsSnapshot),
      remediationFromReplayQueueRows(replayRows),
      remediationFromActionableCodes(codes),
    ])
    out.remediation = { hints: merged, note: 'Suggestions only; call each path with admin auth.' }
  }

  return out
}
