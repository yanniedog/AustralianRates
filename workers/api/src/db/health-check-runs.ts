export type HealthCheckRunRow = {
  run_id: string
  checked_at: string
  trigger_source: 'scheduled' | 'manual'
  overall_ok: number
  duration_ms: number
  components_json: string
  integrity_json: string
  e2e_aligned: number
  e2e_reason_code: string | null
  e2e_reason_detail: string | null
  actionable_json: string
  failures_json: string
}

export type InsertHealthCheckRunInput = {
  runId: string
  checkedAt: string
  triggerSource: 'scheduled' | 'manual'
  overallOk: boolean
  durationMs: number
  componentsJson: string
  integrityJson: string
  e2eAligned: boolean
  e2eReasonCode: string | null
  e2eReasonDetail: string | null
  actionableJson: string
  failuresJson: string
}

/**
 * Persist a health check run. No-op if migration 0019 has not been applied (table missing);
 * callers can rely on the run result in the response or log without persistence.
 */
export async function insertHealthCheckRun(db: D1Database, input: InsertHealthCheckRunInput): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO health_check_runs (
           run_id, checked_at, trigger_source, overall_ok, duration_ms,
           components_json, integrity_json, e2e_aligned, e2e_reason_code, e2e_reason_detail,
           actionable_json, failures_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(
        input.runId,
        input.checkedAt,
        input.triggerSource,
        input.overallOk ? 1 : 0,
        input.durationMs,
        input.componentsJson,
        input.integrityJson,
        input.e2eAligned ? 1 : 0,
        input.e2eReasonCode,
        input.e2eReasonDetail,
        input.actionableJson,
        input.failuresJson,
      )
      .run()
  } catch {
    // Table may not exist if migration 0019_health_checks_and_log_codes.sql not yet applied.
    // Health checks still run; persistence is best-effort.
  }
}

export async function getLatestHealthCheckRun(db: D1Database): Promise<HealthCheckRunRow | null> {
  const row = await db
    .prepare(
      `SELECT run_id, checked_at, trigger_source, overall_ok, duration_ms, components_json, integrity_json,
              e2e_aligned, e2e_reason_code, e2e_reason_detail, actionable_json, failures_json
       FROM health_check_runs
       ORDER BY checked_at DESC
       LIMIT 1`,
    )
    .first<HealthCheckRunRow>()
  return row ?? null
}

/**
 * Returns recent health check runs, or [] if none or if migration 0019 not applied.
 */
export async function listHealthCheckRuns(db: D1Database, limit = 48): Promise<HealthCheckRunRow[]> {
  try {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
    const rows = await db
      .prepare(
        `SELECT run_id, checked_at, trigger_source, overall_ok, duration_ms, components_json, integrity_json,
                e2e_aligned, e2e_reason_code, e2e_reason_detail, actionable_json, failures_json
         FROM health_check_runs
         ORDER BY checked_at DESC
         LIMIT ?1`,
      )
      .bind(safeLimit)
      .all<HealthCheckRunRow>()
    return rows.results ?? []
  } catch {
    return []
  }
}
