import type { DatasetKind } from '../../../../packages/shared/src'
import type { CoverageGapAuditReport } from './coverage-gap-audit'
import type { ReplayQueueRow } from '../db/ingest-replay-queue'

export type RemediationHint = {
  scope_key: string
  reason: string
  method: 'POST' | 'GET'
  /** Path under admin API, e.g. `/runs/replay-dispatch` (no base prefix). */
  path: string
  body?: Record<string, unknown> | null
  issue_code?: string | null
  links?: string[]
}

function isDatasetKind(v: string): v is DatasetKind {
  return v === 'home_loans' || v === 'savings' || v === 'term_deposits'
}

export function remediationFromCoverageGapRows(rows: CoverageGapAuditReport['rows']): RemediationHint[] {
  const out: RemediationHint[] = []
  for (const row of rows) {
    if (row.severity !== 'error' && row.severity !== 'warn') continue
    const dk = String(row.dataset_kind || '').trim()
    if (!isDatasetKind(dk)) continue
    const lender = String(row.lender_code || '').trim()
    const collectionDate = String(row.collection_date || '').trim()
    if (!lender || !collectionDate) continue
    const scope = `coverage_gap|${collectionDate}|${lender}|${dk}`
    out.push({
      scope_key: `${scope}|replay_dispatch`,
      reason: `Coverage gap (${row.severity}): replay dispatch for lender/day/dataset`,
      method: 'POST',
      path: '/runs/replay-dispatch',
      body: {
        lender_code: lender,
        collection_date: collectionDate,
        dataset: dk,
        limit: 25,
        force_due: true,
      },
      issue_code: 'coverage_slo_breach',
      links: ['/admin/status.html', '/admin/runs.html'],
    })
    out.push({
      scope_key: `${scope}|reconcile_lender_day`,
      reason: `Coverage gap (${row.severity}): lender/day reconciliation`,
      method: 'POST',
      path: '/runs/reconcile-lender-day',
      body: {
        lender_code: lender,
        collection_date: collectionDate,
        datasets: [dk],
      },
      issue_code: 'coverage_slo_breach',
      links: ['/admin/status.html', '/admin/runs.html'],
    })
  }
  return out
}

export function remediationFromReplayQueueRows(rows: ReplayQueueRow[]): RemediationHint[] {
  const out: RemediationHint[] = []
  for (const row of rows) {
    const st = String(row.status || '').toLowerCase()
    const attempts = Number(row.replay_attempt_count || 0)
    const maxAttempts = Number(row.max_replay_attempts || 1)
    if (st !== 'failed' && !(st === 'queued' && attempts >= Math.max(1, maxAttempts - 1))) continue
    const lender = String(row.lender_code || '').trim()
    const collectionDate = String(row.collection_date || '').trim()
    const dk = row.dataset_kind != null ? String(row.dataset_kind).trim() : ''
    if (!lender || !collectionDate || !isDatasetKind(dk)) continue
    const scope = `replay_queue|${row.replay_id || row.replay_key}`
    out.push({
      scope_key: `${scope}|replay_dispatch`,
      reason: `Replay queue row ${st}: dispatch scoped replay`,
      method: 'POST',
      path: '/runs/replay-dispatch',
      body: {
        lender_code: lender,
        collection_date: collectionDate,
        dataset: dk,
        limit: 50,
        force_due: true,
      },
      issue_code: 'replay_queue_incident_opened',
      links: ['/admin/runs.html', '/admin/logs.html'],
    })
    out.push({
      scope_key: `${scope}|reconcile_lender_day`,
      reason: `Replay queue row ${st}: reconcile lender/day after fixing upstream`,
      method: 'POST',
      path: '/runs/reconcile-lender-day',
      body: {
        lender_code: lender,
        collection_date: collectionDate,
        datasets: [dk],
      },
      issue_code: 'replay_queue_incident_opened',
      links: ['/admin/runs.html', '/admin/logs.html'],
    })
  }
  return out
}

/** Suggested admin API calls for actionable issue codes (from health / logs). */
export function remediationFromActionableCodes(codes: Iterable<string>): RemediationHint[] {
  const seen = new Set<string>()
  const out: RemediationHint[] = []
  for (const raw of codes) {
    const code = String(raw || '').trim()
    if (!code || seen.has(code)) continue
    seen.add(code)
    const hints = hintsForIssueCode(code)
    out.push(...hints)
  }
  return out
}

function hintsForIssueCode(code: string): RemediationHint[] {
  switch (code) {
    case 'cdr_audit_detected_gaps':
      return [
        {
          scope_key: `actionable|${code}|cdr_audit_run`,
          reason: 'Re-run CDR pipeline audit after fixes',
          method: 'POST',
          path: '/cdr-audit/run',
          body: {},
          issue_code: code,
          links: ['/admin/status.html', '/admin/logs.html'],
        },
      ]
    case 'coverage_slo_breach':
      return [
        {
          scope_key: `actionable|${code}|coverage_gaps_refresh`,
          reason: 'Refresh coverage-gap audit (GET with refresh=1)',
          method: 'GET',
          path: '/diagnostics/coverage-gaps?refresh=1',
          issue_code: code,
          links: ['/admin/status.html'],
        },
      ]
    case 'lender_universe_drift':
      return [
        {
          scope_key: `actionable|${code}|lender_universe_run`,
          reason: 'Re-run lender universe audit',
          method: 'POST',
          path: '/diagnostics/lender-universe/run',
          body: {},
          issue_code: code,
          links: ['/admin/status.html', '/admin/config.html'],
        },
      ]
    case 'replay_queue_dispatch_failed':
      return [
        {
          scope_key: `actionable|${code}|replay_dispatch_global`,
          reason: 'Retry replay dispatch (unscoped); narrow in UI if needed',
          method: 'POST',
          path: '/runs/replay-dispatch',
          body: { limit: 50, force_due: true },
          issue_code: code,
          links: ['/admin/runs.html'],
        },
      ]
    case 'unknown_cron_expression':
    case 'app_config_unavailable':
      return [
        {
          scope_key: `actionable|${code}|health_run`,
          reason: 'Run manual health check after config/migration fix',
          method: 'POST',
          path: '/health/run',
          body: {},
          issue_code: code,
          links: ['/admin/config.html', '/admin/database.html'],
        },
      ]
    default:
      return [
        {
          scope_key: `actionable|${code}|health_run`,
          reason: 'Run manual health check to refresh status snapshot',
          method: 'POST',
          path: '/health/run',
          body: {},
          issue_code: code,
          links: ['/admin/logs.html', '/admin/runs.html'],
        },
      ]
  }
}

export function mergeRemediationHints(lists: RemediationHint[][]): RemediationHint[] {
  const byKey = new Map<string, RemediationHint>()
  for (const list of lists) {
    for (const h of list) {
      if (!byKey.has(h.scope_key)) byKey.set(h.scope_key, h)
    }
  }
  return Array.from(byKey.values())
}
