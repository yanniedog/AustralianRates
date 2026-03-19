import type { DatasetKind } from '../../../../../packages/shared/src/index.js'
import { nowIso } from '../../utils/time'
import { getAnalyticsDatasetConfig } from './config'
import { writeHomeLoanProjection, writeSavingsProjection, writeTdProjection } from './projection-write'

function uniqueKeys(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size))
  }
  return out
}

async function fetchLatestRowsBySeriesKey(
  db: D1Database,
  dataset: DatasetKind,
  seriesKeys: string[],
): Promise<Array<Record<string, unknown>>> {
  const config = getAnalyticsDatasetConfig(dataset)
  const rows: Array<Record<string, unknown>> = []
  for (const batch of chunk(seriesKeys, 100)) {
    const placeholders = batch.map((_value, index) => `?${index + 1}`).join(', ')
    const result = await db
      .prepare(`SELECT * FROM ${config.latestTable} WHERE series_key IN (${placeholders})`)
      .bind(...batch)
      .all<Record<string, unknown>>()
    rows.push(...(result.results ?? []))
  }
  return rows
}

async function writeRemovedProjectionForRow(
  db: D1Database,
  dataset: DatasetKind,
  row: Record<string, unknown>,
  collectionDate: string,
  removedAt: string,
): Promise<void> {
  const parsedAt = removedAt || nowIso()
  if (dataset === 'home_loans') {
    await writeHomeLoanProjection(db, {
      seriesKey: String(row.series_key || ''),
      productKey: String(row.product_key || ''),
      bankName: String(row.bank_name || ''),
      productId: String(row.product_id || ''),
      productName: String(row.product_name || ''),
      collectionDate,
      parsedAt,
      securityPurpose: String(row.security_purpose || ''),
      repaymentType: String(row.repayment_type || ''),
      rateStructure: String(row.rate_structure || ''),
      lvrTier: String(row.lvr_tier || ''),
      featureSet: String(row.feature_set || ''),
      hasOffsetAccount: row.has_offset_account == null ? null : Number(row.has_offset_account) === 1,
      interestRate: Number(row.interest_rate ?? 0),
      comparisonRate: row.comparison_rate == null ? null : Number(row.comparison_rate),
      annualFee: row.annual_fee == null ? null : Number(row.annual_fee),
      sourceUrl: String(row.source_url || ''),
      productUrl: row.product_url == null ? null : String(row.product_url),
      publishedAt: row.published_at == null ? null : String(row.published_at),
      cdrProductDetailHash: row.cdr_product_detail_hash == null ? null : String(row.cdr_product_detail_hash),
      dataQualityFlag: String(row.data_quality_flag || ''),
      confidenceScore: Number(row.confidence_score ?? 0),
      retrievalType: String(row.retrieval_type || ''),
      runId: row.run_id == null ? null : String(row.run_id),
      runSource: String(row.run_source || 'scheduled'),
      isRemoved: true,
      removedAt,
    })
    return
  }

  if (dataset === 'savings') {
    await writeSavingsProjection(db, {
      seriesKey: String(row.series_key || ''),
      productKey: String(row.product_key || ''),
      bankName: String(row.bank_name || ''),
      productId: String(row.product_id || ''),
      productName: String(row.product_name || ''),
      collectionDate,
      parsedAt,
      accountType: String(row.account_type || ''),
      rateType: String(row.rate_type || ''),
      depositTier: String(row.deposit_tier || ''),
      interestRate: Number(row.interest_rate ?? 0),
      minBalance: row.min_balance == null ? null : Number(row.min_balance),
      maxBalance: row.max_balance == null ? null : Number(row.max_balance),
      conditions: row.conditions == null ? null : String(row.conditions),
      monthlyFee: row.monthly_fee == null ? null : Number(row.monthly_fee),
      sourceUrl: String(row.source_url || ''),
      productUrl: row.product_url == null ? null : String(row.product_url),
      publishedAt: row.published_at == null ? null : String(row.published_at),
      cdrProductDetailHash: row.cdr_product_detail_hash == null ? null : String(row.cdr_product_detail_hash),
      dataQualityFlag: String(row.data_quality_flag || ''),
      confidenceScore: Number(row.confidence_score ?? 0),
      retrievalType: String(row.retrieval_type || ''),
      runId: row.run_id == null ? null : String(row.run_id),
      runSource: String(row.run_source || 'scheduled'),
      isRemoved: true,
      removedAt,
    })
    return
  }

  await writeTdProjection(db, {
    seriesKey: String(row.series_key || ''),
    productKey: String(row.product_key || ''),
    bankName: String(row.bank_name || ''),
    productId: String(row.product_id || ''),
    productName: String(row.product_name || ''),
    collectionDate,
    parsedAt,
    termMonths: Number(row.term_months ?? 0),
    depositTier: String(row.deposit_tier || ''),
    interestPayment: String(row.interest_payment || ''),
    interestRate: Number(row.interest_rate ?? 0),
    minDeposit: row.min_deposit == null ? null : Number(row.min_deposit),
    maxDeposit: row.max_deposit == null ? null : Number(row.max_deposit),
    sourceUrl: String(row.source_url || ''),
    productUrl: row.product_url == null ? null : String(row.product_url),
    publishedAt: row.published_at == null ? null : String(row.published_at),
    cdrProductDetailHash: row.cdr_product_detail_hash == null ? null : String(row.cdr_product_detail_hash),
    dataQualityFlag: String(row.data_quality_flag || ''),
    confidenceScore: Number(row.confidence_score ?? 0),
    retrievalType: String(row.retrieval_type || ''),
    runId: row.run_id == null ? null : String(row.run_id),
    runSource: String(row.run_source || 'scheduled'),
    isRemoved: true,
    removedAt,
  })
}

export async function writeRemovedSeriesProjections(
  db: D1Database,
  input: { dataset: DatasetKind; collectionDate: string; seriesKeys: string[]; removedAt?: string | null },
): Promise<number> {
  const seriesKeys = uniqueKeys(input.seriesKeys)
  if (seriesKeys.length === 0) return 0
  const removedAt = String(input.removedAt || nowIso())
  const rows = await fetchLatestRowsBySeriesKey(db, input.dataset, seriesKeys)
  for (const row of rows) {
    await writeRemovedProjectionForRow(db, input.dataset, row, input.collectionDate, removedAt)
  }
  return rows.length
}
