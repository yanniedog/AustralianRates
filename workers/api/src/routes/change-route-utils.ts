import type { DatasetKind } from '../../../../packages/shared/src/index.js'
import { queryAnalyticsRateChanges } from '../db/analytics/change-reads'
import { analyticsProjectionReady } from '../db/analytics/readiness'
import { log } from '../utils/logger'

type ChangeQueryResult = {
  total: number
  rows: Array<Record<string, unknown>>
}

export async function queryChangesWithFallback(
  canonicalDb: D1Database,
  analyticsDb: D1Database,
  dataset: DatasetKind,
  input: { limit?: number; offset?: number },
  queryLegacyChanges: (
    db: D1Database,
    input: { limit?: number; offset?: number; maxLimit?: number },
  ) => Promise<ChangeQueryResult>,
): Promise<{ source: 'optimized' | 'legacy'; result: ChangeQueryResult }> {
  const ready = await analyticsProjectionReady(analyticsDb, dataset)
  if (ready) {
    try {
      return {
        source: 'optimized',
        result: await queryAnalyticsRateChanges(analyticsDb, dataset, input),
      }
    } catch (error) {
      const message = (error as Error)?.message || String(error)
      const isSchemaMismatch = /no such column:.*\.(security_purpose|repayment_type|rate_structure|lvr_tier|feature_set)/i.test(message)
      if (isSchemaMismatch) {
        log.warn('public', 'analytics_change_query_schema_mismatch', {
          code: 'analytics_change_query_schema_mismatch',
          context: JSON.stringify({ dataset, message }),
        })
      } else {
        log.error('public', 'analytics_change_query_failed', {
          code: 'analytics_change_query_failed',
          context: JSON.stringify({ dataset, message }),
        })
      }
    }
  }

  return {
    source: 'legacy',
    result: await queryLegacyChanges(canonicalDb, { ...input, maxLimit: 1000 }),
  }
}

export async function queryIntegritySafely<T>(
  dataset: DatasetKind,
  queryIntegrity: () => Promise<T>,
): Promise<T | null> {
  try {
    return await queryIntegrity()
  } catch (error) {
    log.error('public', 'rate_change_integrity_failed', {
      context: JSON.stringify({
        dataset,
        message: (error as Error)?.message || String(error),
      }),
    })
    return null
  }
}
