import type { DatasetKind } from '../../../../../packages/shared/src/index.js'
import { getAnalyticsDatasetConfig } from './config'

export async function analyticsProjectionReady(
  db: D1Database,
  dataset: DatasetKind,
): Promise<boolean> {
  const config = getAnalyticsDatasetConfig(dataset)
  try {
    const state = await db
      .prepare(
        `SELECT status
         FROM analytics_projection_state
         WHERE state_key = ?1
         LIMIT 1`,
      )
      .bind(`projection_rebuild:${dataset}`)
      .first<{ status: string }>()
    if (String(state?.status || '') !== 'completed') {
      return false
    }
    const row = await db
      .prepare(`SELECT COUNT(*) AS total FROM ${config.eventsTable}`)
      .first<{ total: number }>()
    return Number(row?.total ?? 0) > 0
  } catch {
    return false
  }
}
