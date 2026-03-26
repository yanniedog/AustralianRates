import type { DatasetKind } from '../../../../packages/shared/src'
import { getAppConfig, setAppConfig } from '../db/app-config'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { triggerDailyRun } from './bootstrap-jobs'
import type { CoverageGapAuditReport } from './coverage-gap-audit'
import { dispatchReplayQueue } from './replay-queue'

const COVERAGE_GAP_REMEDIATION_REPORT_KEY = 'coverage_gap_last_remediation_json'
const DEFAULT_SCOPE_LIMIT = 12
const DEFAULT_REPLAY_LIMIT = 25

type DailyRunResult = Awaited<ReturnType<typeof triggerDailyRun>>
type GapDataset = CoverageGapAuditReport['rows'][number]['dataset_kind']
type GapSeverity = CoverageGapAuditReport['rows'][number]['severity']

export type CoverageGapRemediationScope = {
  scope_key: string
  lender_code: string
  bank_name: string
  collection_date: string
  datasets: DatasetKind[]
  reasons: string[]
  row_count: number
  severity: GapSeverity
}

export type CoverageGapRemediationAttempt = CoverageGapRemediationScope & {
  action: 'replay' | 'reconcile' | 'scheduled_retry_pending' | 'skipped'
  status: 'ok' | 'pending' | 'failed' | 'skipped'
  replay: {
    claimed: number
    dispatched: number
    failed: number
  } | null
  reconcile: {
    ok: boolean
    skipped: boolean
    reason: string | null
    run_id: string | null
    enqueued: number | null
  } | null
  note: string
}

export type CoverageGapRemediationReport = {
  run_id: string
  generated_at: string
  source_collection_date: string | null
  daily_run: {
    ok: boolean
    skipped: boolean
    reason: string | null
    run_id: string | null
    enqueued: number | null
  } | null
  totals: {
    gap_rows_considered: number
    scopes_considered: number
    attempted: number
    replay: number
    reconcile: number
    scheduled_retry_pending: number
    failed: number
    skipped: number
  }
  attempts: CoverageGapRemediationAttempt[]
}

let cachedReport: CoverageGapRemediationReport | null = null

function parseReport(raw: string | null): CoverageGapRemediationReport | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as CoverageGapRemediationReport
  } catch {
    return null
  }
}

function asDataset(value: GapDataset): DatasetKind | null {
  return value === 'home_loans' || value === 'savings' || value === 'term_deposits'
    ? value
    : null
}

function compareDataset(a: DatasetKind, b: DatasetKind): number {
  const order: DatasetKind[] = ['home_loans', 'savings', 'term_deposits']
  return order.indexOf(a) - order.indexOf(b)
}

function uniqSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

function dailyRunSummary(result: DailyRunResult | null | undefined): CoverageGapRemediationReport['daily_run'] {
  if (!result) return null
  const value = result as DailyRunResult & {
    skipped?: boolean
    reason?: string
    runId?: string
    enqueued?: number
  }
  return {
    ok: Boolean(value.ok),
    skipped: Boolean(value.skipped),
    reason: value.reason || null,
    run_id: value.runId || null,
    enqueued: Number.isFinite(Number(value.enqueued)) ? Number(value.enqueued) : null,
  }
}

function dailyRunReason(result: DailyRunResult | null | undefined): string | null {
  return dailyRunSummary(result)?.reason ?? null
}

function dailyRunWillRetry(result: DailyRunResult | null | undefined): boolean {
  const summary = dailyRunSummary(result)
  return Boolean(summary && summary.ok && !summary.skipped)
}

function hasDetailGapReasons(reasons: string[]): boolean {
  const normalized = new Set((reasons || []).map((reason) => String(reason || '').trim()).filter(Boolean))
  return (
    normalized.has('detail_processing_incomplete') ||
    normalized.has('detail_fetch_events_missing') ||
    normalized.has('zero_accepted_rows_for_nonzero_expected_details') ||
    normalized.has('zero_written_rows_for_nonzero_expected_details')
  )
}

export function groupCoverageGapRowsForRemediation(
  rows: CoverageGapAuditReport['rows'],
  maxScopes = DEFAULT_SCOPE_LIMIT,
): CoverageGapRemediationScope[] {
  const grouped = new Map<
    string,
    {
      lender_code: string
      bank_name: string
      collection_date: string
      datasets: Set<DatasetKind>
      reasons: Set<string>
      row_count: number
      severity: GapSeverity
    }
  >()

  for (const row of rows) {
    const dataset = asDataset(row.dataset_kind)
    const lenderCode = String(row.lender_code || '').trim()
    const collectionDate = String(row.collection_date || '').trim()
    if (!dataset || !lenderCode || !collectionDate || row.severity !== 'error') continue
    const key = `${collectionDate}|${lenderCode}`
    const entry = grouped.get(key) ?? {
      lender_code: lenderCode,
      bank_name: String(row.bank_name || '').trim() || lenderCode,
      collection_date: collectionDate,
      datasets: new Set<DatasetKind>(),
      reasons: new Set<string>(),
      row_count: 0,
      severity: 'error' as const,
    }
    entry.datasets.add(dataset)
    for (const reason of row.reasons || []) {
      const normalized = String(reason || '').trim()
      if (normalized) entry.reasons.add(normalized)
    }
    entry.row_count += 1
    grouped.set(key, entry)
  }

  return Array.from(grouped.entries())
    .sort(([aKey], [bKey]) => bKey.localeCompare(aKey))
    .slice(0, Math.max(1, Math.floor(Number(maxScopes) || DEFAULT_SCOPE_LIMIT)))
    .map(([key, entry]) => ({
      scope_key: key,
      lender_code: entry.lender_code,
      bank_name: entry.bank_name,
      collection_date: entry.collection_date,
      datasets: Array.from(entry.datasets).sort(compareDataset),
      reasons: uniqSorted(entry.reasons),
      row_count: entry.row_count,
      severity: entry.severity,
    }))
}

export async function loadCoverageGapRemediationReport(db: D1Database): Promise<CoverageGapRemediationReport | null> {
  const raw = await getAppConfig(db, COVERAGE_GAP_REMEDIATION_REPORT_KEY)
  const parsed = parseReport(raw)
  cachedReport = parsed
  return parsed
}

export function getCachedCoverageGapRemediationReport(): CoverageGapRemediationReport | null {
  return cachedReport
}

export async function runCoverageGapRemediation(
  env: EnvBindings,
  input: {
    auditReport: CoverageGapAuditReport
    dailyRunResult?: DailyRunResult | null
    persist?: boolean
    scopeLimit?: number
    replayLimit?: number
  },
): Promise<CoverageGapRemediationReport> {
  const generatedAt = new Date().toISOString()
  const scopeLimit = Math.max(1, Math.floor(Number(input.scopeLimit) || DEFAULT_SCOPE_LIMIT))
  const replayLimit = Math.max(1, Math.floor(Number(input.replayLimit) || DEFAULT_REPLAY_LIMIT))
  const scopes = groupCoverageGapRowsForRemediation(input.auditReport.rows || [], scopeLimit)
  const attempts: CoverageGapRemediationAttempt[] = []

  for (const scope of scopes) {
    let action: CoverageGapRemediationAttempt['action'] = 'skipped'
    let status: CoverageGapRemediationAttempt['status'] = 'skipped'
    let replay: CoverageGapRemediationAttempt['replay'] = null
    let reconcile: CoverageGapRemediationAttempt['reconcile'] = null
    let note = 'No remediation attempted.'

    try {
      const replayResult = await dispatchReplayQueue(env, {
        lenderCode: scope.lender_code,
        collectionDate: scope.collection_date,
        dataset: scope.datasets.length === 1 ? scope.datasets[0] : undefined,
        forceDue: true,
        limit: replayLimit,
      })
      replay = {
        claimed: replayResult.claimed,
        dispatched: replayResult.dispatched,
        failed: replayResult.failed,
      }

      if (replayResult.dispatched > 0) {
        action = 'replay'
        status = replayResult.failed > 0 ? 'failed' : 'ok'
        note =
          replayResult.failed > 0
            ? `Replay dispatch failed for ${replayResult.failed} queued item(s).`
            : `Dispatched ${replayResult.dispatched} replay item(s) for this scope.`
      } else if (
        hasDetailGapReasons(scope.reasons) ||
        dailyRunReason(input.dailyRunResult) === 'already_fresh_for_date' ||
        !input.dailyRunResult
      ) {
        const reconcileResult = await triggerDailyRun(env, {
          source: 'manual',
          force: true,
          runIdOverride: `daily:${scope.collection_date}:coverage-gap-remediate:${crypto.randomUUID()}`,
          collectionDateOverride: scope.collection_date,
          lenderCodes: [scope.lender_code],
          datasets: scope.datasets,
        })
        const summary = dailyRunSummary(reconcileResult)
        reconcile = {
          ok: Boolean(summary?.ok),
          skipped: Boolean(summary?.skipped),
          reason: summary?.reason ?? null,
          run_id: summary?.run_id ?? null,
          enqueued: summary?.enqueued ?? null,
        }

        action = 'reconcile'
        if (reconcile.ok && !reconcile.skipped) {
          status = 'ok'
          note = `Queued forced lender/day reconciliation run ${reconcile.run_id || 'n/a'}.`
        } else {
          status = 'failed'
          note = `Forced lender/day reconciliation did not queue work (${reconcile.reason || 'unknown'}).`
        }
      } else if (dailyRunWillRetry(input.dailyRunResult)) {
        action = 'scheduled_retry_pending'
        status = 'pending'
        note = 'Scheduled daily retry is already enqueuing incomplete lender/dataset work for the active date.'
      } else {
        action = 'scheduled_retry_pending'
        status = 'pending'
        note = `Scheduled retry path remains active (${dailyRunReason(input.dailyRunResult) || 'pending'}).`
      }
    } catch (error) {
      status = 'failed'
      note = (error as Error)?.message || String(error)
    }

    attempts.push({
      ...scope,
      action,
      status,
      replay,
      reconcile,
      note,
    })
  }

  const report: CoverageGapRemediationReport = {
    run_id: `coverage-gap-remediation:${generatedAt}:${crypto.randomUUID()}`,
    generated_at: generatedAt,
    source_collection_date: input.auditReport.collection_date,
    daily_run: dailyRunSummary(input.dailyRunResult),
    totals: {
      gap_rows_considered: (input.auditReport.rows || []).filter((row) => row.severity === 'error').length,
      scopes_considered: scopes.length,
      attempted: attempts.length,
      replay: attempts.filter((attempt) => attempt.action === 'replay').length,
      reconcile: attempts.filter((attempt) => attempt.action === 'reconcile').length,
      scheduled_retry_pending: attempts.filter((attempt) => attempt.action === 'scheduled_retry_pending').length,
      failed: attempts.filter((attempt) => attempt.status === 'failed').length,
      skipped: attempts.filter((attempt) => attempt.status === 'skipped').length,
    },
    attempts,
  }

  cachedReport = report
  if (input.persist !== false) {
    await setAppConfig(env.DB, COVERAGE_GAP_REMEDIATION_REPORT_KEY, JSON.stringify(report))
  }

  const sample = attempts.slice(0, 5).map((attempt) => ({
    lender_code: attempt.lender_code,
    collection_date: attempt.collection_date,
    datasets: attempt.datasets,
    action: attempt.action,
    status: attempt.status,
    note: attempt.note,
  }))

  if (report.totals.failed > 0) {
    log.error('scheduler', 'coverage_gap_auto_remediation_failed', {
      code: 'coverage_slo_breach',
      context: JSON.stringify({
        source_collection_date: report.source_collection_date,
        totals: report.totals,
        sample,
      }),
    })
  } else if (report.totals.attempted > 0) {
    log.info('scheduler', 'coverage_gap_auto_remediation_completed', {
      context: JSON.stringify({
        source_collection_date: report.source_collection_date,
        totals: report.totals,
        sample,
      }),
    })
  }

  return report
}
