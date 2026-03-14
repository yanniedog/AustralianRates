import { getAppConfig, setAppConfig } from '../db/app-config'
import { listCoverageGapRows, type LenderDatasetGapRow } from '../db/lender-dataset-status'
import type { EnvBindings, RunSource } from '../types'
import { log } from '../utils/logger'

const COVERAGE_GAP_REPORT_KEY = 'coverage_gap_last_report_json'

export type CoverageGapAuditReport = {
  run_id: string
  generated_at: string
  collection_date: string | null
  ok: boolean
  totals: {
    gaps: number
    errors: number
    warns: number
  }
  rows: Array<{
    run_id: string
    lender_code: string
    bank_name: string
    dataset_kind: string
    collection_date: string
    severity: 'warn' | 'error'
    reasons: string[]
    expected_detail_count: number
    processed_detail_count: number
    completed_detail_count: number
    failed_detail_count: number
    written_row_count: number
    finalized_at: string | null
    updated_at: string
  }>
}

let cachedReport: CoverageGapAuditReport | null = null

function parseReport(raw: string | null): CoverageGapAuditReport | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as CoverageGapAuditReport
  } catch {
    return null
  }
}

function isOlderThanMinutes(updatedAt: string, idleMinutes: number): boolean {
  const updatedMs = Date.parse(updatedAt)
  if (!Number.isFinite(updatedMs)) return true
  return updatedMs <= Date.now() - Math.max(1, idleMinutes) * 60 * 1000
}

function toRow(row: LenderDatasetGapRow): CoverageGapAuditReport['rows'][number] {
  return {
    run_id: row.run_id,
    lender_code: row.lender_code,
    bank_name: row.bank_name,
    dataset_kind: row.dataset_kind,
    collection_date: row.collection_date,
    severity: row.severity === 'warn' ? 'warn' : 'error',
    reasons: row.reasons,
    expected_detail_count: Number(row.expected_detail_count || 0),
    processed_detail_count: Number(row.processed_detail_count || 0),
    completed_detail_count: Number(row.completed_detail_count || 0),
    failed_detail_count: Number(row.failed_detail_count || 0),
    written_row_count: Number(row.written_row_count || 0),
    finalized_at: row.finalized_at,
    updated_at: row.updated_at,
  }
}

async function latestCollectionDate(db: D1Database, runSource: RunSource): Promise<string | null> {
  const where = runSource === 'manual' ? `rr.run_source = 'manual'` : `(rr.run_source IS NULL OR rr.run_source = 'scheduled')`
  const row = await db
    .prepare(
      `SELECT MAX(ldr.collection_date) AS latest
       FROM lender_dataset_runs ldr
       JOIN run_reports rr
         ON rr.run_id = ldr.run_id
       WHERE rr.run_type = 'daily'
         AND ${where}`,
    )
    .first<{ latest: string | null }>()
  return row?.latest ?? null
}

export async function loadCoverageGapAuditReport(db: D1Database): Promise<CoverageGapAuditReport | null> {
  const raw = await getAppConfig(db, COVERAGE_GAP_REPORT_KEY)
  const parsed = parseReport(raw)
  cachedReport = parsed
  return parsed
}

export function getCachedCoverageGapAuditReport(): CoverageGapAuditReport | null {
  return cachedReport
}

export async function runCoverageGapAudit(
  env: EnvBindings,
  input: {
    collectionDate?: string
    runSource?: RunSource
    idleMinutes?: number
    limit?: number
    persist?: boolean
  } = {},
): Promise<CoverageGapAuditReport> {
  const generatedAt = new Date().toISOString()
  const runSource = input.runSource ?? 'scheduled'
  const collectionDate = input.collectionDate ?? await latestCollectionDate(env.DB, runSource)
  const idleMinutes = Math.max(1, Math.floor(Number(input.idleMinutes) || 120))
  const rawRows = collectionDate
    ? await listCoverageGapRows(env.DB, {
        collectionDate,
        runSource,
        limit: input.limit ?? 200,
      })
    : []
  const relevantRows = rawRows
    .filter((row) => row.finalized_at || isOlderThanMinutes(row.updated_at, idleMinutes))
    .map(toRow)

  const report: CoverageGapAuditReport = {
    run_id: `coverage-gap-audit:${generatedAt}:${crypto.randomUUID()}`,
    generated_at: generatedAt,
    collection_date: collectionDate,
    ok: relevantRows.length === 0,
    totals: {
      gaps: relevantRows.length,
      errors: relevantRows.filter((row) => row.severity === 'error').length,
      warns: relevantRows.filter((row) => row.severity === 'warn').length,
    },
    rows: relevantRows,
  }

  cachedReport = report
  if (input.persist !== false) {
    await setAppConfig(env.DB, COVERAGE_GAP_REPORT_KEY, JSON.stringify(report))
  }

  if (report.ok) {
    log.info('scheduler', 'coverage_gap_audit_ok', {
      context: `collection_date=${collectionDate || 'none'} idle_minutes=${idleMinutes}`,
    })
  } else {
    log.error('scheduler', 'coverage_gap_audit_detected_gaps', {
      code: 'coverage_slo_breach',
      context: JSON.stringify({
        collection_date: collectionDate,
        idle_minutes: idleMinutes,
        gaps: report.totals.gaps,
        errors: report.totals.errors,
        warns: report.totals.warns,
        sample: report.rows.slice(0, 5),
      }),
    })
  }

  return report
}
