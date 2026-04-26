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
import type { RateBatchWriteResult } from './historical-rates'

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
  skipUnchangedRows?: boolean
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

function emptyWriteResult(): RateBatchWriteResult {
  return { written: 0, unchanged: 0, skippedSideEffects: 0 }
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

function savingsRowUnchanged(current: Record<string, unknown>, row: NormalizedSavingsRow): boolean {
  const comparisons: Array<[unknown, unknown]> = [
    [current.product_id, row.productId],
    [current.product_name, row.productName],
    [current.account_type, row.accountType],
    [current.rate_type, row.rateType],
    [current.deposit_tier, row.depositTier],
    [current.interest_rate, row.interestRate],
    [current.min_balance, row.minBalance ?? null],
    [current.max_balance, row.maxBalance ?? null],
    [current.conditions, row.conditions ?? null],
    [current.monthly_fee, row.monthlyFee ?? null],
  ]
  return comparisons.every(([left, right]) => equalStateValue(left, right))
}

function chunk<T>(rows: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size))
  }
  return output
}

async function filterChangedSavingsRows(db: D1Database, rows: NormalizedSavingsRow[]): Promise<{
  changed: NormalizedSavingsRow[]
  unchanged: number
}> {
  const keyed = rows.map((row) => ({ row, seriesKey: savingsSeriesKey(row) }))
  const currentByKey = new Map<string, Record<string, unknown>>()
  for (const part of chunk(Array.from(new Set(keyed.map((item) => item.seriesKey))), 80)) {
    const result = await db
      .prepare(
        `SELECT series_key, product_id, product_name, account_type, rate_type, deposit_tier,
                interest_rate, min_balance, max_balance, conditions, monthly_fee, is_removed
         FROM latest_savings_series
         WHERE series_key IN (${part.map(() => '?').join(',')})`,
      )
      .bind(...part)
      .all<Record<string, unknown>>()
    for (const current of result.results ?? []) currentByKey.set(String(current.series_key || ''), current)
  }
  const changed: NormalizedSavingsRow[] = []
  let unchanged = 0
  for (const item of keyed) {
    const current = currentByKey.get(item.seriesKey)
    if (current && Number(current.is_removed ?? 0) === 0 && savingsRowUnchanged(current, item.row)) unchanged += 1
    else changed.push(item.row)
  }
  return { changed, unchanged }
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
): Promise<RateBatchWriteResult> {
  const verdict = validateNormalizedSavingsRow(row)
  if (!verdict.ok) {
    throw new Error(`invalid_savings_row:${verdict.reason}`)
  }
  assertHistoricalWriteAllowed('savings', row)

  const prepared = await prepareSavingsRow(db, row)
  await buildHistoricalSavingsRateStatement(db, prepared).run()
  await runSavingsPostWriteSideEffects(db, prepared, options)
  return { written: 1, unchanged: 0, skippedSideEffects: 0 }
}

async function upsertSavingsRateRowsBatched(
  db: D1Database,
  rows: NormalizedSavingsRow[],
  options: SavingsRateWriteOptions,
): Promise<RateBatchWriteResult> {
  const preparedRows = await Promise.all(rows.map((row) => prepareSavingsRow(db, row)))
  const result = emptyWriteResult()

  for (const part of chunk(preparedRows, 32)) {
    try {
      await db.batch(part.map((prepared) => buildHistoricalSavingsRateStatement(db, prepared)))
      for (const prepared of part) {
        try {
          await runSavingsPostWriteSideEffects(db, prepared, options)
          result.written += 1
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
          const rowResult = await upsertSavingsRateRow(db, prepared.row, options)
          result.written += rowResult.written
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

  return result
}

export async function upsertSavingsRateRows(
  db: D1Database,
  rows: NormalizedSavingsRow[],
  options: SavingsRateWriteOptions = {},
): Promise<RateBatchWriteResult> {
  if (rows.length === 0) return emptyWriteResult()
  let inputRows = rows
  let unchanged = 0
  if (options.skipUnchangedRows) {
    const filtered = await filterChangedSavingsRows(db, rows)
    inputRows = filtered.changed
    unchanged = filtered.unchanged
    if (inputRows.length === 0) return { written: 0, unchanged, skippedSideEffects: 0 }
  }
  const result = await upsertSavingsRateRowsBatched(db, inputRows, options)
  result.unchanged += unchanged
  return result
}
