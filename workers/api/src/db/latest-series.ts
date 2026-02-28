type HomeRow = {
  bankName: string
  collectionDate: string
  productId: string
  productCode: string
  productName: string
  securityPurpose: string
  repaymentType: string
  rateStructure: string
  lvrTier: string
  featureSet: string
  interestRate: number
  comparisonRate: number | null
  annualFee: number | null
  sourceUrl: string
  productUrl?: string | null
  publishedAt?: string | null
  cdrProductDetailJson?: string | null
  dataQualityFlag: string
  confidenceScore: number
  retrievalType: string
  parsedAt: string
  runId?: string | null
  runSource: string
  seriesKey: string
  productKey: string
  isRemoved?: boolean
  removedAt?: string | null
}

type SavingsRow = {
  bankName: string
  collectionDate: string
  productId: string
  productCode: string
  productName: string
  accountType: string
  rateType: string
  interestRate: number
  depositTier: string
  minBalance: number | null
  maxBalance: number | null
  conditions: string | null
  monthlyFee: number | null
  sourceUrl: string
  productUrl?: string | null
  publishedAt?: string | null
  cdrProductDetailJson?: string | null
  dataQualityFlag: string
  confidenceScore: number
  retrievalType: string
  parsedAt: string
  runId?: string | null
  runSource: string
  seriesKey: string
  productKey: string
  isRemoved?: boolean
  removedAt?: string | null
}

type TdRow = {
  bankName: string
  collectionDate: string
  productId: string
  productCode: string
  productName: string
  termMonths: number
  interestRate: number
  depositTier: string
  minDeposit: number | null
  maxDeposit: number | null
  interestPayment: string
  sourceUrl: string
  productUrl?: string | null
  publishedAt?: string | null
  cdrProductDetailJson?: string | null
  dataQualityFlag: string
  confidenceScore: number
  retrievalType: string
  parsedAt: string
  runId?: string | null
  runSource: string
  seriesKey: string
  productKey: string
  isRemoved?: boolean
  removedAt?: string | null
}

export async function upsertLatestHomeLoanSeries(db: D1Database, row: HomeRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO latest_home_loan_series (
         series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
         security_purpose, repayment_type, rate_structure, lvr_tier, feature_set, interest_rate, comparison_rate, annual_fee,
         source_url, product_url, published_at, cdr_product_detail_json, data_quality_flag, confidence_score, retrieval_type,
         parsed_at, run_id, run_source, is_removed, removed_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7,
         ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
         ?16, ?17, ?18, ?19, ?20, ?21, ?22,
         ?23, ?24, ?25, ?26, ?27
       )
       ON CONFLICT(series_key) DO UPDATE SET
         product_key = excluded.product_key,
         bank_name = excluded.bank_name,
         collection_date = excluded.collection_date,
         product_id = excluded.product_id,
         product_code = excluded.product_code,
         product_name = excluded.product_name,
         security_purpose = excluded.security_purpose,
         repayment_type = excluded.repayment_type,
         rate_structure = excluded.rate_structure,
         lvr_tier = excluded.lvr_tier,
         feature_set = excluded.feature_set,
         interest_rate = excluded.interest_rate,
         comparison_rate = excluded.comparison_rate,
         annual_fee = excluded.annual_fee,
         source_url = excluded.source_url,
         product_url = excluded.product_url,
         published_at = excluded.published_at,
         cdr_product_detail_json = excluded.cdr_product_detail_json,
         data_quality_flag = excluded.data_quality_flag,
         confidence_score = excluded.confidence_score,
         retrieval_type = excluded.retrieval_type,
         parsed_at = excluded.parsed_at,
         run_id = excluded.run_id,
         run_source = excluded.run_source,
         is_removed = excluded.is_removed,
         removed_at = excluded.removed_at`,
    )
    .bind(
      row.seriesKey,
      row.productKey,
      row.bankName,
      row.collectionDate,
      row.productId,
      row.productCode,
      row.productName,
      row.securityPurpose,
      row.repaymentType,
      row.rateStructure,
      row.lvrTier,
      row.featureSet,
      row.interestRate,
      row.comparisonRate,
      row.annualFee,
      row.sourceUrl,
      row.productUrl ?? null,
      row.publishedAt ?? null,
      row.cdrProductDetailJson ?? null,
      row.dataQualityFlag,
      row.confidenceScore,
      row.retrievalType,
      row.parsedAt,
      row.runId ?? null,
      row.runSource,
      row.isRemoved ? 1 : 0,
      row.removedAt ?? null,
    )
    .run()
}

export async function upsertLatestSavingsSeries(db: D1Database, row: SavingsRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO latest_savings_series (
         series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
         account_type, rate_type, interest_rate, deposit_tier, min_balance, max_balance, conditions, monthly_fee,
         source_url, product_url, published_at, cdr_product_detail_json, data_quality_flag, confidence_score, retrieval_type,
         parsed_at, run_id, run_source, is_removed, removed_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7,
         ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
         ?16, ?17, ?18, ?19, ?20, ?21, ?22,
         ?23, ?24, ?25, ?26, ?27
       )
       ON CONFLICT(series_key) DO UPDATE SET
         product_key = excluded.product_key,
         bank_name = excluded.bank_name,
         collection_date = excluded.collection_date,
         product_id = excluded.product_id,
         product_code = excluded.product_code,
         product_name = excluded.product_name,
         account_type = excluded.account_type,
         rate_type = excluded.rate_type,
         interest_rate = excluded.interest_rate,
         deposit_tier = excluded.deposit_tier,
         min_balance = excluded.min_balance,
         max_balance = excluded.max_balance,
         conditions = excluded.conditions,
         monthly_fee = excluded.monthly_fee,
         source_url = excluded.source_url,
         product_url = excluded.product_url,
         published_at = excluded.published_at,
         cdr_product_detail_json = excluded.cdr_product_detail_json,
         data_quality_flag = excluded.data_quality_flag,
         confidence_score = excluded.confidence_score,
         retrieval_type = excluded.retrieval_type,
         parsed_at = excluded.parsed_at,
         run_id = excluded.run_id,
         run_source = excluded.run_source,
         is_removed = excluded.is_removed,
         removed_at = excluded.removed_at`,
    )
    .bind(
      row.seriesKey,
      row.productKey,
      row.bankName,
      row.collectionDate,
      row.productId,
      row.productCode,
      row.productName,
      row.accountType,
      row.rateType,
      row.interestRate,
      row.depositTier,
      row.minBalance,
      row.maxBalance,
      row.conditions,
      row.monthlyFee,
      row.sourceUrl,
      row.productUrl ?? null,
      row.publishedAt ?? null,
      row.cdrProductDetailJson ?? null,
      row.dataQualityFlag,
      row.confidenceScore,
      row.retrievalType,
      row.parsedAt,
      row.runId ?? null,
      row.runSource,
      row.isRemoved ? 1 : 0,
      row.removedAt ?? null,
    )
    .run()
}

export async function upsertLatestTdSeries(db: D1Database, row: TdRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO latest_td_series (
         series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
         term_months, interest_rate, deposit_tier, min_deposit, max_deposit, interest_payment,
         source_url, product_url, published_at, cdr_product_detail_json, data_quality_flag, confidence_score, retrieval_type,
         parsed_at, run_id, run_source, is_removed, removed_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7,
         ?8, ?9, ?10, ?11, ?12, ?13,
         ?14, ?15, ?16, ?17, ?18, ?19, ?20,
         ?21, ?22, ?23, ?24, ?25
       )
       ON CONFLICT(series_key) DO UPDATE SET
         product_key = excluded.product_key,
         bank_name = excluded.bank_name,
         collection_date = excluded.collection_date,
         product_id = excluded.product_id,
         product_code = excluded.product_code,
         product_name = excluded.product_name,
         term_months = excluded.term_months,
         interest_rate = excluded.interest_rate,
         deposit_tier = excluded.deposit_tier,
         min_deposit = excluded.min_deposit,
         max_deposit = excluded.max_deposit,
         interest_payment = excluded.interest_payment,
         source_url = excluded.source_url,
         product_url = excluded.product_url,
         published_at = excluded.published_at,
         cdr_product_detail_json = excluded.cdr_product_detail_json,
         data_quality_flag = excluded.data_quality_flag,
         confidence_score = excluded.confidence_score,
         retrieval_type = excluded.retrieval_type,
         parsed_at = excluded.parsed_at,
         run_id = excluded.run_id,
         run_source = excluded.run_source,
         is_removed = excluded.is_removed,
         removed_at = excluded.removed_at`,
    )
    .bind(
      row.seriesKey,
      row.productKey,
      row.bankName,
      row.collectionDate,
      row.productId,
      row.productCode,
      row.productName,
      row.termMonths,
      row.interestRate,
      row.depositTier,
      row.minDeposit,
      row.maxDeposit,
      row.interestPayment,
      row.sourceUrl,
      row.productUrl ?? null,
      row.publishedAt ?? null,
      row.cdrProductDetailJson ?? null,
      row.dataQualityFlag,
      row.confidenceScore,
      row.retrievalType,
      row.parsedAt,
      row.runId ?? null,
      row.runSource,
      row.isRemoved ? 1 : 0,
      row.removedAt ?? null,
    )
    .run()
}
