import type { NormalizedRateRow } from '../ingest/normalize'

export async function upsertHistoricalRateRow(db: D1Database, row: NormalizedRateRow): Promise<void> {
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
        parsed_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, CURRENT_TIMESTAMP)
      ON CONFLICT(bank_name, collection_date, product_id, lvr_tier, rate_structure) DO UPDATE SET
        product_name = excluded.product_name,
        security_purpose = excluded.security_purpose,
        repayment_type = excluded.repayment_type,
        feature_set = excluded.feature_set,
        interest_rate = excluded.interest_rate,
        comparison_rate = excluded.comparison_rate,
        annual_fee = excluded.annual_fee,
        source_url = excluded.source_url,
        data_quality_flag = excluded.data_quality_flag,
        confidence_score = excluded.confidence_score,
        parsed_at = CURRENT_TIMESTAMP`,
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
    )
    .run()
}

export async function upsertHistoricalRateRows(db: D1Database, rows: NormalizedRateRow[]): Promise<number> {
  let written = 0
  for (const row of rows) {
    await upsertHistoricalRateRow(db, row)
    written += 1
  }
  return written
}
