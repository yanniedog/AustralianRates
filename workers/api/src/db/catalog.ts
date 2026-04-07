import type { DatasetKind } from '../../../../packages/shared/src'

function chunk<T>(rows: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size))
  }
  return output
}

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
         product_code = CASE
           WHEN excluded.last_seen_collection_date >= product_catalog.last_seen_collection_date
           THEN excluded.product_code
           ELSE product_catalog.product_code
         END,
         latest_product_name = CASE
           WHEN excluded.last_seen_collection_date >= product_catalog.last_seen_collection_date
           THEN excluded.latest_product_name
           ELSE product_catalog.latest_product_name
         END,
         latest_source_url = CASE
           WHEN excluded.last_seen_collection_date >= product_catalog.last_seen_collection_date
           THEN excluded.latest_source_url
           ELSE product_catalog.latest_source_url
         END,
         latest_product_url = CASE
           WHEN excluded.last_seen_collection_date >= product_catalog.last_seen_collection_date
           THEN excluded.latest_product_url
           ELSE product_catalog.latest_product_url
         END,
         latest_published_at = CASE
           WHEN excluded.last_seen_collection_date >= product_catalog.last_seen_collection_date
           THEN excluded.latest_published_at
           ELSE product_catalog.latest_published_at
         END,
         first_seen_collection_date = CASE
           WHEN excluded.first_seen_collection_date < product_catalog.first_seen_collection_date
           THEN excluded.first_seen_collection_date
           ELSE product_catalog.first_seen_collection_date
         END,
         last_seen_collection_date = CASE
           WHEN excluded.last_seen_collection_date >= product_catalog.last_seen_collection_date
           THEN excluded.last_seen_collection_date
           ELSE product_catalog.last_seen_collection_date
         END,
         last_seen_at = CURRENT_TIMESTAMP,
         is_removed = CASE
           WHEN excluded.last_seen_collection_date >= product_catalog.last_seen_collection_date
           THEN 0
           ELSE product_catalog.is_removed
         END,
         removed_at = CASE
           WHEN excluded.last_seen_collection_date >= product_catalog.last_seen_collection_date
           THEN NULL
           ELSE product_catalog.removed_at
         END,
         last_successful_run_id = CASE
           WHEN excluded.last_seen_collection_date >= product_catalog.last_seen_collection_date
           THEN excluded.last_successful_run_id
           ELSE product_catalog.last_successful_run_id
         END`,
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
         product_code = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.product_code
           ELSE series_catalog.product_code
         END,
         product_name = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.product_name
           ELSE series_catalog.product_name
         END,
         security_purpose = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.security_purpose
           ELSE series_catalog.security_purpose
         END,
         repayment_type = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.repayment_type
           ELSE series_catalog.repayment_type
         END,
         lvr_tier = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.lvr_tier
           ELSE series_catalog.lvr_tier
         END,
         rate_structure = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.rate_structure
           ELSE series_catalog.rate_structure
         END,
         account_type = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.account_type
           ELSE series_catalog.account_type
         END,
         rate_type = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.rate_type
           ELSE series_catalog.rate_type
         END,
         deposit_tier = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.deposit_tier
           ELSE series_catalog.deposit_tier
         END,
         term_months = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.term_months
           ELSE series_catalog.term_months
         END,
         interest_payment = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.interest_payment
           ELSE series_catalog.interest_payment
         END,
         raw_dimensions_json = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.raw_dimensions_json
           ELSE series_catalog.raw_dimensions_json
         END,
         latest_source_url = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.latest_source_url
           ELSE series_catalog.latest_source_url
         END,
         latest_product_url = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.latest_product_url
           ELSE series_catalog.latest_product_url
         END,
         latest_published_at = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.latest_published_at
           ELSE series_catalog.latest_published_at
         END,
         first_seen_collection_date = CASE
           WHEN excluded.first_seen_collection_date < series_catalog.first_seen_collection_date
           THEN excluded.first_seen_collection_date
           ELSE series_catalog.first_seen_collection_date
         END,
         last_seen_collection_date = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.last_seen_collection_date
           ELSE series_catalog.last_seen_collection_date
         END,
         last_seen_at = CURRENT_TIMESTAMP,
         is_removed = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN 0
           ELSE series_catalog.is_removed
         END,
         removed_at = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN NULL
           ELSE series_catalog.removed_at
         END,
         last_successful_run_id = CASE
           WHEN excluded.last_seen_collection_date >= series_catalog.last_seen_collection_date
           THEN excluded.last_successful_run_id
           ELSE series_catalog.last_successful_run_id
         END`,
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

export async function markRunSeenProducts(
  db: D1Database,
  rows: Array<{
    runId: string
    lenderCode: string
    dataset: DatasetKind
    bankName: string
    productId: string
    productCode: string
    collectionDate: string
  }>,
): Promise<void> {
  if (rows.length === 0) return
  const sql = `INSERT INTO run_seen_products (
         run_id, lender_code, dataset_kind, bank_name, product_id, product_code, collection_date, seen_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
       ON CONFLICT(run_id, lender_code, dataset_kind, bank_name, product_id) DO UPDATE SET
         product_code = excluded.product_code,
         collection_date = excluded.collection_date,
         seen_at = CURRENT_TIMESTAMP`

  for (const part of chunk(rows, 64)) {
    await db.batch(
      part.map((row) =>
        db
          .prepare(sql)
          .bind(row.runId, row.lenderCode, row.dataset, row.bankName, row.productId, row.productCode, row.collectionDate),
      ),
    )
  }
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

export async function markRunSeenSeriesBatch(
  db: D1Database,
  rows: Array<{
    runId: string
    lenderCode: string
    dataset: DatasetKind
    seriesKey: string
    bankName: string
    productId: string
    productCode: string
    collectionDate: string
  }>,
): Promise<void> {
  if (rows.length === 0) return
  const sql = `INSERT INTO run_seen_series (
         run_id, lender_code, dataset_kind, series_key, bank_name, product_id, product_code, collection_date, seen_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)
       ON CONFLICT(run_id, lender_code, dataset_kind, series_key) DO UPDATE SET
         product_code = excluded.product_code,
         collection_date = excluded.collection_date,
         seen_at = CURRENT_TIMESTAMP`

  for (const part of chunk(rows, 64)) {
    await db.batch(
      part.map((row) =>
        db
          .prepare(sql)
          .bind(
            row.runId,
            row.lenderCode,
            row.dataset,
            row.seriesKey,
            row.bankName,
            row.productId,
            row.productCode,
            row.collectionDate,
          ),
      ),
    )
  }
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
