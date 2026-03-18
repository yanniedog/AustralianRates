export type IntegrityAuditRunRow = {
  run_id: string
  checked_at: string
  trigger_source: 'scheduled' | 'manual'
  overall_ok: number
  duration_ms: number
  status: 'green' | 'amber' | 'red'
  summary_json: string
  findings_json: string
}

export type InsertIntegrityAuditRunInput = {
  runId: string
  checkedAt: string
  triggerSource: 'scheduled' | 'manual'
  overallOk: boolean
  durationMs: number
  status: 'green' | 'amber' | 'red'
  summaryJson: string
  findingsJson: string
}

const RETENTION_DAYS = 3

export async function pruneIntegrityAuditRuns(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(`DELETE FROM integrity_audit_runs WHERE checked_at < datetime('now', ?1)`)
      .bind(`-${RETENTION_DAYS} days`)
      .run()
  } catch {
    // Table may not exist; ignore.
  }
}

function isNoSuchTableIntegrityRuns(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /no such table/i.test(msg) && msg.includes('integrity_audit_runs')
}

/** Insert an integrity audit run. No-op if table does not exist (migration 0029 not applied). */
export async function insertIntegrityAuditRun(
  db: D1Database,
  input: InsertIntegrityAuditRunInput,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO integrity_audit_runs (
           run_id, checked_at, trigger_source, overall_ok, duration_ms, status, summary_json, findings_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        input.runId,
        input.checkedAt,
        input.triggerSource,
        input.overallOk ? 1 : 0,
        input.durationMs,
        input.status,
        input.summaryJson,
        input.findingsJson,
      )
      .run()
    await pruneIntegrityAuditRuns(db)
  } catch (e) {
    if (isNoSuchTableIntegrityRuns(e)) return
    throw e
  }
}

export async function getLatestIntegrityAuditRun(
  db: D1Database,
): Promise<IntegrityAuditRunRow | null> {
  try {
    const row = await db
      .prepare(
        `SELECT run_id, checked_at, trigger_source, overall_ok, duration_ms, status, summary_json, findings_json
         FROM integrity_audit_runs
         ORDER BY checked_at DESC
         LIMIT 1`,
      )
      .first<IntegrityAuditRunRow>()
    return row ?? null
  } catch {
    return null
  }
}

export async function listIntegrityAuditRuns(
  db: D1Database,
  limit = 50,
): Promise<IntegrityAuditRunRow[]> {
  try {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)))
    const rows = await db
      .prepare(
        `SELECT run_id, checked_at, trigger_source, overall_ok, duration_ms, status, summary_json, findings_json
         FROM integrity_audit_runs
         ORDER BY checked_at DESC
         LIMIT ?1`,
      )
      .bind(safeLimit)
      .all<IntegrityAuditRunRow>()
    return rows.results ?? []
  } catch {
    return []
  }
}
