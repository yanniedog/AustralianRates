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
import {
  assertHistoricalWriteAllowed,
  isHistoricalWriteContractError,
  recordHistoricalWriteContractViolation,
} from './historical-write-guard'

const UPSERT_HISTORICAL_LOAN_RATE_SQL = `INSERT INTO historical_loan_rates (
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
        run_source = excluded.run_source`

const UPSERT_LATEST_HOME_LOAN_SERIES_SQL = `INSERT INTO latest_home_loan_series (
         series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
         security_purpose, repayment_type, rate_structure, lvr_tier, feature_set, has_offset_account, interest_rate, comparison_rate, annual_fee,
         source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score, retrieval_type,
         parsed_at, run_id, run_source, is_removed, removed_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7,
         ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
         ?17, ?18, ?19, ?20, ?21, ?22, ?23,
         ?24, ?25, ?26, ?27, ?28
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
         has_offset_account = excluded.has_offset_account,
         interest_rate = excluded.interest_rate,
         comparison_rate = excluded.comparison_rate,
         annual_fee = excluded.annual_fee,
         source_url = excluded.source_url,
         product_url = excluded.product_url,
         published_at = excluded.published_at,
         cdr_product_detail_hash = COALESCE(excluded.cdr_product_detail_hash, latest_home_loan_series.cdr_product_detail_hash),
         data_quality_flag = excluded.data_quality_flag,
         confidence_score = excluded.confidence_score,
         retrieval_type = excluded.retrieval_type,
         parsed_at = excluded.parsed_at,
         run_id = excluded.run_id,
         run_source = excluded.run_source,
         is_removed = excluded.is_removed,
         removed_at = excluded.removed_at
       WHERE excluded.collection_date > latest_home_loan_series.collection_date
          OR (
            excluded.collection_date = latest_home_loan_series.collection_date
            AND excluded.parsed_at >= latest_home_loan_series.parsed_at
          )`

function chunk<T>(rows: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size))
  }
  return output
}

type PreparedHomeLoanRow = {
  row: NormalizedRateRow
  seriesKey: string
  productKey: string
  productCode: string
  retrievalType: string
  parsedAt: string
  cdrProductDetailHash: string | null
}

export type RateBatchWriteResult = {
  written: number
  unchanged: number
  skippedSideEffects: number
}

function emptyWriteResult(): RateBatchWriteResult {
  return { written: 0, unchanged: 0, skippedSideEffects: 0 }
}

function addWriteResult(target: RateBatchWriteResult, source: RateBatchWriteResult): void {
  target.written += source.written
  target.unchanged += source.unchanged
  target.skippedSideEffects += source.skippedSideEffects
}

function equalStateValue(left: unknown, right: unknown): boolean {
  if (left == null && right == null) return true
  if (typeof left === 'number' || typeof right === 'number') {
    const a = left == null ? null : Number(left)
    const b = right == null ? null : Number(right)
    if (a == null || b == null) return a === b
    return Number.isFinite(a) && Number.isFinite(b) ? a === b : String(left) === String(right)
  }
  return String(left ?? '') === String(right ?? '')
}

function homeLoanRowUnchanged(current: Record<string, unknown>, row: NormalizedRateRow): boolean {
  const comparisons: Array<[unknown, unknown]> = [
    [current.product_id, row.productId],
    [current.product_name, row.productName],
    [current.security_purpose, row.securityPurpose],
    [current.repayment_type, row.repaymentType],
    [current.rate_structure, row.rateStructure],
    [current.lvr_tier, row.lvrTier],
    [current.feature_set, row.featureSet],
    [current.has_offset_account == null ? null : Number(current.has_offset_account), row.hasOffsetAccount == null ? null : (row.hasOffsetAccount ? 1 : 0)],
    [current.interest_rate, row.interestRate],
    [current.comparison_rate, row.comparisonRate ?? null],
    [current.annual_fee, row.annualFee ?? null],
  ]
  return comparisons.every(([left, right]) => equalStateValue(left, right))
}

async function filterChangedHomeLoanRows(db: D1Database, rows: NormalizedRateRow[]): Promise<{
  changed: NormalizedRateRow[]
  unchanged: number
}> {
  const keyed = rows.map((row) => ({ row, seriesKey: homeLoanSeriesKey(row) }))
  const currentByKey = new Map<string, Record<string, unknown>>()
  for (const part of chunk(Array.from(new Set(keyed.map((item) => item.seriesKey))), 80)) {
    const result = await db
      .prepare(
        `SELECT series_key, product_id, product_name, security_purpose, repayment_type,
                rate_structure, lvr_tier, feature_set, has_offset_account, interest_rate,
                comparison_rate, annual_fee, is_removed
         FROM latest_home_loan_series
         WHERE series_key IN (${part.map(() => '?').join(',')})`,
      )
      .bind(...part)
      .all<Record<string, unknown>>()
    for (const current of result.results ?? []) {
      currentByKey.set(String(current.series_key || ''), current)
    }
  }
  const changed: NormalizedRateRow[] = []
  let unchanged = 0
  for (const item of keyed) {
    const current = currentByKey.get(item.seriesKey)
    if (current && Number(current.is_removed ?? 0) === 0 && homeLoanRowUnchanged(current, item.row)) {
      unchanged += 1
    } else {
      changed.push(item.row)
    }
  }
  return { changed, unchanged }
}

async function prepareHomeLoanRow(db: D1Database, row: NormalizedRateRow): Promise<PreparedHomeLoanRow> {
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

  return {
    row,
    seriesKey,
    productKey,
    productCode,
    retrievalType,
    parsedAt,
    cdrProductDetailHash,
  }
}

function buildHistoricalLoanRateStatement(db: D1Database, prepared: PreparedHomeLoanRow): D1PreparedStatement {
  const { row, seriesKey, productCode, retrievalType, parsedAt, cdrProductDetailHash } = prepared
  return db
    .prepare(UPSERT_HISTORICAL_LOAN_RATE_SQL)
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
}

function buildLatestHomeLoanSeriesStatement(db: D1Database, prepared: PreparedHomeLoanRow): D1PreparedStatement {
  const { row, seriesKey, productKey, productCode, retrievalType, parsedAt, cdrProductDetailHash } = prepared
  return db
    .prepare(UPSERT_LATEST_HOME_LOAN_SERIES_SQL)
    .bind(
      seriesKey,
      productKey,
      row.bankName,
      row.collectionDate,
      row.productId,
      productCode,
      row.productName,
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
      row.runId ?? null,
      row.runSource ?? 'scheduled',
      0,
      null,
    )
}

function shouldUseBatchedHomeLoanFastPath(options: HistoricalRateWriteOptions): boolean {
  return (
    options.emitCanonicalFeed === false &&
    options.writeProjection === false &&
    options.updateCatalogs === false &&
    options.markSeriesSeen === false &&
    options.emitProjectionChangeFeed !== true
  )
}

async function upsertHistoricalRateRowsFastPath(
  db: D1Database,
  rows: NormalizedRateRow[],
  options: HistoricalRateWriteOptions,
): Promise<RateBatchWriteResult> {
  const preparedRows = await Promise.all(rows.map((row) => prepareHomeLoanRow(db, row)))
  const result = emptyWriteResult()

  for (const part of chunk(preparedRows, 32)) {
    try {
      const statements: D1PreparedStatement[] = []
      for (const prepared of part) {
        statements.push(buildHistoricalLoanRateStatement(db, prepared))
        if (options.upsertLatestSeries !== false) {
          statements.push(buildLatestHomeLoanSeriesStatement(db, prepared))
        }
      }
      await db.batch(statements)
      result.written += part.length
      result.skippedSideEffects += part.length
    } catch {
      for (const prepared of part) {
        try {
          const rowResult = await upsertHistoricalRateRow(db, prepared.row, options)
          addWriteResult(result, rowResult)
        } catch (error) {
          const code = isHistoricalWriteContractError(error) ? 'write_contract_violation' : 'upsert_failed'
          if (isHistoricalWriteContractError(error)) {
            await recordHistoricalWriteContractViolation(db, {
              dataset: 'home_loans',
              row: prepared.row,
              lenderCode: error.lenderCode,
              reason: error.reason,
              seriesKey: prepared.seriesKey,
            })
          }
          log.error('db', `upsert_failed product=${prepared.row.productId} bank=${prepared.row.bankName} date=${prepared.row.collectionDate}`, {
            code,
            context: (error as Error)?.message || String(error),
            lenderCode: prepared.row.bankName,
          })
        }
      }
    }
  }

  return result
}

export type HistoricalRateWriteOptions = {
  emitCanonicalFeed?: boolean
  writeProjection?: boolean
  emitProjectionChangeFeed?: boolean
  updateCatalogs?: boolean
  markSeriesSeen?: boolean
  upsertLatestSeries?: boolean
  skipUnchangedRows?: boolean
}

export async function upsertHistoricalRateRow(
  db: D1Database,
  row: NormalizedRateRow,
  options: HistoricalRateWriteOptions = {},
): Promise<RateBatchWriteResult> {
  const verdict = validateNormalizedRow(row)
  if (!verdict.ok) {
    throw new Error(`invalid_normalized_rate_row:${verdict.reason}`)
  }
  assertHistoricalWriteAllowed('home_loans', row)

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

  if (options.emitCanonicalFeed !== false) {
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
  }

  if (options.updateCatalogs !== false) {
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
  }

  if (options.markSeriesSeen !== false) {
    await markSeriesSeen(db, {
      dataset: 'home_loans',
      seriesKey,
      bankName: row.bankName,
      productId: row.productId,
      productCode,
      collectionDate: row.collectionDate,
      runId: row.runId ?? null,
    })
  }

  if (options.upsertLatestSeries !== false) {
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
  }

  if (options.writeProjection !== false) {
    await writeHomeLoanProjection(
      db,
      {
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
      },
      {
        emitChangeFeed: options.emitProjectionChangeFeed !== false,
      },
    )
  }
  return { written: 1, unchanged: 0, skippedSideEffects: 0 }
}

export async function upsertHistoricalRateRows(
  db: D1Database,
  rows: NormalizedRateRow[],
  options: HistoricalRateWriteOptions = {},
): Promise<RateBatchWriteResult> {
  if (rows.length === 0) return emptyWriteResult()
  let inputRows = rows
  let unchanged = 0
  if (options.skipUnchangedRows) {
    const filtered = await filterChangedHomeLoanRows(db, rows)
    inputRows = filtered.changed
    unchanged = filtered.unchanged
    if (inputRows.length === 0) return { written: 0, unchanged, skippedSideEffects: 0 }
  }
  if (shouldUseBatchedHomeLoanFastPath(options)) {
    const fast = await upsertHistoricalRateRowsFastPath(db, inputRows, options)
    fast.unchanged += unchanged
    return fast
  }
  const result = { written: 0, unchanged, skippedSideEffects: 0 }
  for (const row of inputRows) {
    try {
      const rowResult = await upsertHistoricalRateRow(db, row, options)
      addWriteResult(result, rowResult)
    } catch (error) {
      const code = isHistoricalWriteContractError(error) ? 'write_contract_violation' : 'upsert_failed'
      if (isHistoricalWriteContractError(error)) {
        await recordHistoricalWriteContractViolation(db, {
          dataset: 'home_loans',
          row,
          lenderCode: error.lenderCode,
          reason: error.reason,
          seriesKey: homeLoanSeriesKey(row),
        })
      }
      log.error('db', `upsert_failed product=${row.productId} bank=${row.bankName} date=${row.collectionDate}`, {
        code,
        context: (error as Error)?.message || String(error),
        lenderCode: row.bankName,
      })
    }
  }
  return result
}
