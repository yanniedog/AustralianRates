import { type NormalizedTdRow, validateNormalizedTdRow } from '../ingest/normalize-savings'
import { log } from '../utils/logger'
import { deriveRetrievalType } from '../utils/retrieval-type'

export async function upsertTdRateRow(db: D1Database, row: NormalizedTdRow): Promise<void> {
  const verdict = validateNormalizedTdRow(row)
  if (!verdict.ok) {
    throw new Error(`invalid_td_row:${verdict.reason}`)
  }

  await db
    .prepare(
      `INSERT INTO historical_term_deposit_rates (
        bank_name, collection_date, product_id, product_name,
        term_months, interest_rate, deposit_tier,
        min_deposit, max_deposit, interest_payment,
        source_url, data_quality_flag, confidence_score,
        retrieval_type,
        parsed_at, run_id, run_source
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,CURRENT_TIMESTAMP,?15,?16)
      ON CONFLICT(bank_name, collection_date, product_id, term_months, deposit_tier, run_source) DO UPDATE SET
        product_name = excluded.product_name,
        interest_rate = excluded.interest_rate,
        min_deposit = excluded.min_deposit,
        max_deposit = excluded.max_deposit,
        interest_payment = excluded.interest_payment,
        source_url = excluded.source_url,
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
      row.termMonths,
      row.interestRate,
      row.depositTier,
      row.minDeposit,
      row.maxDeposit,
      row.interestPayment,
      row.sourceUrl,
      row.dataQualityFlag,
      row.confidenceScore,
      row.retrievalType ?? deriveRetrievalType(row.dataQualityFlag, row.sourceUrl),
      row.runId ?? null,
      row.runSource ?? 'scheduled',
    )
    .run()
}

export async function upsertTdRateRows(db: D1Database, rows: NormalizedTdRow[]): Promise<number> {
  let written = 0
  for (const row of rows) {
    try {
      await upsertTdRateRow(db, row)
      written += 1
    } catch (error) {
      log.error('db', `td_upsert_failed product=${row.productId} bank=${row.bankName}`, {
        context: (error as Error)?.message || String(error),
        lenderCode: row.bankName,
      })
    }
  }
  return written
}
