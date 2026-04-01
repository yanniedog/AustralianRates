/**
 * Retention pruning for high-churn tables. Reduces storage and keeps queries fast.
 * Called after health check runs (scheduled and manual) so no separate cron is needed.
 * Log policy: all `global_log` levels older than 48 hours are removed (bounded table size).
 * A row cap deletes the oldest rows if the table still exceeds GLOBAL_LOG_MAX_ROWS after the time cut.
 */

const GLOBAL_LOG_RETENTION_HOURS = 48
/** After time-based prune, drop oldest rows so bursts cannot grow the table without bound. */
const GLOBAL_LOG_MAX_ROWS = 200_000
/**
 * Backend run-state tables stay short-lived; product provenance tables must remain long-lived.
 * Guardrail: do not reduce lineage retention or expand raw run-state pruning policy until
 * permanent historical_quality_daily evidence has been backfilled and validated.
 */
const BACKEND_RETENTION_DAYS = 30
const INGEST_ANOMALIES_RETENTION_DAYS = 1
const RUN_REPORTS_RETENTION_DAYS = BACKEND_RETENTION_DAYS
/**
 * Historical provenance is a first-class requirement. fetch_events/raw_objects provide the
 * chain from stored rows back to the captured payload, so pruning them aggressively creates
 * artificial historical lineage failures and hides when old data became unverifiable.
 */
const FETCH_EVENTS_RETENTION_DAYS = 3650
/**
 * Enforce missing/unresolved fetch-event lineage as a hard current-health failure only for rows
 * parsed after the long-retention provenance policy shipped on 2026-03-29.
 * Older unresolved rows remain visible as inherited historical provenance debt.
 */
const FETCH_EVENT_PROVENANCE_ENFORCEMENT_START = '2026-03-29T00:00:00.000Z'
/**
 * Grace window to prevent ingest/prune races:
 * fetch_events can be inserted shortly after raw_objects for the same payload.
 */
const RAW_OBJECT_ORPHAN_GRACE_DAYS = FETCH_EVENTS_RETENTION_DAYS + 2
/** Keep low-value operational churn on an aggressive window even after raw run-state was extended. */
const DOWNLOAD_CHANGE_FEED_RETENTION_DAYS = 1
const CLIENT_HISTORICAL_RETENTION_DAYS = 1
const HISTORICAL_PROVENANCE_RECOVERY_LOG_RETENTION_DAYS = 30
const REPLAY_QUEUE_TERMINAL_RETENTION_DAYS = 14

export {
  BACKEND_RETENTION_DAYS,
  FETCH_EVENTS_RETENTION_DAYS,
  FETCH_EVENT_PROVENANCE_ENFORCEMENT_START,
  RUN_REPORTS_RETENTION_DAYS,
}

async function tableHasRows(db: D1Database, tableName: string): Promise<boolean> {
  try {
    const exists = await db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM sqlite_master
         WHERE type = 'table' AND name = ?1`,
      )
      .bind(tableName)
      .first<{ n: number }>()
    if (!Number(exists?.n)) return false
    const rows = await db.prepare(`SELECT COUNT(*) AS n FROM ${tableName}`).first<{ n: number }>()
    return Number(rows?.n) > 0
  } catch {
    return false
  }
}

/**
 * Delete global_log rows older than GLOBAL_LOG_RETENTION_HOURS (all levels).
 * Then cap total row count at GLOBAL_LOG_MAX_ROWS (oldest first). No-op on error.
 */
export async function pruneGlobalLog(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(`DELETE FROM global_log WHERE ts < datetime('now', ?1)`)
      .bind(`-${GLOBAL_LOG_RETENTION_HOURS} hours`)
      .run()
  } catch {
    // Table may not exist (pre-0004) or schema may differ; ignore.
  }
  try {
    await db
      .prepare(
        `WITH ranked AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY ts DESC, id DESC) AS rn
           FROM global_log
         )
         DELETE FROM global_log
         WHERE id IN (SELECT id FROM ranked WHERE rn > ?1)`,
      )
      .bind(GLOBAL_LOG_MAX_ROWS)
      .run()
  } catch {
    // D1/SQLite without window support, or empty table; ignore.
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
 * Delete fetch_events rows older than FETCH_EVENTS_RETENTION_DAYS.
 * No-op on error. Keeps table bounded; admin remediation and CDR audit use recent lineage.
 * Historical rate rows may keep fetch_event_id pointing to pruned rows (lookup returns null).
 */
export async function pruneFetchEvents(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(
        `DELETE FROM fetch_events WHERE fetched_at < datetime('now', ?1)`,
      )
      .bind(`-${FETCH_EVENTS_RETENTION_DAYS} days`)
      .run()
  } catch {
    // ignore
  }
}

/**
 * Delete raw_objects rows whose content_hash is no longer referenced by any fetch_events row.
 * Run after pruneFetchEvents so we only keep raw_objects for the retained fetch_events window.
 * No-op on error.
 */
export async function pruneRawObjectsOrphans(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(
        `DELETE FROM raw_objects
         WHERE content_hash NOT IN (SELECT content_hash FROM fetch_events)
           AND (
             created_at IS NULL
             OR created_at < datetime('now', ?1)
           )`,
      )
      .bind(`-${RAW_OBJECT_ORPHAN_GRACE_DAYS} days`)
      .run()
  } catch {
    // ignore
  }
}

/**
 * Delete download_change_feed rows older than DOWNLOAD_CHANGE_FEED_RETENTION_DAYS.
 * Keeps admin download/change feed bounded; compact DB.
 */
export async function pruneDownloadChangeFeed(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(
        `DELETE FROM download_change_feed WHERE emitted_at < datetime('now', ?1)`,
      )
      .bind(`-${DOWNLOAD_CHANGE_FEED_RETENTION_DAYS} days`)
      .run()
  } catch {
    // ignore
  }
}

/**
 * Delete client_historical_runs (and CASCADE tasks/batches) older than CLIENT_HISTORICAL_RETENTION_DAYS.
 * Keeps historical pull orchestration data bounded; compact DB.
 */
export async function pruneClientHistoricalRuns(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(
        `DELETE FROM client_historical_runs WHERE created_at < datetime('now', ?1)`,
      )
      .bind(`-${CLIENT_HISTORICAL_RETENTION_DAYS} days`)
      .run()
  } catch {
    // ignore
  }
}

/**
 * Delete row-level provenance recovery churn after a summary record exists.
 * The summary table is retained long-term; this log is only for recent debugging.
 */
export async function pruneHistoricalProvenanceRecoveryLog(db: D1Database): Promise<void> {
  if (!(await tableHasRows(db, 'historical_provenance_recovery_runs'))) return
  try {
    await db
      .prepare(
        `DELETE FROM historical_provenance_recovery_log
         WHERE created_at < datetime('now', ?1)`,
      )
      .bind(`-${HISTORICAL_PROVENANCE_RECOVERY_LOG_RETENTION_DAYS} days`)
      .run()
  } catch {
    // ignore
  }
}

/**
 * Delete old replay queue terminal rows so current diagnostics and dispatch scans stay cheap.
 * Keep active queued/dispatching rows regardless of age; only remove succeeded/failed history.
 */
export async function pruneReplayQueueTerminalRows(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(
        `DELETE FROM ingest_replay_queue
         WHERE status IN ('succeeded', 'failed')
           AND updated_at < datetime('now', ?1)`,
      )
      .bind(`-${REPLAY_QUEUE_TERMINAL_RETENTION_DAYS} days`)
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
  await pruneFetchEvents(db)
  await pruneRawObjectsOrphans(db)
  await pruneDownloadChangeFeed(db)
  await pruneClientHistoricalRuns(db)
  await pruneHistoricalProvenanceRecoveryLog(db)
  await pruneReplayQueueTerminalRows(db)
}
