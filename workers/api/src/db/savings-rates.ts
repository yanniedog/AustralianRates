import { type NormalizedSavingsRow, validateNormalizedSavingsRow } from '../ingest/normalize-savings'
import { log } from '../utils/logger'
import { deriveRetrievalType } from '../utils/retrieval-type'

export async function upsertSavingsRateRow(db: D1Database, row: NormalizedSavingsRow): Promise<void> {
  const verdict = validateNormalizedSavingsRow(row)
  if (!verdict.ok) {
    throw new Error(`invalid_savings_row:${verdict.reason}`)
  }

  await db
    .prepare(
      `INSERT INTO historical_savings_rates (
        bank_name, collection_date, product_id, product_name,
        account_type, rate_type, interest_rate, deposit_tier,
        min_balance, max_balance, conditions, monthly_fee,
        source_url, product_url, published_at, cdr_product_detail_json, data_quality_flag, confidence_score,
        retrieval_type,
        parsed_at, run_id, run_source
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,CURRENT_TIMESTAMP,?20,?21)
      ON CONFLICT(bank_name, collection_date, product_id, account_type, rate_type, deposit_tier, run_source) DO UPDATE SET
        product_name = excluded.product_name,
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
        parsed_at = CURRENT_TIMESTAMP,
        run_id = excluded.run_id`,
    )
    .bind(
      row.bankName,
      row.collectionDate,
      row.productId,
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
      row.productUrl ?? row.sourceUrl,
      row.publishedAt ?? null,
      row.cdrProductDetailJson ?? null,
      row.dataQualityFlag,
      row.confidenceScore,
      row.retrievalType ?? deriveRetrievalType(row.dataQualityFlag, row.sourceUrl),
      row.runId ?? null,
      row.runSource ?? 'scheduled',
    )
    .run()
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
