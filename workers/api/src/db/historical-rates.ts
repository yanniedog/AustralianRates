import { type NormalizedRateRow, validateNormalizedRow } from '../ingest/normalize'
import { log } from '../utils/logger'
import { deriveRetrievalType } from '../utils/retrieval-type'

export async function upsertHistoricalRateRow(db: D1Database, row: NormalizedRateRow): Promise<void> {
  const verdict = validateNormalizedRow(row)
  if (!verdict.ok) {
    throw new Error(`invalid_normalized_rate_row:${verdict.reason}`)
  }

  await db
    .prepare(
      `INSERT INTO historical_loan_rates (
        bank_name,
        collection_date,
        product_id,
        product_name,
        security_purpose,
        repayment_type,
        rate_structure,
        lvr_tier,
        feature_set,
        interest_rate,
        comparison_rate,
        annual_fee,
        source_url,
        data_quality_flag,
        confidence_score,
        retrieval_type,
        parsed_at,
        run_id,
        run_source
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, CURRENT_TIMESTAMP, ?17, ?18)
      ON CONFLICT(bank_name, collection_date, product_id, lvr_tier, rate_structure, security_purpose, repayment_type, run_source) DO UPDATE SET
        product_name = excluded.product_name,
        feature_set = excluded.feature_set,
        interest_rate = excluded.interest_rate,
        comparison_rate = excluded.comparison_rate,
        annual_fee = excluded.annual_fee,
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
      row.securityPurpose,
      row.repaymentType,
      row.rateStructure,
      row.lvrTier,
      row.featureSet,
      row.interestRate,
      row.comparisonRate,
      row.annualFee,
      row.sourceUrl,
      row.dataQualityFlag,
      row.confidenceScore,
      row.retrievalType ?? deriveRetrievalType(row.dataQualityFlag, row.sourceUrl),
      row.runId ?? null,
      row.runSource ?? 'scheduled',
    )
    .run()
}

export async function upsertHistoricalRateRows(db: D1Database, rows: NormalizedRateRow[]): Promise<number> {
  let written = 0
  for (const row of rows) {
    try {
      await upsertHistoricalRateRow(db, row)
      written += 1
    } catch (error) {
      log.error('db', `upsert_failed product=${row.productId} bank=${row.bankName} date=${row.collectionDate}`, {
        context: (error as Error)?.message || String(error),
        lenderCode: row.bankName,
      })
    }
  }
  return written
}
