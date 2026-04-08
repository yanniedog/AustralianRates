import { type NormalizedSavingsRow, validateNormalizedSavingsRow } from '../ingest/normalize-savings'
import { log } from '../utils/logger'
import { deriveRetrievalType } from '../utils/retrieval-type'
import { savingsDimensionJson, savingsSeriesKey, legacyProductKey } from '../utils/series-identity'
import { upsertProductCatalog, upsertSeriesCatalog } from './catalog'
import { emitCanonicalHistoricalUpsert } from './analytics/canonical-feed'
import { writeSavingsProjection } from './analytics/projection-write'
import { storeCdrDetailPayload } from './cdr-detail-payloads'
import { upsertLatestSavingsSeries } from './latest-series'
import { markSeriesSeen } from './series-status'
import { nowIso } from '../utils/time'
import {
  assertHistoricalWriteAllowed,
  isHistoricalWriteContractError,
  recordHistoricalWriteContractViolation,
} from './historical-write-guard'

const UPSERT_HISTORICAL_SAVINGS_RATE_SQL = `INSERT INTO historical_savings_rates (
        bank_name, collection_date, product_id, product_code, product_name,
        series_key, account_type, rate_type, interest_rate, deposit_tier,
        min_balance, max_balance, conditions, monthly_fee,
        source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score,
        retrieval_type,
        parsed_at, fetch_event_id, run_id, run_source
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)
      ON CONFLICT(bank_name, collection_date, product_id, account_type, rate_type, deposit_tier) DO UPDATE SET
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
        cdr_product_detail_hash = COALESCE(excluded.cdr_product_detail_hash, historical_savings_rates.cdr_product_detail_hash),
        data_quality_flag = excluded.data_quality_flag,
        confidence_score = excluded.confidence_score,
        retrieval_type = excluded.retrieval_type,
        parsed_at = excluded.parsed_at,
        fetch_event_id = COALESCE(excluded.fetch_event_id, historical_savings_rates.fetch_event_id),
        run_id = excluded.run_id,
        run_source = excluded.run_source`

export type SavingsRateWriteOptions = {
  emitCanonicalFeed?: boolean
  writeProjection?: boolean
  emitProjectionChangeFeed?: boolean
  updateCatalogs?: boolean
  markSeriesSeen?: boolean
  upsertLatestSeries?: boolean
}

type PreparedSavingsRow = {
  row: NormalizedSavingsRow
  seriesKey: string
  productKey: string
  productCode: string
  retrievalType: string
  parsedAt: string
  cdrProductDetailHash: string | null
}

function chunk<T>(rows: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size))
  }
  return output
}

async function prepareSavingsRow(db: D1Database, row: NormalizedSavingsRow): Promise<PreparedSavingsRow> {
  const parsedAt = nowIso()
  const seriesKey = savingsSeriesKey(row)
  const productCode = row.productId
  const productKey = legacyProductKey('savings', {
    bankName: row.bankName,
    productId: row.productId,
    accountType: row.accountType,
    rateType: row.rateType,
    depositTier: row.depositTier,
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

function buildHistoricalSavingsRateStatement(
  db: D1Database,
  prepared: PreparedSavingsRow,
): D1PreparedStatement {
  const { row, seriesKey, productCode, retrievalType, parsedAt, cdrProductDetailHash } = prepared
  return db
    .prepare(UPSERT_HISTORICAL_SAVINGS_RATE_SQL)
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

async function runSavingsPostWriteSideEffects(
  db: D1Database,
  prepared: PreparedSavingsRow,
  options: SavingsRateWriteOptions,
): Promise<void> {
  const { row, seriesKey, productKey, productCode, retrievalType, parsedAt, cdrProductDetailHash } = prepared

  if (options.emitCanonicalFeed !== false) {
    await emitCanonicalHistoricalUpsert(
      db,
      'savings',
      {
        bank_name: row.bankName,
        collection_date: row.collectionDate,
        product_id: row.productId,
        account_type: row.accountType,
        rate_type: row.rateType,
        deposit_tier: row.depositTier,
        run_source: row.runSource ?? 'scheduled',
      },
      row.runId ?? null,
      row.collectionDate,
    )
  }

  if (options.updateCatalogs !== false) {
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
  }

  if (options.markSeriesSeen !== false) {
    await markSeriesSeen(db, {
      dataset: 'savings',
      seriesKey,
      bankName: row.bankName,
      productId: row.productId,
      productCode,
      collectionDate: row.collectionDate,
      runId: row.runId ?? null,
    })
  }

  if (options.upsertLatestSeries !== false) {
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
    await writeSavingsProjection(
      db,
      {
        seriesKey,
        productKey,
        bankName: row.bankName,
        productId: row.productId,
        productName: row.productName,
        collectionDate: row.collectionDate,
        parsedAt,
        accountType: row.accountType,
        rateType: row.rateType,
        depositTier: row.depositTier,
        interestRate: row.interestRate,
        minBalance: row.minBalance,
        maxBalance: row.maxBalance,
        conditions: row.conditions,
        monthlyFee: row.monthlyFee,
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
}

export async function upsertSavingsRateRow(
  db: D1Database,
  row: NormalizedSavingsRow,
  options: SavingsRateWriteOptions = {},
): Promise<void> {
  const verdict = validateNormalizedSavingsRow(row)
  if (!verdict.ok) {
    throw new Error(`invalid_savings_row:${verdict.reason}`)
  }
  assertHistoricalWriteAllowed('savings', row)

  const prepared = await prepareSavingsRow(db, row)
  await buildHistoricalSavingsRateStatement(db, prepared).run()
  await runSavingsPostWriteSideEffects(db, prepared, options)
}

async function upsertSavingsRateRowsBatched(
  db: D1Database,
  rows: NormalizedSavingsRow[],
  options: SavingsRateWriteOptions,
): Promise<number> {
  const preparedRows = await Promise.all(rows.map((row) => prepareSavingsRow(db, row)))
  let written = 0

  for (const part of chunk(preparedRows, 32)) {
    try {
      await db.batch(part.map((prepared) => buildHistoricalSavingsRateStatement(db, prepared)))
      for (const prepared of part) {
        try {
          await runSavingsPostWriteSideEffects(db, prepared, options)
          written += 1
        } catch (error) {
          const code = isHistoricalWriteContractError(error) ? 'write_contract_violation' : 'upsert_failed'
          if (isHistoricalWriteContractError(error)) {
            await recordHistoricalWriteContractViolation(db, {
              dataset: 'savings',
              row: prepared.row,
              lenderCode: error.lenderCode,
              reason: error.reason,
              seriesKey: prepared.seriesKey,
            })
          }
          log.error('db', `savings_upsert_failed product=${prepared.row.productId} bank=${prepared.row.bankName}`, {
            code,
            context: (error as Error)?.message || String(error),
            lenderCode: prepared.row.bankName,
          })
        }
      }
    } catch {
      for (const prepared of part) {
        try {
          await upsertSavingsRateRow(db, prepared.row, options)
          written += 1
        } catch (error) {
          const code = isHistoricalWriteContractError(error) ? 'write_contract_violation' : 'upsert_failed'
          if (isHistoricalWriteContractError(error)) {
            await recordHistoricalWriteContractViolation(db, {
              dataset: 'savings',
              row: prepared.row,
              lenderCode: error.lenderCode,
              reason: error.reason,
              seriesKey: prepared.seriesKey,
            })
          }
          log.error('db', `savings_upsert_failed product=${prepared.row.productId} bank=${prepared.row.bankName}`, {
            code,
            context: (error as Error)?.message || String(error),
            lenderCode: prepared.row.bankName,
          })
        }
      }
    }
  }

  return written
}

export async function upsertSavingsRateRows(
  db: D1Database,
  rows: NormalizedSavingsRow[],
  options: SavingsRateWriteOptions = {},
): Promise<number> {
  if (rows.length === 0) return 0
  return upsertSavingsRateRowsBatched(db, rows, options)
}
