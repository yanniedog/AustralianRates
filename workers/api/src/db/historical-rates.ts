import { type NormalizedRateRow, validateNormalizedRow } from '../ingest/normalize'
import { log } from '../utils/logger'
import { deriveRetrievalType } from '../utils/retrieval-type'
import { homeLoanDimensionJson, homeLoanSeriesKey, legacyProductKey } from '../utils/series-identity'
import { upsertProductCatalog, upsertSeriesCatalog } from './catalog'
import { emitCanonicalHistoricalUpsert } from './analytics/canonical-feed'
import { writeHomeLoanProjection } from './analytics/projection-write'
import { storeCdrDetailPayload } from './cdr-detail-payloads'
import { upsertLatestHomeLoanSeries } from './latest-series'
import { markSeriesSeen } from './series-status'
import { nowIso } from '../utils/time'

export async function upsertHistoricalRateRow(db: D1Database, row: NormalizedRateRow): Promise<void> {
  const verdict = validateNormalizedRow(row)
  if (!verdict.ok) {
    throw new Error(`invalid_normalized_rate_row:${verdict.reason}`)
  }

  const parsedAt = nowIso()
  const seriesKey = homeLoanSeriesKey(row)
  const productCode = row.productId
  const productKey = legacyProductKey('home_loans', {
    bankName: row.bankName,
    productId: row.productId,
    securityPurpose: row.securityPurpose,
    repaymentType: row.repaymentType,
    lvrTier: row.lvrTier,
    rateStructure: row.rateStructure,
  })
  const retrievalType = row.retrievalType ?? deriveRetrievalType(row.dataQualityFlag, row.sourceUrl)
  const cdrProductDetailHash =
    row.cdrProductDetailJson && row.cdrProductDetailJson.trim().length > 0
      ? await storeCdrDetailPayload(db, row.cdrProductDetailJson)
      : null

  await db
    .prepare(
      `INSERT INTO historical_loan_rates (
        bank_name,
        collection_date,
        product_id,
        product_code,
        product_name,
        series_key,
        security_purpose,
        repayment_type,
        rate_structure,
        lvr_tier,
        feature_set,
        has_offset_account,
        interest_rate,
        comparison_rate,
        annual_fee,
        source_url,
        product_url,
        published_at,
        cdr_product_detail_hash,
        data_quality_flag,
        confidence_score,
        retrieval_type,
        parsed_at,
        fetch_event_id,
        run_id,
        run_source
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)
      ON CONFLICT(bank_name, collection_date, product_id, security_purpose, repayment_type, lvr_tier, rate_structure) DO UPDATE SET
        product_code = excluded.product_code,
        product_name = excluded.product_name,
        series_key = excluded.series_key,
        feature_set = excluded.feature_set,
        has_offset_account = excluded.has_offset_account,
        interest_rate = excluded.interest_rate,
        comparison_rate = excluded.comparison_rate,
        annual_fee = excluded.annual_fee,
        source_url = excluded.source_url,
        product_url = excluded.product_url,
        published_at = excluded.published_at,
        cdr_product_detail_hash = COALESCE(excluded.cdr_product_detail_hash, historical_loan_rates.cdr_product_detail_hash),
        data_quality_flag = excluded.data_quality_flag,
        confidence_score = excluded.confidence_score,
        retrieval_type = excluded.retrieval_type,
        parsed_at = excluded.parsed_at,
        fetch_event_id = COALESCE(excluded.fetch_event_id, historical_loan_rates.fetch_event_id),
        run_id = excluded.run_id,
        run_source = excluded.run_source`,
    )
    .bind(
      row.bankName,
      row.collectionDate,
      row.productId,
      productCode,
      row.productName,
      seriesKey,
      row.securityPurpose,
      row.repaymentType,
      row.rateStructure,
      row.lvrTier,
      row.featureSet,
      row.hasOffsetAccount == null ? null : (row.hasOffsetAccount ? 1 : 0),
      row.interestRate,
      row.comparisonRate,
      row.annualFee,
      row.sourceUrl,
      row.productUrl ?? row.sourceUrl,
      row.publishedAt ?? null,
      cdrProductDetailHash,
      row.dataQualityFlag,
      row.confidenceScore,
      retrievalType,
      parsedAt,
      row.fetchEventId ?? null,
      row.runId ?? null,
      row.runSource ?? 'scheduled',
    )
    .run()

  await emitCanonicalHistoricalUpsert(
    db,
    'home_loans',
    {
      bank_name: row.bankName,
      collection_date: row.collectionDate,
      product_id: row.productId,
      lvr_tier: row.lvrTier,
      rate_structure: row.rateStructure,
      security_purpose: row.securityPurpose,
      repayment_type: row.repaymentType,
      run_source: row.runSource ?? 'scheduled',
    },
    row.runId ?? null,
    row.collectionDate,
  )

  await upsertProductCatalog(db, {
    dataset: 'home_loans',
    bankName: row.bankName,
    productId: row.productId,
    productCode,
    productName: row.productName,
    collectionDate: row.collectionDate,
    runId: row.runId ?? null,
    sourceUrl: row.sourceUrl,
    productUrl: row.productUrl ?? row.sourceUrl,
    publishedAt: row.publishedAt ?? null,
  })

  await upsertSeriesCatalog(db, {
    dataset: 'home_loans',
    seriesKey,
    bankName: row.bankName,
    productId: row.productId,
    productCode,
    productName: row.productName,
    collectionDate: row.collectionDate,
    runId: row.runId ?? null,
    sourceUrl: row.sourceUrl,
    productUrl: row.productUrl ?? row.sourceUrl,
    publishedAt: row.publishedAt ?? null,
    rawDimensionsJson: homeLoanDimensionJson(row),
    securityPurpose: row.securityPurpose,
    repaymentType: row.repaymentType,
    lvrTier: row.lvrTier,
    rateStructure: row.rateStructure,
  })

  await markSeriesSeen(db, {
    dataset: 'home_loans',
    seriesKey,
    bankName: row.bankName,
    productId: row.productId,
    productCode,
    collectionDate: row.collectionDate,
    runId: row.runId ?? null,
  })

  await upsertLatestHomeLoanSeries(db, {
    bankName: row.bankName,
    collectionDate: row.collectionDate,
    productId: row.productId,
    productCode,
    productName: row.productName,
    securityPurpose: row.securityPurpose,
    repaymentType: row.repaymentType,
    rateStructure: row.rateStructure,
    lvrTier: row.lvrTier,
    featureSet: row.featureSet,
    hasOffsetAccount: row.hasOffsetAccount ?? null,
    interestRate: row.interestRate,
    comparisonRate: row.comparisonRate,
    annualFee: row.annualFee,
    sourceUrl: row.sourceUrl,
    productUrl: row.productUrl ?? row.sourceUrl,
    publishedAt: row.publishedAt ?? null,
    cdrProductDetailHash,
    dataQualityFlag: row.dataQualityFlag,
    confidenceScore: row.confidenceScore,
    retrievalType,
    parsedAt,
    runId: row.runId ?? null,
    runSource: row.runSource ?? 'scheduled',
    seriesKey,
    productKey,
  })

  await writeHomeLoanProjection(db, {
    seriesKey,
    productKey,
    bankName: row.bankName,
    productId: row.productId,
    productName: row.productName,
    collectionDate: row.collectionDate,
    parsedAt,
    securityPurpose: row.securityPurpose,
    repaymentType: row.repaymentType,
    rateStructure: row.rateStructure,
    lvrTier: row.lvrTier,
    featureSet: row.featureSet,
    hasOffsetAccount: row.hasOffsetAccount ?? null,
    interestRate: row.interestRate,
    comparisonRate: row.comparisonRate,
    annualFee: row.annualFee,
    sourceUrl: row.sourceUrl,
    productUrl: row.productUrl ?? row.sourceUrl,
    publishedAt: row.publishedAt ?? null,
    cdrProductDetailHash,
    dataQualityFlag: row.dataQualityFlag,
    confidenceScore: row.confidenceScore,
    retrievalType,
    runId: row.runId ?? null,
    runSource: row.runSource ?? 'scheduled',
  })
}

export async function upsertHistoricalRateRows(db: D1Database, rows: NormalizedRateRow[]): Promise<number> {
  let written = 0
  for (const row of rows) {
    try {
      await upsertHistoricalRateRow(db, row)
      written += 1
    } catch (error) {
      log.error('db', `upsert_failed product=${row.productId} bank=${row.bankName} date=${row.collectionDate}`, {
        code: 'upsert_failed',
        context: (error as Error)?.message || String(error),
        lenderCode: row.bankName,
      })
    }
  }
  return written
}
