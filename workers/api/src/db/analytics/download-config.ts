import type { DatasetKind } from '../../../../../packages/shared/src/index.js'
import type { AdminDownloadScope, AdminDownloadStream } from '../admin-download-jobs'
import { getAnalyticsDatasetConfig, getAnalyticsDatasetConfigs } from './config'

export function streamScopeDatasets(scope: AdminDownloadScope): DatasetKind[] {
  if (scope === 'all') return ['home_loans', 'savings', 'term_deposits']
  return [scope]
}

export function streamTables(stream: AdminDownloadStream, scope: AdminDownloadScope): string[] {
  if (stream === 'operational') return []
  const datasets = streamScopeDatasets(scope)
  const tables: string[] = []
  for (const dataset of datasets) {
    const config = getAnalyticsDatasetConfig(dataset)
    if (stream === 'canonical') {
      tables.push(config.historicalTable)
    } else {
      tables.push(config.eventsTable, config.intervalsTable)
    }
  }
  return tables
}

export function keyColumnsForTable(tableName: string): string[] {
  for (const config of getAnalyticsDatasetConfigs()) {
    if (config.historicalTable === tableName) return config.canonicalKeyColumns
    if (config.eventsTable === tableName) {
      return ['series_key', 'collection_date', 'state_hash', 'event_type', 'run_source']
    }
    if (config.intervalsTable === tableName) {
      return ['series_key', 'effective_from_collection_date']
    }
  }
  if (tableName === 'fetch_events') return ['id']
  if (tableName === 'raw_objects') return ['content_hash']
  if (tableName === 'raw_payloads') return ['id']
  if (tableName === 'download_change_feed') return ['cursor_id']
  return []
}

export function tableDataset(tableName: string): DatasetKind | null {
  for (const config of getAnalyticsDatasetConfigs()) {
    if (
      config.historicalTable === tableName ||
      config.eventsTable === tableName ||
      config.intervalsTable === tableName ||
      config.latestTable === tableName
    ) {
      return config.dataset
    }
  }
  return null
}
