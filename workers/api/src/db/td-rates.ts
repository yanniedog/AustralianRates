import { type NormalizedTdRow, validateNormalizedTdRow } from '../ingest/normalize-savings'
import { log } from '../utils/logger'
import { deriveRetrievalType } from '../utils/retrieval-type'
import { tdDimensionJson, tdSeriesKey, legacyProductKey } from '../utils/series-identity'
import { upsertProductCatalog, upsertSeriesCatalog } from './catalog'
import { upsertLatestTdSeries } from './latest-series'
import { markSeriesSeen } from './series-status'
import { nowIso } from '../utils/time'

export async function upsertTdRateRow(db: D1Database, row: NormalizedTdRow): Promise<void> {
  const verdict = validateNormalizedTdRow(row)
  if (!verdict.ok) {
    throw new Error(`invalid_td_row:${verdict.reason}`)
  }

  const parsedAt = nowIso()
  const seriesKey = tdSeriesKey(row)
  const productCode = row.productId
  const retrievalType = row.retrievalType ?? deriveRetrievalType(row.dataQualityFlag, row.sourceUrl)

  await db
    .prepare(
      `INSERT INTO historical_term_deposit_rates (
        bank_name, collection_date, product_id, product_code, product_name,
        series_key, term_months, interest_rate, deposit_tier,
        min_deposit, max_deposit, interest_payment,
        source_url, product_url, published_at, cdr_product_detail_json, data_quality_flag, confidence_score,
        retrieval_type,
        parsed_at, fetch_event_id, run_id, run_source
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)
      ON CONFLICT(bank_name, collection_date, product_id, term_months, deposit_tier, interest_payment, run_source) DO UPDATE SET
        product_code = excluded.product_code,
        product_name = excluded.product_name,
        series_key = excluded.series_key,
        interest_rate = excluded.interest_rate,
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
      row.termMonths,
      row.interestRate,
      row.depositTier,
      row.minDeposit,
      row.maxDeposit,
      row.interestPayment,
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
    dataset: 'term_deposits',
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
    dataset: 'term_deposits',
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
    rawDimensionsJson: tdDimensionJson(row),
    depositTier: row.depositTier,
    termMonths: row.termMonths,
    interestPayment: row.interestPayment,
  })

  await markSeriesSeen(db, {
    dataset: 'term_deposits',
    seriesKey,
    bankName: row.bankName,
    productId: row.productId,
    productCode,
    collectionDate: row.collectionDate,
    runId: row.runId ?? null,
  })

  await upsertLatestTdSeries(db, {
    bankName: row.bankName,
    collectionDate: row.collectionDate,
    productId: row.productId,
    productCode,
    productName: row.productName,
    termMonths: row.termMonths,
    interestRate: row.interestRate,
    depositTier: row.depositTier,
    minDeposit: row.minDeposit,
    maxDeposit: row.maxDeposit,
    interestPayment: row.interestPayment,
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
    productKey: legacyProductKey('term_deposits', {
      bankName: row.bankName,
      productId: row.productId,
      termMonths: row.termMonths,
      depositTier: row.depositTier,
      interestPayment: row.interestPayment,
    }),
  })
}

export async function upsertTdRateRows(db: D1Database, rows: NormalizedTdRow[]): Promise<number> {
  let written = 0
  for (const row of rows) {
    try {
      await upsertTdRateRow(db, row)
      written += 1
    } catch (error) {
      log.error('db', `td_upsert_failed product=${row.productId} bank=${row.bankName}`, {
        code: 'upsert_failed',
        context: (error as Error)?.message || String(error),
        lenderCode: row.bankName,
      })
    }
  }
  return written
}
