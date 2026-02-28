import { type NormalizedSavingsRow, validateNormalizedSavingsRow } from '../ingest/normalize-savings'
import { log } from '../utils/logger'
import { deriveRetrievalType } from '../utils/retrieval-type'
import { savingsDimensionJson, savingsSeriesKey, legacyProductKey } from '../utils/series-identity'
import { upsertProductCatalog, upsertSeriesCatalog } from './catalog'
import { upsertLatestSavingsSeries } from './latest-series'
import { markSeriesSeen } from './series-status'
import { nowIso } from '../utils/time'

export async function upsertSavingsRateRow(db: D1Database, row: NormalizedSavingsRow): Promise<void> {
  const verdict = validateNormalizedSavingsRow(row)
  if (!verdict.ok) {
    throw new Error(`invalid_savings_row:${verdict.reason}`)
  }

  const parsedAt = nowIso()
  const seriesKey = savingsSeriesKey(row)
  const productCode = row.productId
  const retrievalType = row.retrievalType ?? deriveRetrievalType(row.dataQualityFlag, row.sourceUrl)

  await db
    .prepare(
      `INSERT INTO historical_savings_rates (
        bank_name, collection_date, product_id, product_code, product_name,
        series_key, account_type, rate_type, interest_rate, deposit_tier,
        min_balance, max_balance, conditions, monthly_fee,
        source_url, product_url, published_at, cdr_product_detail_json, data_quality_flag, confidence_score,
        retrieval_type,
        parsed_at, fetch_event_id, run_id, run_source
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)
      ON CONFLICT(bank_name, collection_date, product_id, account_type, rate_type, deposit_tier, run_source) DO UPDATE SET
        product_code = excluded.product_code,
        product_name = excluded.product_name,
        series_key = excluded.series_key,
        account_type = excluded.account_type,
        interest_rate = excluded.interest_rate,
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
        fetch_event_id = excluded.fetch_event_id,
        run_id = excluded.run_id`,
    )
    .bind(
      row.bankName,
      row.collectionDate,
      row.productId,
      productCode,
      row.productName,
      seriesKey,
      row.accountType,
      row.rateType,
      row.interestRate,
      row.depositTier,
      row.minBalance,
      row.maxBalance,
      row.conditions,
      row.monthlyFee,
      row.sourceUrl,
      row.productUrl ?? row.sourceUrl,
      row.publishedAt ?? null,
      row.cdrProductDetailJson ?? null,
      row.dataQualityFlag,
      row.confidenceScore,
      retrievalType,
      parsedAt,
      row.fetchEventId ?? null,
      row.runId ?? null,
      row.runSource ?? 'scheduled',
    )
    .run()

  await upsertProductCatalog(db, {
    dataset: 'savings',
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
    dataset: 'savings',
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
    rawDimensionsJson: savingsDimensionJson(row),
    accountType: row.accountType,
    rateType: row.rateType,
    depositTier: row.depositTier,
  })

  await markSeriesSeen(db, {
    dataset: 'savings',
    seriesKey,
    bankName: row.bankName,
    productId: row.productId,
    productCode,
    collectionDate: row.collectionDate,
    runId: row.runId ?? null,
  })

  await upsertLatestSavingsSeries(db, {
    bankName: row.bankName,
    collectionDate: row.collectionDate,
    productId: row.productId,
    productCode,
    productName: row.productName,
    accountType: row.accountType,
    rateType: row.rateType,
    interestRate: row.interestRate,
    depositTier: row.depositTier,
    minBalance: row.minBalance,
    maxBalance: row.maxBalance,
    conditions: row.conditions,
    monthlyFee: row.monthlyFee,
    sourceUrl: row.sourceUrl,
    productUrl: row.productUrl ?? row.sourceUrl,
    publishedAt: row.publishedAt ?? null,
    cdrProductDetailJson: row.cdrProductDetailJson ?? null,
    dataQualityFlag: row.dataQualityFlag,
    confidenceScore: row.confidenceScore,
    retrievalType,
    parsedAt,
    runId: row.runId ?? null,
    runSource: row.runSource ?? 'scheduled',
    seriesKey,
    productKey: legacyProductKey('savings', {
      bankName: row.bankName,
      productId: row.productId,
      accountType: row.accountType,
      rateType: row.rateType,
      depositTier: row.depositTier,
    }),
  })
}

export async function upsertSavingsRateRows(db: D1Database, rows: NormalizedSavingsRow[]): Promise<number> {
  let written = 0
  for (const row of rows) {
    try {
      await upsertSavingsRateRow(db, row)
      written += 1
    } catch (error) {
      log.error('db', `savings_upsert_failed product=${row.productId} bank=${row.bankName}`, {
        context: (error as Error)?.message || String(error),
        lenderCode: row.bankName,
      })
    }
  }
  return written
}
