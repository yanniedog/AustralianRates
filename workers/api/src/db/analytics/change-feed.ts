import { stableStringify } from '../../utils/hash'

export type DownloadChangeStream = 'canonical' | 'optimized' | 'operational'
export type DownloadChangeOp = 'upsert' | 'delete' | 'tombstone'

type DatasetKind = 'home_loans' | 'savings' | 'term_deposits'

export type DownloadChangeRecord = {
  stream: DownloadChangeStream
  datasetKind?: DatasetKind | null
  tableName: string
  entityKey: Record<string, unknown>
  op: DownloadChangeOp
  runId?: string | null
  collectionDate?: string | null
}

export async function emitDownloadChange(db: D1Database, input: DownloadChangeRecord): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO download_change_feed (
         stream, dataset_kind, table_name, entity_key_json, op, run_id, collection_date
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      input.stream,
      input.datasetKind ?? null,
      input.tableName,
      stableStringify(input.entityKey),
      input.op,
      input.runId ?? null,
      input.collectionDate ?? null,
    )
    .run()

  return Number(result.meta?.last_row_id ?? 0)
}

export async function emitDownloadChanges(db: D1Database, inputs: DownloadChangeRecord[]): Promise<number[]> {
  const out: number[] = []
  for (const input of inputs) {
    out.push(await emitDownloadChange(db, input))
  }
  return out
}
