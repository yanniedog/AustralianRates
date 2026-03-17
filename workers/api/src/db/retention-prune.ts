/**
 * Retention pruning for high-churn tables. Reduces storage and keeps queries fast.
 * Called after health check runs (scheduled and manual) so no separate cron is needed.
 * Log policy: error/warn 14 days; debug/info 48 hours (see logging-expert skill and retention-and-api.md).
 */

const GLOBAL_LOG_ERROR_WARN_RETENTION_DAYS = 14
const GLOBAL_LOG_INFO_DEBUG_RETENTION_HOURS = 48
const INGEST_ANOMALIES_RETENTION_DAYS = 90
/** Run reports and related run-scoped rows older than this are pruned (reduces runs_with_no_outputs and table growth). */
const RUN_REPORTS_RETENTION_DAYS = 180

/**
 * Delete global_log rows by level: debug/info older than 48h; warn/error older than 14d.
 * No-op on error (e.g. table missing). Keeps error stream long-lived and info stream compact.
 */
export async function pruneGlobalLog(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(
        `DELETE FROM global_log WHERE level IN ('debug','info') AND ts < datetime('now', ?1)`,
      )
      .bind(`-${GLOBAL_LOG_INFO_DEBUG_RETENTION_HOURS} hours`)
      .run()
  } catch {
    // Table may not exist (pre-0004) or schema may differ; ignore.
  }
  try {
    await db
      .prepare(
        `DELETE FROM global_log WHERE level IN ('warn','error') AND ts < datetime('now', ?1)`,
      )
      .bind(`-${GLOBAL_LOG_ERROR_WARN_RETENTION_DAYS} days`)
      .run()
  } catch {
    // Table may not exist or schema may differ; ignore.
  }
}

/**
 * Delete ingest_anomalies rows older than INGEST_ANOMALIES_RETENTION_DAYS.
 * No-op on error. Keeps anomaly table bounded; recent anomalies remain for diagnostics.
 */
export async function pruneIngestAnomalies(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(`DELETE FROM ingest_anomalies WHERE created_at < datetime('now', ?1)`)
      .bind(`-${INGEST_ANOMALIES_RETENTION_DAYS} days`)
      .run()
  } catch {
    // Table may not exist or schema may differ; ignore.
  }
}

/**
 * Delete run_reports and run-scoped dependent rows older than RUN_REPORTS_RETENTION_DAYS.
 * Order: run_seen_products, run_seen_series, lender_dataset_runs, run_reports.
 * No-op on error (e.g. table missing). Bounds run_reports growth and reduces runs_with_no_outputs over time.
 */
export async function pruneRunReports(db: D1Database): Promise<void> {
  const cutoff = `-${RUN_REPORTS_RETENTION_DAYS} days`
  try {
    await db
      .prepare(
        `DELETE FROM run_seen_products WHERE run_id IN (SELECT run_id FROM run_reports WHERE started_at < datetime('now', ?1))`,
      )
      .bind(cutoff)
      .run()
  } catch {
    // ignore
  }
  try {
    await db
      .prepare(
        `DELETE FROM run_seen_series WHERE run_id IN (SELECT run_id FROM run_reports WHERE started_at < datetime('now', ?1))`,
      )
      .bind(cutoff)
      .run()
  } catch {
    // ignore
  }
  try {
    await db
      .prepare(
        `DELETE FROM lender_dataset_runs WHERE run_id IN (SELECT run_id FROM run_reports WHERE started_at < datetime('now', ?1))`,
      )
      .bind(cutoff)
      .run()
  } catch {
    // ignore
  }
  try {
    await db
      .prepare(`DELETE FROM run_reports WHERE started_at < datetime('now', ?1)`)
      .bind(cutoff)
      .run()
  } catch {
    // ignore
  }
}

/**
 * Delete raw_payloads rows that have no matching raw_objects row (legacy orphan backlog).
 * No-op on error. Reduces storage and dump size; safe because pipeline uses fetch_events + raw_objects.
 */
export async function pruneRawPayloadsOrphans(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(
        `DELETE FROM raw_payloads WHERE content_hash NOT IN (SELECT content_hash FROM raw_objects)`,
      )
      .run()
  } catch {
    // ignore
  }
}

/**
 * Run all retention prunes. Safe to call from any context; failures are swallowed.
 */
export async function runRetentionPrunes(db: D1Database): Promise<void> {
  await pruneGlobalLog(db)
  await pruneIngestAnomalies(db)
  await pruneRunReports(db)
  await pruneRawPayloadsOrphans(db)
}
