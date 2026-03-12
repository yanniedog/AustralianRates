import type { DatasetKind } from '../../../../../packages/shared/src/index.js'
import { emitDownloadChange } from './change-feed'
import { getAnalyticsDatasetConfig } from './config'

export async function emitCanonicalHistoricalUpsert(
  db: D1Database,
  dataset: DatasetKind,
  entityKey: Record<string, unknown>,
  runId?: string | null,
  collectionDate?: string | null,
): Promise<void> {
  const config = getAnalyticsDatasetConfig(dataset)
  await emitDownloadChange(db, {
    stream: 'canonical',
    datasetKind: dataset,
    tableName: config.historicalTable,
    entityKey,
    op: 'upsert',
    runId: runId ?? null,
    collectionDate: collectionDate ?? null,
  })
}

export async function emitCanonicalHistoricalTombstone(
  db: D1Database,
  dataset: DatasetKind,
  entityKey: Record<string, unknown>,
  runId?: string | null,
  collectionDate?: string | null,
): Promise<void> {
  const config = getAnalyticsDatasetConfig(dataset)
  await emitDownloadChange(db, {
    stream: 'canonical',
    datasetKind: dataset,
    tableName: config.historicalTable,
    entityKey,
    op: 'tombstone',
    runId: runId ?? null,
    collectionDate: collectionDate ?? null,
  })
}
