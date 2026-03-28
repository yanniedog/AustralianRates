import type { HealthCheckRunRow } from '../db/health-check-runs'
import type { EconomicCoverageReport } from '../db/economic-coverage-audit'
import type { E2EResult } from '../pipeline/e2e-alignment'

export type ParsedHealthRun = {
  run_id: string
  checked_at: string
  trigger_source: 'scheduled' | 'manual'
  overall_ok: boolean
  duration_ms: number
  components: unknown
  integrity: unknown
  economic: EconomicCoverageReport | Record<string, unknown>
  e2e: E2EResult
  actionable: unknown
  failures: unknown
}

function parseJsonSafe(raw: string | null | undefined, fallback: unknown): unknown {
  try {
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

/** Maps a persisted health_check_runs row to the same JSON shape as GET /admin/health. */
export function mapHealthCheckRunRow(row: HealthCheckRunRow | null): ParsedHealthRun | null {
  if (!row) return null
  const legacyE2EEnvelope = parseJsonSafe(row.e2e_reason_detail, null) as
    | { reason_detail?: string | null; e2e?: E2EResult }
    | null
  const legacyE2E = legacyE2EEnvelope && legacyE2EEnvelope.e2e ? legacyE2EEnvelope.e2e : null
  const fallbackE2E: E2EResult = {
    aligned: Number(row.e2e_aligned || 0) === 1,
    reasonCode: (row.e2e_reason_code as E2EResult['reasonCode']) || 'e2e_check_error',
    reasonDetail:
      (legacyE2EEnvelope && typeof legacyE2EEnvelope.reason_detail === 'string'
        ? legacyE2EEnvelope.reason_detail
        : row.e2e_reason_detail) || undefined,
    checkedAt: row.checked_at,
    targetCollectionDate: null,
    sourceMode: 'all',
    datasets: [],
    criteria: {
      scheduler: Number(row.e2e_aligned || 0) === 1,
      runsProgress: Number(row.e2e_aligned || 0) === 1,
      apiServesLatest: Number(row.e2e_aligned || 0) === 1,
    },
  }
  return {
    run_id: row.run_id,
    checked_at: row.checked_at,
    trigger_source: row.trigger_source,
    overall_ok: Number(row.overall_ok || 0) === 1,
    duration_ms: Number(row.duration_ms || 0),
    components: parseJsonSafe(row.components_json, []),
    integrity: parseJsonSafe(row.integrity_json, { ok: false, checks: [] }),
    economic: parseJsonSafe(row.economic_json, {
      checked_at: row.checked_at,
      summary: {
        severity: 'red',
        defined_series: 0,
        status_rows: 0,
        observed_series: 0,
        ok_series: 0,
        stale_series: 0,
        error_series: 0,
        missing_series: 0,
        invalid_rows: 0,
        orphan_rows: 0,
        public_probe_failures: 0,
      },
      probes: [],
      findings: [],
      per_series: [],
    }) as EconomicCoverageReport,
    e2e: legacyE2E || (parseJsonSafe(row.e2e_json, fallbackE2E) as E2EResult),
    actionable: parseJsonSafe(row.actionable_json, []),
    failures: parseJsonSafe(row.failures_json, []),
  }
}
