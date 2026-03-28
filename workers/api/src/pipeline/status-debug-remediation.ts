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

type IntegrityFindingHint = {
  check?: string
  passed?: boolean
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

export function remediationFromIntegrityFindings(findings: IntegrityFindingHint[]): RemediationHint[] {
  const out: RemediationHint[] = []
  for (const finding of findings) {
    if (!finding || finding.passed !== false) continue
    const check = String(finding.check || '').trim()
    if (!check) continue
    switch (check) {
      case 'recent_stored_rows_missing_fetch_event_lineage':
      case 'recent_stored_rows_unresolved_fetch_event_lineage':
        out.push({
          scope_key: `integrity|${check}|repair_lineage`,
          reason: `Integrity finding ${check}: repair missing or broken fetch-event lineage`,
          method: 'POST',
          path: '/runs/repair-lineage',
          body: {},
          issue_code: check,
          links: ['/admin/status.html', '/admin/logs.html'],
        })
        break
      case 'recent_lender_dataset_write_mismatches':
        out.push({
          scope_key: `integrity|${check}|health_run`,
          reason: `Integrity finding ${check}: run fresh health/integrity after reconciling the failing run scope`,
          method: 'POST',
          path: '/health/run',
          body: {},
          issue_code: check,
          links: ['/admin/status.html', '/admin/runs.html'],
        })
        break
      case 'orphan_product_presence_status':
        out.push({
          scope_key: `integrity|${check}|repair_catalog_presence`,
          reason: 'Repair catalog and presence rows after orphan detection',
          method: 'POST',
          path: '/runs/repair-catalog-presence',
          body: {},
          issue_code: check,
          links: ['/admin/status.html', '/admin/database.html'],
        })
        break
      case 'fetch_event_raw_object_linkage':
      case 'legacy_raw_payload_backlog':
        out.push({
          scope_key: `integrity|${check}|repair_legacy_raw_linkage`,
          reason: `Repair raw-object linkage for integrity finding ${check}`,
          method: 'POST',
          path: '/runs/repair-legacy-raw-linkage',
          body: {},
          issue_code: check,
          links: ['/admin/status.html', '/admin/database.html'],
        })
        break
      default:
        out.push({
          scope_key: `integrity|${check}|integrity_audit_run`,
          reason: `Re-run integrity audit after fixing ${check}`,
          method: 'POST',
          path: '/integrity-audit/run',
          body: {},
          issue_code: check,
          links: ['/admin/status.html', '/admin/database.html'],
        })
        break
    }
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
    case 'write_contract_violation':
      return [
        {
          scope_key: `actionable|${code}|integrity_audit_run`,
          reason: 'Run integrity audit after inspecting blocked writes and quarantined anomalies',
          method: 'POST',
          path: '/integrity-audit/run',
          body: {},
          issue_code: code,
          links: ['/admin/status.html', '/admin/logs.html', '/admin/database.html'],
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
