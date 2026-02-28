import type { DatasetKind, AnomalyReason } from '../../../../packages/shared/src'

export async function recordIngestAnomaly(
  db: D1Database,
  input: {
    fetchEventId?: number | null
    runId?: string | null
    lenderCode?: string | null
    dataset: DatasetKind
    productId?: string | null
    seriesKey?: string | null
    collectionDate?: string | null
    reason: AnomalyReason | string
    severity?: string | null
    candidateJson: string
    normalizedCandidateJson?: string | null
  },
): Promise<number | null> {
  const result = await db
    .prepare(
      `INSERT INTO ingest_anomalies (
         fetch_event_id, run_id, lender_code, dataset_kind, product_id, series_key, collection_date,
         reason, severity, candidate_json, normalized_candidate_json, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, CURRENT_TIMESTAMP)`,
    )
    .bind(
      input.fetchEventId ?? null,
      input.runId ?? null,
      input.lenderCode ?? null,
      input.dataset,
      input.productId ?? null,
      input.seriesKey ?? null,
      input.collectionDate ?? null,
      input.reason,
      input.severity ?? 'warn',
      input.candidateJson,
      input.normalizedCandidateJson ?? null,
    )
    .run()
  return Number(result.meta?.last_row_id || 0) || null
}
