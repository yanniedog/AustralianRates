import { runRetentionPrunes } from './retention-prune'

export type HealthCheckRunRow = {
  run_id: string
  checked_at: string
  trigger_source: 'scheduled' | 'manual'
  overall_ok: number
  duration_ms: number
  components_json: string
  integrity_json: string
  economic_json?: string | null
  e2e_json?: string | null
  e2e_aligned: number
  e2e_reason_code: string | null
  e2e_reason_detail: string | null
  actionable_json: string
  failures_json: string
}

type HealthCheckActionableContext = Pick<HealthCheckRunRow, 'checked_at' | 'overall_ok'>

/**
 * Stale `site_health_attention` rows stay in global_log; once a later persisted health run is overall_ok,
 * drop older attention rows from actionable triage (same idea as coverage gap supersede).
 */
export function shouldFilterSiteHealthAttentionForActionable(
  entry: Record<string, unknown>,
  latest: HealthCheckActionableContext | null,
): boolean {
  const msg = String(entry.message || '')
    .trim()
    .toLowerCase()
  if (msg !== 'site_health_attention') return false
  if (!latest) return false
  if (Number(latest.overall_ok) !== 1) return false
  const logTs = String(entry.ts || '')
  const checkedAt = String(latest.checked_at || '')
  if (!logTs || !checkedAt) return false
  return logTs < checkedAt
}

export type InsertHealthCheckRunInput = {
  runId: string
  checkedAt: string
  triggerSource: 'scheduled' | 'manual'
  overallOk: boolean
  durationMs: number
  componentsJson: string
  integrityJson: string
  economicJson: string
  e2eJson: string
  e2eAligned: boolean
  e2eReasonCode: string | null
  e2eReasonDetail: string | null
  actionableJson: string
  failuresJson: string
}

const HEALTH_RUN_RETENTION_DAYS = 1

function isLegacySchemaError(error: unknown): boolean {
  const text = String((error as { message?: unknown })?.message ?? error ?? '').toLowerCase()
  return text.includes('no such column') || text.includes('has no column named') || text.includes('no such table')
}

function legacyE2EDetailPayload(input: InsertHealthCheckRunInput): string | null {
  try {
    return JSON.stringify({
      reason_detail: input.e2eReasonDetail,
      e2e: JSON.parse(input.e2eJson),
    })
  } catch {
    return input.e2eReasonDetail
  }
}

/**
 * Prune health_check_runs: delete rows older than HEALTH_RUN_RETENTION_DAYS.
 * No-op on error (e.g. table missing).
 */
export async function pruneHealthCheckRuns(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(`DELETE FROM health_check_runs WHERE checked_at < datetime('now', ?1)`)
      .bind(`-${HEALTH_RUN_RETENTION_DAYS} days`)
      .run()
  } catch {
    // Table may not exist or schema may differ; ignore.
  }
}

/**
 * Persist a health check run. No-op if migration 0019 has not been applied (table missing);
 * callers can rely on the run result in the response or log without persistence.
 * After insert, prunes runs older than retention window and caps total rows.
 */
export async function insertHealthCheckRun(db: D1Database, input: InsertHealthCheckRunInput): Promise<void> {
  try {
    try {
      await db
        .prepare(
          `INSERT INTO health_check_runs (
             run_id, checked_at, trigger_source, overall_ok, duration_ms,
             components_json, integrity_json, economic_json, e2e_json, e2e_aligned, e2e_reason_code, e2e_reason_detail,
             actionable_json, failures_json
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        )
        .bind(
          input.runId,
          input.checkedAt,
          input.triggerSource,
          input.overallOk ? 1 : 0,
          input.durationMs,
          input.componentsJson,
          input.integrityJson,
          input.economicJson,
          input.e2eJson,
          input.e2eAligned ? 1 : 0,
          input.e2eReasonCode,
          input.e2eReasonDetail,
          input.actionableJson,
          input.failuresJson,
        )
        .run()
    } catch (error) {
      if (!isLegacySchemaError(error)) throw error
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
          legacyE2EDetailPayload(input),
          input.actionableJson,
          input.failuresJson,
        )
        .run()
    }
    await pruneHealthCheckRuns(db)
    await runRetentionPrunes(db)
  } catch {
    // Table may not exist if migration 0019_health_checks_and_log_codes.sql not yet applied.
    // Health checks still run; persistence is best-effort.
  }
}

/**
 * Returns the latest health check run, or null if none or if migration 0019 not applied.
 */
export async function getLatestHealthCheckRun(db: D1Database): Promise<HealthCheckRunRow | null> {
  try {
    try {
      const row = await db
        .prepare(
          `SELECT run_id, checked_at, trigger_source, overall_ok, duration_ms, components_json, integrity_json,
                  economic_json, e2e_json, e2e_aligned, e2e_reason_code, e2e_reason_detail, actionable_json, failures_json
           FROM health_check_runs
           ORDER BY checked_at DESC
           LIMIT 1`,
        )
        .first<HealthCheckRunRow>()
      return row ?? null
    } catch (error) {
      if (!isLegacySchemaError(error)) throw error
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
  } catch {
    return null
  }
}

/**
 * Returns recent health check runs, or [] if none or if migration 0019 not applied.
 */
export async function listHealthCheckRuns(db: D1Database, limit = 48): Promise<HealthCheckRunRow[]> {
  try {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
    try {
      const rows = await db
        .prepare(
          `SELECT run_id, checked_at, trigger_source, overall_ok, duration_ms, components_json, integrity_json,
                  economic_json, e2e_json, e2e_aligned, e2e_reason_code, e2e_reason_detail, actionable_json, failures_json
           FROM health_check_runs
           ORDER BY checked_at DESC
           LIMIT ?1`,
        )
        .bind(safeLimit)
        .all<HealthCheckRunRow>()
      return rows.results ?? []
    } catch (error) {
      if (!isLegacySchemaError(error)) throw error
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
    }
  } catch {
    return []
  }
}
