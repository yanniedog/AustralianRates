import type { DatasetKind } from '../../../../packages/shared/src'

type CommonObserveInput = {
  dataset: DatasetKind
  bankName: string
  productId: string
  productCode: string
  productName: string
  collectionDate: string
  runId?: string | null
  sourceUrl?: string | null
  productUrl?: string | null
  publishedAt?: string | null
}

export async function upsertProductCatalog(db: D1Database, input: CommonObserveInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO product_catalog (
         dataset_kind, bank_name, product_id, product_code,
         latest_product_name, latest_source_url, latest_product_url, latest_published_at,
         first_seen_collection_date, last_seen_collection_date,
         first_seen_at, last_seen_at, is_removed, removed_at, last_successful_run_id
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, NULL, ?10)
       ON CONFLICT(dataset_kind, bank_name, product_id) DO UPDATE SET
         product_code = excluded.product_code,
         latest_product_name = excluded.latest_product_name,
         latest_source_url = excluded.latest_source_url,
         latest_product_url = excluded.latest_product_url,
         latest_published_at = excluded.latest_published_at,
         last_seen_collection_date = excluded.last_seen_collection_date,
         last_seen_at = CURRENT_TIMESTAMP,
         is_removed = 0,
         removed_at = NULL,
         last_successful_run_id = excluded.last_successful_run_id`,
    )
    .bind(
      input.dataset,
      input.bankName,
      input.productId,
      input.productCode,
      input.productName,
      input.sourceUrl ?? null,
      input.productUrl ?? null,
      input.publishedAt ?? null,
      input.collectionDate,
      input.runId ?? null,
    )
    .run()
}

export async function upsertSeriesCatalog(
  db: D1Database,
  input: CommonObserveInput & {
    seriesKey: string
    rawDimensionsJson: string
    securityPurpose?: string | null
    repaymentType?: string | null
    lvrTier?: string | null
    rateStructure?: string | null
    accountType?: string | null
    rateType?: string | null
    depositTier?: string | null
    termMonths?: number | null
    interestPayment?: string | null
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO series_catalog (
         dataset_kind, series_key, bank_name, product_id, product_code, product_name,
         security_purpose, repayment_type, lvr_tier, rate_structure,
         account_type, rate_type, deposit_tier, term_months, interest_payment,
         raw_dimensions_json, latest_source_url, latest_product_url, latest_published_at,
         first_seen_collection_date, last_seen_collection_date,
         first_seen_at, last_seen_at, is_removed, removed_at, last_successful_run_id
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6,
         ?7, ?8, ?9, ?10,
         ?11, ?12, ?13, ?14, ?15,
         ?16, ?17, ?18, ?19,
         ?20, ?20,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, NULL, ?21
       )
       ON CONFLICT(series_key) DO UPDATE SET
         product_code = excluded.product_code,
         product_name = excluded.product_name,
         security_purpose = excluded.security_purpose,
         repayment_type = excluded.repayment_type,
         lvr_tier = excluded.lvr_tier,
         rate_structure = excluded.rate_structure,
         account_type = excluded.account_type,
         rate_type = excluded.rate_type,
         deposit_tier = excluded.deposit_tier,
         term_months = excluded.term_months,
         interest_payment = excluded.interest_payment,
         raw_dimensions_json = excluded.raw_dimensions_json,
         latest_source_url = excluded.latest_source_url,
         latest_product_url = excluded.latest_product_url,
         latest_published_at = excluded.latest_published_at,
         last_seen_collection_date = excluded.last_seen_collection_date,
         last_seen_at = CURRENT_TIMESTAMP,
         is_removed = 0,
         removed_at = NULL,
         last_successful_run_id = excluded.last_successful_run_id`,
    )
    .bind(
      input.dataset,
      input.seriesKey,
      input.bankName,
      input.productId,
      input.productCode,
      input.productName,
      input.securityPurpose ?? null,
      input.repaymentType ?? null,
      input.lvrTier ?? null,
      input.rateStructure ?? null,
      input.accountType ?? null,
      input.rateType ?? null,
      input.depositTier ?? null,
      input.termMonths ?? null,
      input.interestPayment ?? null,
      input.rawDimensionsJson,
      input.sourceUrl ?? null,
      input.productUrl ?? null,
      input.publishedAt ?? null,
      input.collectionDate,
      input.runId ?? null,
    )
    .run()
}

export async function markRunSeenProduct(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    dataset: DatasetKind
    bankName: string
    productId: string
    productCode: string
    collectionDate: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO run_seen_products (
         run_id, lender_code, dataset_kind, bank_name, product_id, product_code, collection_date, seen_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
       ON CONFLICT(run_id, lender_code, dataset_kind, bank_name, product_id) DO UPDATE SET
         product_code = excluded.product_code,
         collection_date = excluded.collection_date,
         seen_at = CURRENT_TIMESTAMP`,
    )
    .bind(input.runId, input.lenderCode, input.dataset, input.bankName, input.productId, input.productCode, input.collectionDate)
    .run()
}

export async function markRunSeenSeries(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    dataset: DatasetKind
    seriesKey: string
    bankName: string
    productId: string
    productCode: string
    collectionDate: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO run_seen_series (
         run_id, lender_code, dataset_kind, series_key, bank_name, product_id, product_code, collection_date, seen_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)
       ON CONFLICT(run_id, lender_code, dataset_kind, series_key) DO UPDATE SET
         product_code = excluded.product_code,
         collection_date = excluded.collection_date,
         seen_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      input.runId,
      input.lenderCode,
      input.dataset,
      input.seriesKey,
      input.bankName,
      input.productId,
      input.productCode,
      input.collectionDate,
    )
    .run()
}

export async function insertMissingProductCatalogFromRunSeenProducts(
  db: D1Database,
  input?: {
    runId?: string
    lenderCode?: string
    dataset?: DatasetKind
    bankName?: string
  },
): Promise<number> {
  const where: string[] = []
  const binds: Array<string> = []

  if (input?.runId) {
    where.push(`rsp.run_id = ?${binds.length + 1}`)
    binds.push(input.runId)
  }
  if (input?.lenderCode) {
    where.push(`rsp.lender_code = ?${binds.length + 1}`)
    binds.push(input.lenderCode)
  }
  if (input?.dataset) {
    where.push(`rsp.dataset_kind = ?${binds.length + 1}`)
    binds.push(input.dataset)
  }
  if (input?.bankName) {
    where.push(`rsp.bank_name = ?${binds.length + 1}`)
    binds.push(input.bankName)
  }

  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO product_catalog (
         dataset_kind,
         bank_name,
         product_id,
         product_code,
         latest_product_name,
         latest_source_url,
         latest_product_url,
         latest_published_at,
         first_seen_collection_date,
         last_seen_collection_date,
         first_seen_at,
         last_seen_at,
         is_removed,
         removed_at,
         last_successful_run_id
       )
       SELECT
         rsp.dataset_kind,
         rsp.bank_name,
         rsp.product_id,
         MAX(rsp.product_code) AS product_code,
         MAX(sc.product_name) AS latest_product_name,
         MAX(sc.latest_source_url) AS latest_source_url,
         MAX(sc.latest_product_url) AS latest_product_url,
         MAX(sc.latest_published_at) AS latest_published_at,
         MIN(rsp.collection_date) AS first_seen_collection_date,
         MAX(rsp.collection_date) AS last_seen_collection_date,
         MIN(rsp.seen_at) AS first_seen_at,
         MAX(rsp.seen_at) AS last_seen_at,
         COALESCE(MAX(pps.is_removed), 0) AS is_removed,
         MAX(pps.removed_at) AS removed_at,
         MAX(rsp.run_id) AS last_successful_run_id
       FROM run_seen_products rsp
       LEFT JOIN series_catalog sc
         ON sc.dataset_kind = rsp.dataset_kind
        AND sc.bank_name = rsp.bank_name
        AND sc.product_id = rsp.product_id
       LEFT JOIN product_presence_status pps
         ON pps.section = rsp.dataset_kind
        AND pps.bank_name = rsp.bank_name
        AND pps.product_id = rsp.product_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       GROUP BY rsp.dataset_kind, rsp.bank_name, rsp.product_id`,
    )
    .bind(...binds)
    .run()

  return Number(result.meta?.changes ?? 0)
}
