/**
 * Retention pruning for high-churn tables. Reduces storage and keeps queries fast.
 * Called after health check runs (scheduled and manual) so no separate cron is needed.
 */

const GLOBAL_LOG_RETENTION_DAYS = 30
const INGEST_ANOMALIES_RETENTION_DAYS = 90

/**
 * Delete global_log rows older than GLOBAL_LOG_RETENTION_DAYS.
 * No-op on error (e.g. table missing). Keeps log table bounded for storage and COUNT/ORDER BY performance.
 */
export async function pruneGlobalLog(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(`DELETE FROM global_log WHERE ts < datetime('now', ?1)`)
      .bind(`-${GLOBAL_LOG_RETENTION_DAYS} days`)
      .run()
  } catch {
    // Table may not exist (pre-0004) or schema may differ; ignore.
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
 * Run all retention prunes. Safe to call from any context; failures are swallowed.
 */
export async function runRetentionPrunes(db: D1Database): Promise<void> {
  await pruneGlobalLog(db)
  await pruneIngestAnomalies(db)
}
