import type { DatasetKind } from '../../../../packages/shared/src'
import { markMissingProductsRemoved, markProductsSeen } from './product-status'
import { markMissingSeriesRemoved } from './series-status'

function sectionForDataset(dataset: DatasetKind): 'home_loans' | 'savings' | 'term_deposits' {
  return dataset
}

export async function finalizePresenceForRun(
  db: D1Database,
  input: { runId: string; lenderCode: string; dataset: DatasetKind; bankName: string; collectionDate: string },
): Promise<{
  seenProducts: number
  removedProducts: number
  removedSeries: number
}> {
  const seenProducts = await db
    .prepare(
      `SELECT DISTINCT product_id, product_code
       FROM run_seen_products
       WHERE run_id = ?1
         AND lender_code = ?2
         AND dataset_kind = ?3
         AND bank_name = ?4`,
    )
    .bind(input.runId, input.lenderCode, input.dataset, input.bankName)
    .all<{ product_id: string; product_code: string }>()

  const seenSeries = await db
    .prepare(
      `SELECT DISTINCT series_key
       FROM run_seen_series
       WHERE run_id = ?1
         AND lender_code = ?2
         AND dataset_kind = ?3
         AND bank_name = ?4`,
    )
    .bind(input.runId, input.lenderCode, input.dataset, input.bankName)
    .all<{ series_key: string }>()

  const productIds = (seenProducts.results ?? []).map((row) => String(row.product_id || '').trim()).filter(Boolean)
  const seriesKeys = (seenSeries.results ?? []).map((row) => String(row.series_key || '').trim()).filter(Boolean)

  const seenTouched = await markProductsSeen(db, {
    section: sectionForDataset(input.dataset),
    bankName: input.bankName,
    productIds,
    collectionDate: input.collectionDate,
    runId: input.runId,
  })
  const removedProducts = await markMissingProductsRemoved(db, {
    section: sectionForDataset(input.dataset),
    bankName: input.bankName,
    activeProductIds: productIds,
  })
  const removedSeries = await markMissingSeriesRemoved(db, {
    dataset: input.dataset,
    bankName: input.bankName,
    activeSeriesKeys: seriesKeys,
  })

  await db
    .prepare(
      `UPDATE product_catalog
       SET is_removed = CASE
             WHEN EXISTS (
               SELECT 1
               FROM product_presence_status pps
               WHERE pps.section = dataset_kind
                 AND pps.bank_name = product_catalog.bank_name
                 AND pps.product_id = product_catalog.product_id
                 AND COALESCE(pps.is_removed, 0) = 1
             ) THEN 1 ELSE 0 END,
           removed_at = (
             SELECT pps.removed_at
             FROM product_presence_status pps
             WHERE pps.section = dataset_kind
               AND pps.bank_name = product_catalog.bank_name
               AND pps.product_id = product_catalog.product_id
             LIMIT 1
           )
       WHERE dataset_kind = ?1
         AND bank_name = ?2`,
    )
    .bind(input.dataset, input.bankName)
    .run()

  await db
    .prepare(
      `UPDATE series_catalog
       SET is_removed = CASE
             WHEN EXISTS (
               SELECT 1
               FROM series_presence_status sps
               WHERE sps.series_key = series_catalog.series_key
                 AND COALESCE(sps.is_removed, 0) = 1
             ) THEN 1 ELSE 0 END,
           removed_at = (
             SELECT sps.removed_at
             FROM series_presence_status sps
             WHERE sps.series_key = series_catalog.series_key
             LIMIT 1
           )
       WHERE dataset_kind = ?1
         AND bank_name = ?2`,
    )
    .bind(input.dataset, input.bankName)
    .run()

  const latestTable =
    input.dataset === 'home_loans'
      ? 'latest_home_loan_series'
      : input.dataset === 'savings'
        ? 'latest_savings_series'
        : 'latest_td_series'

  await db
    .prepare(
      `UPDATE ${latestTable}
       SET is_removed = COALESCE((
             SELECT sps.is_removed
             FROM series_presence_status sps
             WHERE sps.series_key = ${latestTable}.series_key
           ), 0),
           removed_at = (
             SELECT sps.removed_at
             FROM series_presence_status sps
             WHERE sps.series_key = ${latestTable}.series_key
           )
       WHERE bank_name = ?1`,
    )
    .bind(input.bankName)
    .run()

  return {
    seenProducts: seenTouched,
    removedProducts,
    removedSeries,
  }
}
