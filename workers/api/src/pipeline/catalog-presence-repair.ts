import { insertMissingProductCatalogFromRunSeenProducts } from '../db/catalog'

export type CatalogPresenceRepairResult = {
  inserted_product_catalog_rows: number
  rebuilt_product_presence_rows: number
  rebuilt_series_presence_rows: number
  updated_product_catalog_rows: number
  updated_series_catalog_rows: number
  updated_latest_rows: {
    home_loans: number
    savings: number
    term_deposits: number
  }
}

async function rebuildProductPresenceStatus(db: D1Database): Promise<number> {
  await db.prepare(`DELETE FROM product_presence_status`).run()
  const result = await db
    .prepare(
      `INSERT INTO product_presence_status (
         section,
         bank_name,
         product_id,
         is_removed,
         removed_at,
         last_seen_collection_date,
         last_seen_at,
         last_seen_run_id
       )
       SELECT
         dataset_kind,
         bank_name,
         product_id,
         COALESCE(is_removed, 0),
         removed_at,
         last_seen_collection_date,
         COALESCE(last_seen_at, CURRENT_TIMESTAMP),
         last_successful_run_id
       FROM product_catalog`,
    )
    .run()

  return Number(result.meta?.changes ?? 0)
}

async function rebuildSeriesPresenceStatus(db: D1Database): Promise<number> {
  await db.prepare(`DELETE FROM series_presence_status`).run()
  const result = await db
    .prepare(
      `INSERT INTO series_presence_status (
         dataset_kind,
         series_key,
         bank_name,
         product_id,
         product_code,
         is_removed,
         removed_at,
         last_seen_collection_date,
         last_seen_at,
         last_seen_run_id
       )
       SELECT
         dataset_kind,
         series_key,
         bank_name,
         product_id,
         product_code,
         COALESCE(is_removed, 0),
         removed_at,
         last_seen_collection_date,
         COALESCE(last_seen_at, CURRENT_TIMESTAMP),
         last_successful_run_id
       FROM series_catalog`,
    )
    .run()

  return Number(result.meta?.changes ?? 0)
}

async function reapplyCatalogRemovalState(db: D1Database): Promise<{ productCatalog: number; seriesCatalog: number }> {
  const productCatalog = await db
    .prepare(
      `UPDATE product_catalog
       SET is_removed = COALESCE((
             SELECT pps.is_removed
             FROM product_presence_status pps
             WHERE pps.section = product_catalog.dataset_kind
               AND pps.bank_name = product_catalog.bank_name
               AND pps.product_id = product_catalog.product_id
           ), 0),
           removed_at = (
             SELECT pps.removed_at
             FROM product_presence_status pps
             WHERE pps.section = product_catalog.dataset_kind
               AND pps.bank_name = product_catalog.bank_name
               AND pps.product_id = product_catalog.product_id
           )`,
    )
    .run()
  const seriesCatalog = await db
    .prepare(
      `UPDATE series_catalog
       SET is_removed = COALESCE((
             SELECT sps.is_removed
             FROM series_presence_status sps
             WHERE sps.series_key = series_catalog.series_key
           ), 0),
           removed_at = (
             SELECT sps.removed_at
             FROM series_presence_status sps
             WHERE sps.series_key = series_catalog.series_key
           )`,
    )
    .run()

  return {
    productCatalog: Number(productCatalog.meta?.changes ?? 0),
    seriesCatalog: Number(seriesCatalog.meta?.changes ?? 0),
  }
}

async function reapplyLatestRemovalState(db: D1Database): Promise<CatalogPresenceRepairResult['updated_latest_rows']> {
  const homeLoans = await db
    .prepare(
      `UPDATE latest_home_loan_series
       SET is_removed = COALESCE((
             SELECT sps.is_removed
             FROM series_presence_status sps
             WHERE sps.series_key = latest_home_loan_series.series_key
           ), 0),
           removed_at = (
             SELECT sps.removed_at
             FROM series_presence_status sps
             WHERE sps.series_key = latest_home_loan_series.series_key
           )`,
    )
    .run()
  const savings = await db
    .prepare(
      `UPDATE latest_savings_series
       SET is_removed = COALESCE((
             SELECT sps.is_removed
             FROM series_presence_status sps
             WHERE sps.series_key = latest_savings_series.series_key
           ), 0),
           removed_at = (
             SELECT sps.removed_at
             FROM series_presence_status sps
             WHERE sps.series_key = latest_savings_series.series_key
           )`,
    )
    .run()
  const termDeposits = await db
    .prepare(
      `UPDATE latest_td_series
       SET is_removed = COALESCE((
             SELECT sps.is_removed
             FROM series_presence_status sps
             WHERE sps.series_key = latest_td_series.series_key
           ), 0),
           removed_at = (
             SELECT sps.removed_at
             FROM series_presence_status sps
             WHERE sps.series_key = latest_td_series.series_key
           )`,
    )
    .run()

  return {
    home_loans: Number(homeLoans.meta?.changes ?? 0),
    savings: Number(savings.meta?.changes ?? 0),
    term_deposits: Number(termDeposits.meta?.changes ?? 0),
  }
}

export async function repairCatalogAndPresence(db: D1Database): Promise<CatalogPresenceRepairResult> {
  const insertedProductCatalogRows = await insertMissingProductCatalogFromRunSeenProducts(db)
  const rebuiltProductPresenceRows = await rebuildProductPresenceStatus(db)
  const rebuiltSeriesPresenceRows = await rebuildSeriesPresenceStatus(db)
  const reappliedCatalog = await reapplyCatalogRemovalState(db)
  const updatedLatestRows = await reapplyLatestRemovalState(db)

  return {
    inserted_product_catalog_rows: insertedProductCatalogRows,
    rebuilt_product_presence_rows: rebuiltProductPresenceRows,
    rebuilt_series_presence_rows: rebuiltSeriesPresenceRows,
    updated_product_catalog_rows: reappliedCatalog.productCatalog,
    updated_series_catalog_rows: reappliedCatalog.seriesCatalog,
    updated_latest_rows: updatedLatestRows,
  }
}
