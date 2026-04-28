import { SITE_HEALTH_CRON_EXPRESSION } from '../constants'
import { getIngestPauseConfig } from '../db/app-config'
import { runDataIntegrityAudit } from '../db/data-integrity-audit'
import type {
  EconomicCoverageFinding,
  EconomicCoverageProbe,
  EconomicCoverageReport,
} from '../db/economic-coverage-audit'
import { getDiagnosticsBacklog } from '../db/diagnostics-backlog'
import { readFetchEventPayloadTruncated, getRecentFetchEvents } from '../db/fetch-events'
import { getLatestHealthCheckRun, listHealthCheckRuns } from '../db/health-check-runs'
import { shouldFilterSiteHealthAttentionForActionable } from '../db/health-check-runs'
import {
  getHistoricalProvenanceSummary,
  type HistoricalProvenanceSummary,
} from '../db/historical-provenance'
import {
  getLatestIntegrityAuditRun,
  insertIntegrityAuditRun,
  listIntegrityAuditRuns,
  type IntegrityAuditRunRow,
} from '../db/integrity-audit-runs'
import { listReplayQueueRows } from '../db/ingest-replay-queue'
import { filterResolvedHistoricalTaskFailureLogEntries } from '../db/historical-task-log-resolution'
import { filterResolvedScheduledDispatchFailureLogEntries } from '../db/scheduled-log-resolution'
import { getCachedCdrAuditReport, runCdrPipelineAudit } from './cdr-audit'
import {
  getCachedCoverageGapAuditReport,
  loadCoverageGapAuditReport,
  runCoverageGapAudit,
  shouldFilterCoverageGapLogForActionable,
} from './coverage-gap-audit'
import { FETCH_EVENTS_RETENTION_DAYS } from '../db/retention-prune'
import {
  getCachedCoverageGapRemediationReport,
  loadCoverageGapRemediationReport,
} from './coverage-gap-remediation'
import {
  getCachedLenderUniverseAuditReport,
  loadLenderUniverseAuditReport,
  runLenderUniverseAudit,
} from './lender-universe-audit'
import {
  getCachedProductClassificationAuditReport,
  loadProductClassificationAuditReport,
  runProductClassificationAudit,
  shouldFilterProductClassificationLogForActionable,
} from './product-classification-audit'
import { loadPostIngestAssuranceReport } from './post-ingest-assurance'
import type { EnvBindings } from '../types'
import { extractTraceback, parseLogContext, queryProblemLogs } from '../utils/logger'
import { toActionableIssueSummaries } from '../utils/log-actionable'
import { mapHealthCheckRunRow, type ParsedHealthRun } from '../utils/map-health-run'
import { buildStatusPageDiagnosticsFromBundle } from './status-page-diagnostics'
import { filterResolvedWriteContractViolationLogEntries } from '../db/write-contract-violation-resolution'
import {
  mergeRemediationHints,
  remediationFromActionableCodes,
  remediationFromCoverageGapRows,
  remediationFromIntegrityFindings,
  remediationFromReplayQueueRows,
} from './status-debug-remediation'
import type { CoverageGapAuditReport } from './coverage-gap-audit'
import { shouldIgnoreStatusActionableLog } from '../utils/status-actionable-filter'
import { readLocalD1BudgetState } from '../utils/d1-budget'
import { listHistoricalQuarantineCounts } from '../db/historical-quarantine'

const DEFAULT_SECTIONS = [
  'health',
  'integrity_pulse',
  'integrity_audit',
  'logs',
  'cdr',
  'coverage',
  'lender_universe',
  'product_classification',
  'replay',
  'probes',
  'backlog',
  'provenance',
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

async function buildCachedIntegrityPulse(env: EnvBindings): Promise<Record<string, unknown>> {
  const [integrityRow, postIngest, coverageReport, remediationReport, budgetState, quarantineCounts] = await Promise.all([
    getLatestIntegrityAuditRun(env.DB),
    loadPostIngestAssuranceReport(env.DB).catch(() => null),
    loadCoverageGapAuditReport(env.DB).catch(() => null),
    loadCoverageGapRemediationReport(env.DB).catch(() => null),
    readLocalD1BudgetState(env, 7).catch(() => null),
    listHistoricalQuarantineCounts(env.DB).catch(() => []),
  ])
  const integrity = parseIntegrityAuditRunRow(integrityRow)
  const quarantineTotal = quarantineCounts.reduce((sum, row) => sum + Number(row.total || 0), 0)
  return {
    integrity_audit: integrity
      ? {
          checked_at: integrity.checked_at,
          status: integrity.status,
          overall_ok: integrity.overall_ok,
          run_id: integrity.run_id,
        }
      : null,
    post_ingest_assurance: postIngest
      ? {
          generated_at: postIngest.generated_at,
          collection_date: postIngest.collection_date,
          ok: postIngest.ok,
          totals: postIngest.totals,
          policy: postIngest.policy,
        }
      : null,
    coverage_gap_audit: coverageReport
      ? {
          generated_at: coverageReport.generated_at,
          collection_date: coverageReport.collection_date,
          ok: coverageReport.ok,
          totals: coverageReport.totals,
        }
      : null,
    coverage_gap_remediation: remediationReport
      ? {
          generated_at: remediationReport.generated_at,
          source_collection_date: remediationReport.source_collection_date,
          totals: remediationReport.totals,
        }
      : null,
    d1_budget: budgetState
      ? {
          generated_at: budgetState.generated_at,
          month: budgetState.month,
          guardrails: budgetState.guardrails,
        }
      : null,
    quarantine: {
      total_rows: quarantineTotal,
      by_dataset: quarantineCounts,
    },
  }
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

function parseIsoDateMs(value: string | null | undefined): number | null {
  const text = String(value || '').trim()
  if (!text) return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

function parseIntegrityAuditRunRow(row: IntegrityAuditRunRow | null): Record<string, unknown> | null {
  if (!row) return null
  let summary: Record<string, unknown> = {}
  let findings: unknown[] = []
  try {
    summary = JSON.parse(row.summary_json || '{}') as Record<string, unknown>
  } catch {
    summary = {}
  }
  try {
    findings = JSON.parse(row.findings_json || '[]') as unknown[]
  } catch {
    findings = []
  }
  return {
    run_id: row.run_id,
    checked_at: row.checked_at,
    trigger_source: row.trigger_source,
    overall_ok: row.overall_ok === 1,
    duration_ms: row.duration_ms,
    status: row.status,
    summary,
    findings,
  }
}

function parseCollectionDateMs(value: string | null | undefined): number | null {
  const text = String(value || '').trim()
  if (!text) return null
  const ms = Date.parse(`${text}T00:00:00.000Z`)
  return Number.isFinite(ms) ? ms : null
}

function filterReplayRowsForRemediation(
  rows: Awaited<ReturnType<typeof listReplayQueueRows>>,
  latestHealth: ParsedHealthRun | null,
): Awaited<ReturnType<typeof listReplayQueueRows>> {
  if (!rows.length) return rows
  const targetCollectionDate = String((latestHealth?.e2e as Record<string, unknown> | null)?.targetCollectionDate || '').trim()
  if (!targetCollectionDate) return rows
  const targetMs = parseCollectionDateMs(targetCollectionDate)
  if (targetMs == null) return rows

  const oneDayMs = 24 * 60 * 60 * 1000
  const successByScope = new Map<string, number>()
  for (const row of rows) {
    if (String(row.status || '').toLowerCase() !== 'succeeded') continue
    const lender = String(row.lender_code || '').trim().toLowerCase()
    const dataset = String(row.dataset_kind || '').trim().toLowerCase()
    const cdate = String(row.collection_date || '').trim()
    if (!lender || !dataset || !cdate) continue
    const updated = parseIsoDateMs(row.updated_at)
    if (updated == null) continue
    const key = `${lender}|${dataset}|${cdate}`
    const prev = successByScope.get(key)
    if (prev == null || updated > prev) successByScope.set(key, updated)
  }

  return rows.filter((row) => {
    const status = String(row.status || '').toLowerCase()
    if (status !== 'failed' && status !== 'queued') return true
    const cdate = String(row.collection_date || '').trim()
    const collectionMs = parseCollectionDateMs(cdate)
    if (collectionMs == null) return true
    const isOlderThanRecentWindow = collectionMs < targetMs - oneDayMs
    if (!isOlderThanRecentWindow) return true

    const lender = String(row.lender_code || '').trim().toLowerCase()
    const dataset = String(row.dataset_kind || '').trim().toLowerCase()
    if (!lender || !dataset) return false

    const scopeKey = `${lender}|${dataset}|${cdate}`
    const resolvedScope = successByScope.has(scopeKey)
    if (resolvedScope) return false

    const hasRecentHealthyE2e = latestHealth?.e2e?.aligned === true
    return !hasRecentHealthyE2e
  })
}

/** Compact economic + E2E diagnostics for debug bundle, doctor, and operators (mirrors persisted health run). */
function diagnosticsFromLatestHealth(h: ParsedHealthRun): Record<string, unknown> {
  const economic = h.economic as EconomicCoverageReport
  const summary = economic?.summary
  const findings = Array.isArray(economic?.findings) ? economic.findings : []
  const probes = Array.isArray(economic?.probes) ? economic.probes : []
  const perSeries = Array.isArray(economic?.per_series) ? economic.per_series : []
  const errorLikeSeries = perSeries
    .filter((r) => r.severity === 'red' || r.computed_status === 'error')
    .slice(0, 16)
    .map((r) => ({
      series_id: r.series_id,
      computed_status: r.computed_status,
      stored_status: r.stored_status,
      status_message: r.status_message ? String(r.status_message).slice(0, 240) : null,
    }))

  return {
    health_run_id: h.run_id,
    checked_at: h.checked_at,
    overall_ok: h.overall_ok,
    failures: h.failures,
    economic: {
      severity: summary?.severity,
      defined_series: summary?.defined_series,
      ok_series: summary?.ok_series,
      stale_series: summary?.stale_series,
      error_series: summary?.error_series,
      missing_series: summary?.missing_series,
      public_probe_failures: summary?.public_probe_failures,
      findings: findings.slice(0, 24).map((f: EconomicCoverageFinding) => ({
        code: f.code,
        severity: f.severity,
        message: f.message.slice(0, 280),
        count: f.count,
      })),
      failed_probes: probes
        .filter((p: EconomicCoverageProbe) => !p.ok)
        .map((p) => ({
          key: p.key,
          status: p.status,
          detail: String(p.detail || '').slice(0, 200),
          fetch_event_id: p.fetch_event_id ?? null,
        })),
      error_like_series_sample: errorLikeSeries,
    },
    e2e: {
      aligned: h.e2e.aligned,
      reason_code: h.e2e.reasonCode,
      reason_detail: String(h.e2e.reasonDetail || '').slice(0, 600),
      target_collection_date: h.e2e.targetCollectionDate,
      source_mode: h.e2e.sourceMode,
      criteria: h.e2e.criteria,
      failed_datasets: h.e2e.datasets
        .filter((d) => !d.ok)
        .map((d) => ({
          dataset: d.dataset,
          failure_code: d.failureCode,
          detail: String(d.detail || '').slice(0, 320),
          fetch_event_ids: d.fetchEventIds,
        })),
    },
  }
}

export type BuildStatusDebugBundleQuery = {
  sections?: string
  healthHistoryLimit?: string
  refreshIntegrityAudit?: string
  refreshCdr?: string
  refreshCoverage?: string
  refreshLenderUniverse?: string
  refreshProductClassification?: string
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
  integrityHistoryLimit?: string
  provenanceLimit?: string
}

export async function buildStatusDebugBundle(
  env: EnvBindings,
  query: BuildStatusDebugBundleQuery,
  authMode: string | null,
): Promise<Record<string, unknown>> {
  const sections = parseStatusDebugSections(query.sections)
  const healthHistoryLimit = clamp(Math.floor(Number(query.healthHistoryLimit) || 12), 1, 48)
  const refreshIntegrityAudit = truthyQuery(query.refreshIntegrityAudit)
  const refreshCdr = truthyQuery(query.refreshCdr)
  const refreshCoverage = truthyQuery(query.refreshCoverage)
  const refreshLenderUniverse = truthyQuery(query.refreshLenderUniverse)
  const refreshProductClassification = truthyQuery(query.refreshProductClassification)
  const logLimit = clamp(Math.floor(Number(query.logLimit) || 500), 1, 10000)
  const logHoursBeforeHealth = clamp(Math.floor(Number(query.logHoursBeforeHealth) || 24), 1, 168)
  const includeProbePayloads = truthyQuery(query.includeProbePayloads)
  const maxProbePayloads = clamp(Math.floor(Number(query.maxProbePayloads) || 8), 1, 20)
  const maxProbePayloadBytes = clamp(Math.floor(Number(query.maxProbePayloadBytes) || 262_144), 4096, 2_000_000)
  const backlogLimit = clamp(Math.floor(Number(query.backlogLimit) || 200), 1, 1000)
  const coverageLimit = clamp(Math.floor(Number(query.coverageLimit) || 100), 1, 500)
  const replayLimit = clamp(Math.floor(Number(query.replayLimit) || 50), 1, 200)
  const probeEventLimit = clamp(Math.floor(Number(query.probeEventLimit) || 40), 1, 100)
  const integrityHistoryLimit = clamp(Math.floor(Number(query.integrityHistoryLimit) || 24), 1, 50)
  const provenanceLimit = clamp(Math.floor(Number(query.provenanceLimit) || 20), 1, 50)

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
    if (latestHealth) {
      out.diagnostics = diagnosticsFromLatestHealth(latestHealth)
    }
  }

  if (sections.has('health')) {
    const history = await listHealthCheckRuns(env.DB, healthHistoryLimit)
    out.health = {
      latest: latestHealth,
      history: history.map((row) => mapHealthCheckRunRow(row)).filter(Boolean),
    }
  }

  if (sections.has('integrity_pulse')) {
    out.integrity_pulse = await buildCachedIntegrityPulse(env)
  }

  const actionableHealthContext = latestHealth
    ? {
        checked_at: latestHealth.checked_at,
        overall_ok: latestHealth.overall_ok ? 1 : 0,
      }
    : null

  let coverageRowsSnapshot: CoverageGapAuditReport['rows'] = []
  let replayRows: Awaited<ReturnType<typeof listReplayQueueRows>> = []
  let probeEvents: Awaited<ReturnType<typeof getRecentFetchEvents>> = []
  let logEntriesOut: Array<Record<string, unknown>> = []
  let actionableLogEntriesOut: Array<Record<string, unknown>> = []
  let actionableIssueCodesOut: string[] = []
  let integrityFindingSnapshot: Array<{ check?: string; passed?: boolean }> = []
  let provenanceSummarySnapshot: HistoricalProvenanceSummary | null = null

  const parallel: Promise<void>[] = []

  if (sections.has('integrity_audit')) {
    parallel.push(
      (async () => {
        const [latestRow, historyRows] = await Promise.all([
          getLatestIntegrityAuditRun(env.DB),
          listIntegrityAuditRuns(env.DB, integrityHistoryLimit),
        ])
        let latestParsed = parseIntegrityAuditRunRow(latestRow)
        if (refreshIntegrityAudit) {
          const refreshed = await runDataIntegrityAudit(env.DB, env.MELBOURNE_TIMEZONE || 'Australia/Melbourne')
          latestParsed = {
            run_id: `integrity:status-bundle:${refreshed.checked_at}:${crypto.randomUUID()}`,
            checked_at: refreshed.checked_at,
            trigger_source: 'manual',
            overall_ok: refreshed.ok,
            duration_ms: refreshed.duration_ms,
            status: refreshed.status,
            summary: refreshed.summary,
            findings: refreshed.findings,
          }
          try {
            await insertIntegrityAuditRun(env.DB, {
              runId: String(latestParsed.run_id),
              checkedAt: refreshed.checked_at,
              triggerSource: 'manual',
              overallOk: refreshed.ok,
              durationMs: refreshed.duration_ms,
              status: refreshed.status,
              summaryJson: JSON.stringify(refreshed.summary),
              findingsJson: JSON.stringify(refreshed.findings),
            })
            const latestAfter = await getLatestIntegrityAuditRun(env.DB)
            latestParsed = parseIntegrityAuditRunRow(latestAfter)
          } catch {
            // If persistence fails, still surface the refreshed snapshot honestly in the bundle response.
          }
        }
        out.integrity_audit = {
          latest: latestParsed,
          history: historyRows.map((r) => parseIntegrityAuditRunRow(r)).filter(Boolean),
        }
        const latestFindings = Array.isArray((out.integrity_audit as { latest?: { findings?: unknown[] } }).latest?.findings)
          ? ((out.integrity_audit as { latest?: { findings?: Array<{ check?: string; passed?: boolean }> } }).latest?.findings ?? [])
          : []
        integrityFindingSnapshot = latestFindings
      })(),
    )
  }

  if (sections.has('logs')) {
    parallel.push(
      (async () => {
        const sinceTs = sinceExplicit ?? logSinceFromHealth(latestHealth?.checked_at, logHoursBeforeHealth)
        const [{ entries, total }, pauseConfig, gapReport, classificationReport] = await Promise.all([
          queryProblemLogs(env.DB, { sinceTs, limit: logLimit }),
          getIngestPauseConfig(env.DB).catch(() => ({ mode: 'active' as const, reason: null })),
          loadCoverageGapAuditReport(env.DB).catch(() => null),
          loadProductClassificationAuditReport(env.DB).catch(() => null),
        ])
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
        const baseActionableLogEntries = logEntriesOut.filter((entry) => {
          const level = String(entry.level || '').toLowerCase()
          if (level !== 'warn' && level !== 'error') return false
          if (shouldFilterCoverageGapLogForActionable(entry, gapReport)) return false
          if (shouldFilterProductClassificationLogForActionable(entry, classificationReport)) return false
          if (shouldFilterSiteHealthAttentionForActionable(entry, actionableHealthContext)) return false
          if (shouldIgnoreStatusActionableLog(entry, pauseConfig.mode)) return false
          return true
        })
        actionableLogEntriesOut = await filterResolvedScheduledDispatchFailureLogEntries(env.DB, baseActionableLogEntries)
        actionableLogEntriesOut = await filterResolvedHistoricalTaskFailureLogEntries(env.DB, actionableLogEntriesOut)
        actionableLogEntriesOut = await filterResolvedWriteContractViolationLogEntries(env.DB, actionableLogEntriesOut)
        const actionableIssues = toActionableIssueSummaries(actionableLogEntriesOut)
        actionableIssueCodesOut = actionableIssues
          .map((issue) => String(issue.code || '').trim())
          .filter(Boolean)
        out.logs = {
          total,
          since_ts: sinceTs ?? null,
          entries: logEntriesOut,
          actionable: {
            count: actionableIssues.length,
            scanned: actionableLogEntriesOut.length,
            issues: actionableIssues,
          },
        }
      })(),
    )
  }

  if (sections.has('cdr')) {
    parallel.push(
      (async () => {
        let report = getCachedCdrAuditReport()
        if (refreshCdr) {
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
        if (refreshCoverage) {
          report = await runCoverageGapAudit(env, {
            runSource: 'scheduled',
            idleMinutes: 120,
            limit: coverageLimit,
            persist: true,
          })
        }
        coverageRowsSnapshot = report?.rows ?? []
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

  if (sections.has('product_classification')) {
    parallel.push(
      (async () => {
        let report =
          getCachedProductClassificationAuditReport() ||
          (await loadProductClassificationAuditReport(env.DB))
        if (refreshProductClassification) {
          try {
            report = await runProductClassificationAudit(env, { persist: true })
          } catch {
            // Fall through with whatever cached report (or null) we have.
          }
        }
        out.product_classification = { report }
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
        const backlog = await getDiagnosticsBacklog(env.DB, {
          limit: backlogLimit,
          lookbackDays: FETCH_EVENTS_RETENTION_DAYS,
        })
        out.diagnostics_backlog = backlog
      })(),
    )
  }

  if (sections.has('provenance')) {
    parallel.push(
      (async () => {
        provenanceSummarySnapshot = await getHistoricalProvenanceSummary(env.DB, {
          lookbackDays: FETCH_EVENTS_RETENTION_DAYS,
          limit: provenanceLimit,
        })
        out.historical_provenance = provenanceSummarySnapshot
      })(),
    )
  }

  await Promise.all(parallel)
  const provenanceSummary = provenanceSummarySnapshot as HistoricalProvenanceSummary | null

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
    const codes = new Set<string>([
      ...actionableCodesFromHealth(latestHealth),
      ...actionableIssueCodesOut,
    ])
    const provenanceRemediationHints: ReturnType<typeof remediationFromActionableCodes> = []
    if (provenanceSummary?.available) {
      const provenanceCodes = [
        provenanceSummary.quarantined_rows > 0
          ? 'historical_provenance_quarantined_rows'
          : '',
        provenanceSummary.legacy_unverifiable_rows > 0
          ? 'historical_provenance_legacy_unverifiable_rows'
          : '',
      ].filter(Boolean)
      provenanceRemediationHints.push(...remediationFromActionableCodes(provenanceCodes))
    }
    const merged = mergeRemediationHints([
      remediationFromCoverageGapRows(coverageRowsSnapshot),
      remediationFromReplayQueueRows(filterReplayRowsForRemediation(replayRows, latestHealth)),
      remediationFromIntegrityFindings(integrityFindingSnapshot),
      provenanceRemediationHints,
      remediationFromActionableCodes(codes),
    ])
    out.remediation = { hints: merged, note: 'Suggestions only; call each path with admin auth.' }
  }

  out.status_page_diagnostics = buildStatusPageDiagnosticsFromBundle(out)

  return out
}
