import { emitCanonicalHistoricalTombstone } from './canonical-feed'
import { datasetFromHistoricalTable, getAnalyticsDatasetConfigs } from './config'

function configForTable(tableName: string) {
  return getAnalyticsDatasetConfigs().find((config) => config.historicalTable === tableName) ?? null
}

export async function readHistoricalDeleteKeys(
  db: D1Database,
  tableName: string,
  whereClause?: string,
  binds: Array<string | number> = [],
): Promise<Array<Record<string, unknown>>> {
  const config = configForTable(tableName)
  if (!config) return []
  const sql = `SELECT ${config.canonicalKeyColumns.join(', ')} FROM ${tableName}${whereClause ? ` WHERE ${whereClause}` : ''}`
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return result.results ?? []
}

export async function emitHistoricalDeleteTombstones(
  db: D1Database,
  tableName: string,
  keys: Array<Record<string, unknown>>,
): Promise<number> {
  const dataset = datasetFromHistoricalTable(tableName)
  if (!dataset) return 0
  for (const key of keys) {
    await emitCanonicalHistoricalTombstone(
      db,
      dataset,
      key,
      typeof key.run_id === 'string' ? key.run_id : null,
      typeof key.collection_date === 'string' ? key.collection_date : null,
    )
  }
  return keys.length
}
