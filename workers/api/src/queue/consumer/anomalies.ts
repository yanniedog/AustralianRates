import { recordIngestAnomaly } from '../../db/ingest-anomalies'
import type { DatasetKind } from '../../../../../packages/shared/src'

export async function recordDroppedAnomalies<T extends { productId: string; collectionDate: string }>(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    dataset: DatasetKind
    fetchEventId?: number | null
    dropped: Array<{ reason: string; productId: string; row: T }>
  },
): Promise<void> {
  for (const item of input.dropped) {
    await recordIngestAnomaly(db, {
      fetchEventId: input.fetchEventId ?? null,
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: input.dataset,
      productId: item.productId,
      collectionDate: item.row.collectionDate,
      reason: item.reason,
      severity: 'warn',
      candidateJson: JSON.stringify(item.row),
      normalizedCandidateJson: JSON.stringify(item.row),
      seriesKey: null,
    })
  }
}
