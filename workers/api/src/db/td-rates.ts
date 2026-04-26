import { type NormalizedTdRow, validateNormalizedTdRow } from '../ingest/normalize-savings'
import { log } from '../utils/logger'
import { deriveRetrievalType } from '../utils/retrieval-type'
import { tdDimensionJson, tdSeriesKey, legacyProductKey } from '../utils/series-identity'
import { upsertProductCatalog, upsertSeriesCatalog } from './catalog'
import { emitCanonicalHistoricalUpsert } from './analytics/canonical-feed'
import { writeTdProjection } from './analytics/projection-write'
import { storeCdrDetailPayload } from './cdr-detail-payloads'
import { upsertLatestTdSeries } from './latest-series'
import { markSeriesSeen } from './series-status'
import { nowIso } from '../utils/time'
import {
  assertHistoricalWriteAllowed,
  isHistoricalWriteContractError,
  recordHistoricalWriteContractViolation,
} from './historical-write-guard'
import type { RateBatchWriteResult } from './historical-rates'

const UPSERT_HISTORICAL_TD_RATE_SQL = `INSERT INTO historical_term_deposit_rates (
        bank_name, collection_date, product_id, product_code, product_name,
        series_key, term_months, interest_rate, deposit_tier,
        min_deposit, max_deposit, interest_payment,
        source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score,
        retrieval_type,
        parsed_at, fetch_event_id, run_id, run_source
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)
      ON CONFLICT(bank_name, collection_date, product_id, term_months, deposit_tier, interest_payment) DO UPDATE SET
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
        cdr_product_detail_hash = COALESCE(excluded.cdr_product_detail_hash, historical_term_deposit_rates.cdr_product_detail_hash),
        data_quality_flag = excluded.data_quality_flag,
        confidence_score = excluded.confidence_score,
        retrieval_type = excluded.retrieval_type,
        parsed_at = excluded.parsed_at,
        fetch_event_id = COALESCE(excluded.fetch_event_id, historical_term_deposit_rates.fetch_event_id),
        run_id = excluded.run_id,
        run_source = excluded.run_source`

export type TdRateWriteOptions = {
  emitCanonicalFeed?: boolean
  writeProjection?: boolean
  emitProjectionChangeFeed?: boolean
  updateCatalogs?: boolean
  markSeriesSeen?: boolean
  upsertLatestSeries?: boolean
  skipUnchangedRows?: boolean
}

type PreparedTdRow = {
  row: NormalizedTdRow
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

function tdRowUnchanged(current: Record<string, unknown>, row: NormalizedTdRow): boolean {
  const comparisons: Array<[unknown, unknown]> = [
    [current.product_id, row.productId],
    [current.product_name, row.productName],
    [current.term_months, row.termMonths],
    [current.deposit_tier, row.depositTier],
    [current.interest_payment, row.interestPayment],
    [current.interest_rate, row.interestRate],
    [current.min_deposit, row.minDeposit ?? null],
    [current.max_deposit, row.maxDeposit ?? null],
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

async function filterChangedTdRows(db: D1Database, rows: NormalizedTdRow[]): Promise<{
  changed: NormalizedTdRow[]
  unchanged: number
}> {
  const keyed = rows.map((row) => ({ row, seriesKey: tdSeriesKey(row) }))
  const currentByKey = new Map<string, Record<string, unknown>>()
  for (const part of chunk(Array.from(new Set(keyed.map((item) => item.seriesKey))), 80)) {
    const result = await db
      .prepare(
        `SELECT series_key, product_id, product_name, term_months, deposit_tier, interest_payment,
                interest_rate, min_deposit, max_deposit, is_removed
         FROM latest_td_series
         WHERE series_key IN (${part.map(() => '?').join(',')})`,
      )
      .bind(...part)
      .all<Record<string, unknown>>()
    for (const current of result.results ?? []) currentByKey.set(String(current.series_key || ''), current)
  }
  const changed: NormalizedTdRow[] = []
  let unchanged = 0
  for (const item of keyed) {
    const current = currentByKey.get(item.seriesKey)
    if (current && Number(current.is_removed ?? 0) === 0 && tdRowUnchanged(current, item.row)) unchanged += 1
    else changed.push(item.row)
  }
  return { changed, unchanged }
}

async function prepareTdRow(db: D1Database, row: NormalizedTdRow): Promise<PreparedTdRow> {
  const parsedAt = nowIso()
  const seriesKey = tdSeriesKey(row)
  const productCode = row.productId
  const productKey = legacyProductKey('term_deposits', {
    bankName: row.bankName,
    productId: row.productId,
    termMonths: row.termMonths,
    depositTier: row.depositTier,
    interestPayment: row.interestPayment,
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

function buildHistoricalTdRateStatement(
  db: D1Database,
  prepared: PreparedTdRow,
): D1PreparedStatement {
  const { row, seriesKey, productCode, retrievalType, parsedAt, cdrProductDetailHash } = prepared
  return db
    .prepare(UPSERT_HISTORICAL_TD_RATE_SQL)
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

async function runTdPostWriteSideEffects(
  db: D1Database,
  prepared: PreparedTdRow,
  options: TdRateWriteOptions,
): Promise<void> {
  const { row, seriesKey, productKey, productCode, retrievalType, parsedAt, cdrProductDetailHash } = prepared

  if (options.emitCanonicalFeed !== false) {
    await emitCanonicalHistoricalUpsert(
      db,
      'term_deposits',
      {
        bank_name: row.bankName,
        collection_date: row.collectionDate,
        product_id: row.productId,
        term_months: row.termMonths,
        deposit_tier: row.depositTier,
        interest_payment: row.interestPayment,
        run_source: row.runSource ?? 'scheduled',
      },
      row.runId ?? null,
      row.collectionDate,
    )
  }

  if (options.updateCatalogs !== false) {
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
  }

  if (options.markSeriesSeen !== false) {
    await markSeriesSeen(db, {
      dataset: 'term_deposits',
      seriesKey,
      bankName: row.bankName,
      productId: row.productId,
      productCode,
      collectionDate: row.collectionDate,
      runId: row.runId ?? null,
    })
  }

  if (options.upsertLatestSeries !== false) {
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
    await writeTdProjection(
      db,
      {
        seriesKey,
        productKey,
        bankName: row.bankName,
        productId: row.productId,
        productName: row.productName,
        collectionDate: row.collectionDate,
        parsedAt,
        termMonths: row.termMonths,
        depositTier: row.depositTier,
        interestPayment: row.interestPayment,
        interestRate: row.interestRate,
        minDeposit: row.minDeposit,
        maxDeposit: row.maxDeposit,
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

export async function upsertTdRateRow(
  db: D1Database,
  row: NormalizedTdRow,
  options: TdRateWriteOptions = {},
): Promise<RateBatchWriteResult> {
  const verdict = validateNormalizedTdRow(row)
  if (!verdict.ok) {
    throw new Error(`invalid_td_row:${verdict.reason}`)
  }
  assertHistoricalWriteAllowed('term_deposits', row)

  const prepared = await prepareTdRow(db, row)
  await buildHistoricalTdRateStatement(db, prepared).run()
  await runTdPostWriteSideEffects(db, prepared, options)
  return { written: 1, unchanged: 0, skippedSideEffects: 0 }
}

async function upsertTdRateRowsBatched(
  db: D1Database,
  rows: NormalizedTdRow[],
  options: TdRateWriteOptions,
): Promise<RateBatchWriteResult> {
  const preparedRows = await Promise.all(rows.map((row) => prepareTdRow(db, row)))
  const result = emptyWriteResult()

  for (const part of chunk(preparedRows, 32)) {
    try {
      await db.batch(part.map((prepared) => buildHistoricalTdRateStatement(db, prepared)))
      for (const prepared of part) {
        try {
          await runTdPostWriteSideEffects(db, prepared, options)
          result.written += 1
        } catch (error) {
          const code = isHistoricalWriteContractError(error) ? 'write_contract_violation' : 'upsert_failed'
          if (isHistoricalWriteContractError(error)) {
            await recordHistoricalWriteContractViolation(db, {
              dataset: 'term_deposits',
              row: prepared.row,
              lenderCode: error.lenderCode,
              reason: error.reason,
              seriesKey: prepared.seriesKey,
            })
          }
          log.error('db', `td_upsert_failed product=${prepared.row.productId} bank=${prepared.row.bankName}`, {
            code,
            context: (error as Error)?.message || String(error),
            lenderCode: prepared.row.bankName,
          })
        }
      }
    } catch {
      for (const prepared of part) {
        try {
          const rowResult = await upsertTdRateRow(db, prepared.row, options)
          result.written += rowResult.written
        } catch (error) {
          const code = isHistoricalWriteContractError(error) ? 'write_contract_violation' : 'upsert_failed'
          if (isHistoricalWriteContractError(error)) {
            await recordHistoricalWriteContractViolation(db, {
              dataset: 'term_deposits',
              row: prepared.row,
              lenderCode: error.lenderCode,
              reason: error.reason,
              seriesKey: prepared.seriesKey,
            })
          }
          log.error('db', `td_upsert_failed product=${prepared.row.productId} bank=${prepared.row.bankName}`, {
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

export async function upsertTdRateRows(
  db: D1Database,
  rows: NormalizedTdRow[],
  options: TdRateWriteOptions = {},
): Promise<RateBatchWriteResult> {
  if (rows.length === 0) return emptyWriteResult()
  let inputRows = rows
  let unchanged = 0
  if (options.skipUnchangedRows) {
    const filtered = await filterChangedTdRows(db, rows)
    inputRows = filtered.changed
    unchanged = filtered.unchanged
    if (inputRows.length === 0) return { written: 0, unchanged, skippedSideEffects: 0 }
  }
  const result = await upsertTdRateRowsBatched(db, inputRows, options)
  result.unchanged += unchanged
  return result
}
