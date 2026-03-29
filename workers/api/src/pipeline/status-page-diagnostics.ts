/**
 * Single cross-section rollup for admin Status + doctor + debug bundle download.
 * Built from the same payload shape as GET .../diagnostics/status-debug-bundle (default sections).
 */

import type { DiagnosticsBacklogBundle } from '../db/diagnostics-backlog'
import type { ParsedHealthRun } from '../utils/map-health-run'

type Severity = 'green' | 'yellow' | 'red'
type MinimalHealthSnapshot = {
  run_id?: string
  checked_at?: string
  overall_ok?: boolean
  failures?: unknown[]
  economic?: { severity?: string } | null
  e2e?: {
    aligned?: boolean
    reason_code?: string
    target_collection_date?: string
  } | null
}

function worstOf(a: Severity, b: Severity): Severity {
  const rank = { green: 0, yellow: 1, red: 2 }
  return rank[a] >= rank[b] ? a : b
}

function parseIsoDateMs(value: string | null | undefined): number | null {
  const text = String(value || '').trim()
  if (!text) return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

function parseCollectionDateMs(value: string | null | undefined): number | null {
  const text = String(value || '').trim()
  if (!text) return null
  const ms = Date.parse(`${text}T00:00:00.000Z`)
  return Number.isFinite(ms) ? ms : null
}

function relevantReplayRows(
  rows: Array<Record<string, unknown>>,
  latest: ParsedHealthRun | MinimalHealthSnapshot | null,
  coverageIsClean: boolean,
): Array<Record<string, unknown>> {
  if (!rows.length) return rows

  const targetCollectionDate = String(
    (latest as ParsedHealthRun | null)?.e2e?.targetCollectionDate ||
      (latest as MinimalHealthSnapshot | null)?.e2e?.target_collection_date ||
      '',
  ).trim()
  const targetMs = parseCollectionDateMs(targetCollectionDate)
  const aligned =
    (latest as ParsedHealthRun | null)?.e2e?.aligned === true ||
    (latest as MinimalHealthSnapshot | null)?.e2e?.aligned === true
  const currentRunHealthy = aligned && (coverageIsClean || latest?.overall_ok === true)
  if (!currentRunHealthy || targetMs == null) return rows

  const successByScope = new Map<string, number>()
  for (const row of rows) {
    if (String(row.status || '').toLowerCase() !== 'succeeded') continue
    const lender = String(row.lender_code || '').trim().toLowerCase()
    const dataset = String(row.dataset_kind || '').trim().toLowerCase()
    const collectionDate = String(row.collection_date || '').trim()
    const updatedAt = parseIsoDateMs(String(row.updated_at || ''))
    if (!lender || !dataset || !collectionDate || updatedAt == null) continue
    const key = `${lender}|${dataset}|${collectionDate}`
    const previous = successByScope.get(key)
    if (previous == null || updatedAt > previous) successByScope.set(key, updatedAt)
  }

  const oneDayMs = 24 * 60 * 60 * 1000
  return rows.filter((row) => {
    const status = String(row.status || '').toLowerCase()
    if (status === 'queued' || status === 'dispatching') return true
    if (status !== 'failed') return true

    const collectionDate = String(row.collection_date || '').trim()
    const collectionMs = parseCollectionDateMs(collectionDate)
    if (collectionMs == null) return true
    if (collectionMs >= targetMs - oneDayMs) return true

    const lender = String(row.lender_code || '').trim().toLowerCase()
    const dataset = String(row.dataset_kind || '').trim().toLowerCase()
    const updatedAt = parseIsoDateMs(String(row.updated_at || ''))
    const scopeKey = `${lender}|${dataset}|${collectionDate}`
    const successAt = successByScope.get(scopeKey)
    if (successAt != null && updatedAt != null && successAt >= updatedAt) return false

    return false
  })
}

/**
 * Produce a comprehensive backend diagnostics object from a fully built status-debug-bundle JSON.
 */
export function buildStatusPageDiagnosticsFromBundle(bundle: Record<string, unknown>): Record<string, unknown> {
  const attention: string[] = []
  let worst: Severity = 'green'

  const latest =
    (bundle.health as { latest?: ParsedHealthRun | null } | undefined)?.latest ??
    ((bundle.diagnostics as Record<string, unknown> | undefined)
      ? ({
          run_id: (bundle.diagnostics as Record<string, unknown>).health_run_id,
          checked_at: (bundle.diagnostics as Record<string, unknown>).checked_at,
          overall_ok: (bundle.diagnostics as Record<string, unknown>).overall_ok === true,
          failures: Array.isArray((bundle.diagnostics as Record<string, unknown>).failures)
            ? ((bundle.diagnostics as Record<string, unknown>).failures as unknown[])
            : [],
          economic: {
            severity: (bundle.diagnostics as { economic?: { severity?: string } }).economic?.severity,
          },
          e2e: {
            aligned: (bundle.diagnostics as { e2e?: { aligned?: boolean } }).e2e?.aligned,
            reason_code: (bundle.diagnostics as { e2e?: { reason_code?: string } }).e2e?.reason_code,
            target_collection_date:
              (bundle.diagnostics as { e2e?: { target_collection_date?: string } }).e2e?.target_collection_date,
          },
        } as MinimalHealthSnapshot)
      : null)

  const integ = (latest as ParsedHealthRun | null)?.integrity as
    | { ok?: boolean; checks?: Array<{ name?: string; passed?: boolean }> }
    | undefined
  const integrityOk = integ?.ok !== false
  const failedIntegrityChecks = (integ?.checks || [])
    .filter((c) => c && c.passed === false)
    .map((c) => String(c.name || '(unnamed)'))
  if (!integrityOk) {
    attention.push(`Integrity failed: ${failedIntegrityChecks.slice(0, 8).join(', ')}${failedIntegrityChecks.length > 8 ? '…' : ''}`)
    worst = worstOf(worst, 'red')
  }

  const iaBlock = bundle.integrity_audit as {
    latest?: {
      run_id?: string
      checked_at?: string
      trigger_source?: string
      status?: string
      overall_ok?: boolean
      duration_ms?: number
      summary?: Record<string, unknown>
      findings?: Array<{ check?: string; passed?: boolean; count?: unknown; category?: string }>
    } | null
    history?: unknown[]
  } | undefined
  const iaLatest = iaBlock?.latest ?? null
  let dataIntegrityAuditSnapshot: Record<string, unknown> | null = null
  if (iaBlock) {
    if (!iaLatest) {
      attention.push('No stored D1 integrity audit run (open Data integrity or wait for daily cron).')
      worst = worstOf(worst, 'yellow')
      dataIntegrityAuditSnapshot = {
        latest: null,
        history_runs_returned: Array.isArray(iaBlock.history) ? iaBlock.history.length : 0,
      }
    } else {
      const st = String(iaLatest.status || '').toLowerCase()
      const findings = Array.isArray(iaLatest.findings) ? iaLatest.findings : []
      const failedFindings = findings.filter((f) => f && f.passed === false)
      const summary = iaLatest.summary || {}
      dataIntegrityAuditSnapshot = {
        run_id: iaLatest.run_id,
        checked_at: iaLatest.checked_at,
        trigger_source: iaLatest.trigger_source,
        status: iaLatest.status,
        overall_ok: iaLatest.overall_ok,
        duration_ms: iaLatest.duration_ms,
        summary: {
          total_checks: summary.total_checks,
          passed: summary.passed,
          failed: summary.failed,
          dead_data_issues: summary.dead_data_issues,
          invalid_data_issues: summary.invalid_data_issues,
          duplicate_data_issues: summary.duplicate_data_issues,
          other_issues: summary.other_issues,
        },
        failed_findings_sample: failedFindings.slice(0, 20).map((f) => ({
          check: f.check,
          count: f.count,
          category: f.category,
        })),
        failed_finding_count: failedFindings.length,
        history_runs_returned: Array.isArray(iaBlock.history) ? iaBlock.history.length : 0,
      }
      if (st === 'red' || iaLatest.overall_ok === false) {
        attention.push(`D1 integrity audit: ${st === 'red' ? 'status red' : 'overall_ok false'} (${iaLatest.run_id})`)
        worst = worstOf(worst, 'red')
      } else if (st === 'amber') {
        attention.push('D1 integrity audit: amber (minor / informational)')
        worst = worstOf(worst, 'yellow')
      }
      const blockedWrites = failedFindings.find((f) => String(f.check || '') === 'recent_blocked_write_contract_violations')
      const blockedWriteCount = Number(blockedWrites?.count ?? 0)
      if (blockedWriteCount > 0) {
        attention.push(`Active blocked write-contract violations: ${blockedWriteCount} recent row(s) quarantined`)
        worst = worstOf(worst, 'red')
      }
      const conflictFindings = failedFindings.find((f) => String(f.check || '') === 'recent_same_day_series_conflicts')
      const conflictCount = Number(conflictFindings?.count ?? 0)
      if (conflictCount > 0) {
        attention.push(`Historical data conflicts: ${conflictCount} same-day series conflict group(s)`)
        worst = worstOf(worst, 'red')
      }
      const abruptMovementFindings = failedFindings.find((f) => String(f.check || '') === 'recent_abrupt_rate_movements')
      const abruptMovementCount = Number(abruptMovementFindings?.count ?? 0)
      if (abruptMovementCount > 0) {
        attention.push(`Historical data anomalies: ${abruptMovementCount} abrupt rate movement(s) need review`)
        worst = worstOf(worst, 'red')
      }
    }
  }

  const parsedLatest = latest as ParsedHealthRun | null
  const healthActionable = parsedLatest && Array.isArray(parsedLatest.actionable) ? parsedLatest.actionable : []
  const healthActionableCount = healthActionable.length

  if (latest) {
    if (!latest.overall_ok) {
      attention.push(`Health run overall_ok=false (${latest.run_id})`)
      worst = worstOf(worst, 'red')
    }
    const fails = Array.isArray(latest.failures) ? latest.failures : []
    if (fails.length) {
      attention.push(
        `Health failure signals (${fails.length}): ${fails
          .slice(0, 8)
          .map((x) => String(x))
          .join('; ')}${fails.length > 8 ? '…' : ''}`,
      )
      worst = worstOf(worst, 'red')
    }
    const econSev = String(
      ((parsedLatest?.economic as { summary?: { severity?: string } } | undefined)?.summary?.severity ||
        (latest as MinimalHealthSnapshot | null)?.economic?.severity ||
        '') as string,
    )
    if (econSev === 'red') {
      attention.push('Economic data coverage: severity red')
      worst = worstOf(worst, 'red')
    } else if (econSev === 'yellow') {
      attention.push('Economic data coverage: severity yellow')
      worst = worstOf(worst, 'yellow')
    }
    const e2eAligned =
      (latest as ParsedHealthRun | null)?.e2e?.aligned ??
      (latest as MinimalHealthSnapshot | null)?.e2e?.aligned
    if (e2eAligned === false) {
      const reasonCode =
        (latest as ParsedHealthRun | null)?.e2e?.reasonCode ||
        (latest as MinimalHealthSnapshot | null)?.e2e?.reason_code ||
        'unknown'
      attention.push(`E2E not aligned: ${reasonCode}`)
      worst = worstOf(worst, 'red')
    }
  } else {
    attention.push('No persisted health run in D1 (run a health check).')
    worst = worstOf(worst, 'yellow')
  }

  const cdrBlock = bundle.cdr_audit as {
    report?: {
      ok?: boolean
      totals?: { failed?: number; errors?: number; warns?: number }
      failures?: Array<{ id?: string; summary?: string; severity?: string }>
    }
  } | undefined
  const cdr = cdrBlock?.report
  let cdrSnapshot: Record<string, unknown> | null = null
  if (cdr) {
    cdrSnapshot = {
      ok: cdr.ok,
      run_id: (cdr as { run_id?: string }).run_id,
      generated_at: (cdr as { generated_at?: string }).generated_at,
      totals: cdr.totals,
      failed_check_ids: (cdr.failures || []).map((f) => String(f.id || '')).filter(Boolean),
      failure_summaries: (cdr.failures || []).slice(0, 16).map((f) => ({
        id: f.id,
        severity: f.severity,
        summary: String(f.summary || '').slice(0, 220),
      })),
    }
    if (cdr.ok === false) {
      const cdrErrors = Number(cdr.totals?.errors ?? 0)
      const cdrFailed = Number(cdr.totals?.failed ?? 0)
      if (cdrErrors > 0) {
        attention.push(`CDR pipeline audit: ${cdrFailed} failed check(s)`)
        worst = worstOf(worst, 'red')
      } else if (cdrFailed > 0) {
        attention.push(`CDR pipeline audit: ${cdrFailed} historical / warning check(s)`)
        worst = worstOf(worst, 'yellow')
      }
    }
  }

  const covBlock = bundle.coverage_gaps as {
    report?: {
      collection_date?: string
      totals?: { gaps?: number; errors?: number; warns?: number }
      rows?: Array<Record<string, unknown>>
    }
  } | undefined
  const cov = covBlock?.report
  let coverageSnapshot: Record<string, unknown> | null = null
  let coverageIsClean = false
  if (cov) {
    const rows = Array.isArray(cov.rows) ? cov.rows : []
    coverageSnapshot = {
      collection_date: cov.collection_date,
      totals: cov.totals,
      open_gap_row_count: rows.length,
      sample: rows.slice(0, 12).map((r) => ({
        lender_code: r.lender_code,
        dataset_kind: r.dataset_kind,
        severity: r.severity,
        reasons: r.reasons,
        updated_at: r.updated_at,
      })),
    }
    const errs = Number(cov.totals?.errors ?? 0)
    const gaps = Number(cov.totals?.gaps ?? 0)
    coverageIsClean = errs === 0 && gaps === 0
    if (errs > 0) {
      attention.push(`Coverage gaps: ${errs} error-class row(s)`)
      worst = worstOf(worst, 'red')
    } else if (gaps > 0) {
      attention.push(`Coverage gaps: ${gaps} open gap(s)`)
      worst = worstOf(worst, 'yellow')
    }
  }

  const luBlock = bundle.lender_universe as {
    report?: {
      totals?: { missing_from_register?: number; endpoint_drift?: number; configured_lenders?: number }
      rows?: Array<{ lender_code?: string; status?: string }>
      error?: string
    }
  } | undefined
  const lu = luBlock?.report
  let lenderSnapshot: Record<string, unknown> | null = null
  if (lu) {
    const rows = Array.isArray(lu.rows) ? lu.rows : []
    const problems = rows.filter((r) => {
      const st = String(r.status || '').toLowerCase()
      return st === 'missing_from_register' || st === 'endpoint_drift'
    })
    lenderSnapshot = {
      totals: lu.totals,
      problem_row_count: problems.length,
      sample: problems.slice(0, 14).map((r) => ({
        lender_code: r.lender_code,
        status: r.status,
      })),
      error: lu.error ?? null,
    }
    const miss = Number(lu.totals?.missing_from_register ?? 0)
    const drift = Number(lu.totals?.endpoint_drift ?? 0)
    if (miss > 0) {
      attention.push(`Lender universe: ${miss} missing from register`)
      worst = worstOf(worst, 'red')
    }
    if (drift > 0) {
      attention.push(`Lender universe: ${drift} endpoint drift`)
      worst = worstOf(worst, 'yellow')
    }
  }

  const rqBlock = bundle.replay_queue as { count?: number; rows?: Array<Record<string, unknown>> } | undefined
  const rrows = Array.isArray(rqBlock?.rows) ? rqBlock.rows : []
  const relevantReplay = relevantReplayRows(rrows, latest, coverageIsClean)
  const failedReplay = relevantReplay.filter((r) => String(r.status || '').toLowerCase() === 'failed').length
  const queuedReplay = relevantReplay.filter((r) =>
    ['queued', 'dispatching'].includes(String(r.status || '').toLowerCase()),
  ).length
  const replaySnapshot = {
    row_count: rqBlock?.count ?? rrows.length,
    failed: failedReplay,
    queued_or_dispatching: queuedReplay,
    historical_failed_ignored:
      rrows.filter((r) => String(r.status || '').toLowerCase() === 'failed').length - failedReplay,
    sample: relevantReplay.slice(0, 10).map((r) => ({
      status: r.status,
      lender_code: r.lender_code,
      dataset_kind: r.dataset_kind,
      collection_date: r.collection_date,
      last_error: r.last_error ? String(r.last_error).slice(0, 200) : null,
    })),
  }
  if (failedReplay > 0) {
    attention.push(`Replay queue: ${failedReplay} failed row(s)`)
    worst = worstOf(worst, 'red')
  }
  if (queuedReplay > 8) {
    attention.push(`Replay queue: ${queuedReplay} queued/dispatching`)
    worst = worstOf(worst, 'yellow')
  }

  const probeBlock = bundle.probe_fetch_events as {
    events?: Array<{ httpStatus?: number | null; sourceType?: string; id?: number }>
  } | undefined
  const pev = Array.isArray(probeBlock?.events) ? probeBlock.events : []
  const badProbes = pev.filter((e) => {
    const s = e.httpStatus
    return s == null || s < 200 || s >= 300
  })
  const probeSnapshot = {
    count: pev.length,
    non_2xx_count: badProbes.length,
    non_2xx_sample: badProbes.slice(0, 12).map((e) => ({
      id: e.id,
      source_type: e.sourceType,
      http_status: e.httpStatus,
    })),
  }
  if (badProbes.length > 0) {
    attention.push(`Probe fetch events: ${badProbes.length} non-2xx`)
    worst = worstOf(worst, 'yellow')
  }

  const backlog = bundle.diagnostics_backlog as DiagnosticsBacklogBundle | undefined
  let backlogSnapshot: Record<string, unknown> | null = null
  if (backlog) {
    const rf = Number(backlog.ready_finalizations?.total ?? 0)
    const sr = Number(backlog.stale_running_runs?.total ?? 0)
    const ml = Number(backlog.missing_fetch_event_lineage?.total ?? 0)
    backlogSnapshot = {
      ready_finalizations_total: rf,
      stale_running_runs_total: sr,
      missing_fetch_event_lineage_total: ml,
      ready_sample_lenders: (backlog.ready_finalizations?.rows || []).slice(0, 6).map((r) => ({
        lender_code: r.lender_code,
        dataset_kind: r.dataset_kind,
        count: r.count,
      })),
      stale_run_sample: (backlog.stale_running_runs?.rows || []).slice(0, 4).map((r) => ({
        lender_code: r.lender_code,
        count: r.count,
      })),
    }
    const operationalBacklog = rf + sr
    if (operationalBacklog > 0) {
      attention.push(`Diagnostics backlog: ${operationalBacklog} operational row(s) (finalization ${rf}, stale runs ${sr})`)
      worst = worstOf(worst, sr > 0 ? 'red' : 'yellow')
    }
    if (ml > 0) {
      attention.push(`Historical provenance backlog: ${ml} row(s) with missing fetch_event lineage`)
      worst = worstOf(worst, 'yellow')
    }
  }

  const logsBlock = bundle.logs as {
    total?: number
    since_ts?: string | null
    entries?: Array<{ code?: string }>
    actionable?: {
      count?: number
      scanned?: number
      issues?: Array<{ code?: string; count?: number }>
    }
  } | undefined
  const entries = Array.isArray(logsBlock?.entries) ? logsBlock.entries : []
  const codeCounts = new Map<string, number>()
  for (const e of entries) {
    const c = String(e.code || '').trim() || '(no code)'
    codeCounts.set(c, (codeCounts.get(c) || 0) + 1)
  }
  const topCodes = [...codeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([code, n]) => ({ code, count: n }))
  const actionableIssues = Array.isArray(logsBlock?.actionable?.issues)
    ? logsBlock.actionable.issues
    : []
  const logsActionableCount = Number(logsBlock?.actionable?.count ?? 0)
  const actionableGroupCount = Math.max(healthActionableCount, logsActionableCount)
  const logsSnapshot = {
    since_ts: logsBlock?.since_ts ?? null,
    total: logsBlock?.total ?? entries.length,
    top_codes: topCodes,
    actionable_count: logsActionableCount,
    actionable_scanned: Number(logsBlock?.actionable?.scanned ?? 0),
    actionable_top_codes: actionableIssues.slice(0, 12).map((issue) => ({
      code: issue.code,
      count: issue.count,
    })),
  }
  if (actionableGroupCount >= 5) {
    attention.push(`Actionable log issues: ${actionableGroupCount} groups`)
    worst = worstOf(worst, 'red')
  } else if (actionableGroupCount >= 1) {
    attention.push(`Actionable log issues: ${actionableGroupCount} group(s)`)
    worst = worstOf(worst, 'yellow')
  }

  const remBlock = bundle.remediation as { hints?: Array<Record<string, unknown>> } | undefined
  const hints = Array.isArray(remBlock?.hints) ? remBlock.hints : []
  const remediationSnapshot = {
    hint_count: hints.length,
    hints_sample: hints.slice(0, 24).map((h) => ({
      issue_code: h.issue_code,
      path: h.path,
      method: h.method,
      reason: typeof h.reason === 'string' ? h.reason.slice(0, 160) : h.reason,
    })),
  }

  const components = Array.isArray(parsedLatest?.components)
    ? (parsedLatest.components as Array<{ ok?: boolean; key?: string; status?: number; detail?: string }>)
    : []
  const failedComponents = components
    .filter((c: { ok?: boolean }) => c && c.ok === false)
    .map((c: { key?: string; status?: number; detail?: string }) => ({
      key: c.key,
      status: c.status,
      detail: c.detail ? String(c.detail).slice(0, 160) : null,
    }))

  return {
    generated_at: new Date().toISOString(),
    bundle_sections: (bundle.meta as { sections?: string[] } | undefined)?.sections ?? null,
    executive: {
      worst_severity: worst,
      attention_required: attention.length > 0,
      attention_items: attention,
    },
    health_run: latest
      ? {
          run_id: latest.run_id,
          checked_at: latest.checked_at,
          trigger_source: parsedLatest?.trigger_source ?? null,
          overall_ok: latest.overall_ok,
          duration_ms: parsedLatest?.duration_ms ?? null,
          failures: latest.failures,
          integrity_ok: integrityOk,
          integrity_failed_check_names: failedIntegrityChecks,
          failed_component_probes: failedComponents,
        }
      : null,
    economic_and_e2e: bundle.diagnostics ?? null,
    data_integrity_audit: dataIntegrityAuditSnapshot,
    cdr_audit: cdrSnapshot,
    coverage_gaps: coverageSnapshot,
    lender_universe: lenderSnapshot,
    replay_queue: replaySnapshot,
    probe_fetch_events: probeSnapshot,
    diagnostics_backlog: backlogSnapshot,
    problem_logs_window: logsSnapshot,
    remediation: remediationSnapshot,
    note:
      'Mirrors admin Status page data sources: health, health integrity checks, stored D1 integrity audit, economic, E2E, actionable, CDR audit, coverage gaps, lender universe, replay queue, probes, backlog, logs, remediation. Raw audit rows: bundle.integrity_audit.',
  }
}
