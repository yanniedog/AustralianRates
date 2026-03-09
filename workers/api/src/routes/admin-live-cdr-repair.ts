import { Hono } from 'hono'
import type { DatasetKind } from '../../../../packages/shared/src'
import { markRunSeenProduct, markRunSeenSeries } from '../db/catalog'
import { persistFetchEvent } from '../db/fetch-events'
import { upsertHistoricalRateRow } from '../db/historical-rates'
import { ensureLenderDatasetRun, markLenderDatasetDetailProcessed, recordLenderDatasetWriteStats, setLenderDatasetExpectedDetails, tryMarkLenderDatasetFinalized } from '../db/lender-dataset-runs'
import { finalizePresenceForRun } from '../db/presence-finalize'
import { createRunReport, recordRunQueueOutcome } from '../db/run-reports'
import { upsertSavingsRateRow } from '../db/savings-rates'
import { upsertTdRateRow } from '../db/td-rates'
import { validateNormalizedRow, type NormalizedRateRow } from '../ingest/normalize'
import { validateNormalizedSavingsRow, validateNormalizedTdRow, type NormalizedSavingsRow, type NormalizedTdRow } from '../ingest/normalize-savings'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'
import { log } from '../utils/logger'
import { homeLoanSeriesKey, savingsSeriesKey, tdSeriesKey } from '../utils/series-identity'

type RepairBody = {
  lender_code?: unknown
  collection_date?: unknown
  run_id?: unknown
  rows?: {
    home_loans?: unknown
    savings?: unknown
    term_deposits?: unknown
  }
}

type DatasetRows = {
  home_loans: NormalizedRateRow[]
  savings: NormalizedSavingsRow[]
  term_deposits: NormalizedTdRow[]
}

type FetchEventCache = Map<string, number | null>

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDatasetRows(body: RepairBody): DatasetRows {
  const rows = isRecord(body.rows) ? body.rows : {}
  return {
    home_loans: Array.isArray(rows.home_loans) ? (rows.home_loans as NormalizedRateRow[]) : [],
    savings: Array.isArray(rows.savings) ? (rows.savings as NormalizedSavingsRow[]) : [],
    term_deposits: Array.isArray(rows.term_deposits) ? (rows.term_deposits as NormalizedTdRow[]) : [],
  }
}

function buildRunId(lenderCode: string, collectionDate: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `repair:${collectionDate}:${lenderCode}:${suffix}`
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function rowCollectionDate(row: { collectionDate: string }): string {
  return asText(row.collectionDate)
}

function rowBankName(row: { bankName: string }): string {
  return asText(row.bankName)
}

function detailCacheKey(dataset: DatasetKind, row: {
  productId: string
  sourceUrl: string
  cdrProductDetailJson?: string | null
}): string {
  return [dataset, asText(row.productId), asText(row.sourceUrl), asText(row.cdrProductDetailJson)].join('|')
}

async function persistDetailFetchEvent(
  env: AppContext['Bindings'],
  cache: FetchEventCache,
  input: {
    dataset: DatasetKind
    lenderCode: string
    collectionDate: string
    runId: string
    productId: string
    sourceUrl: string
    cdrProductDetailJson: string
  },
): Promise<number | null> {
  const cacheKey = detailCacheKey(input.dataset, input)
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null

  const result = await persistFetchEvent(env, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: input.dataset,
    jobKind: 'product_detail_fetch',
    sourceType:
      input.dataset === 'home_loans'
        ? 'cdr_product_detail'
        : input.dataset === 'savings'
          ? 'cdr_savings_detail'
          : 'cdr_td_detail',
    sourceUrl: input.sourceUrl,
    payload: input.cdrProductDetailJson,
    httpStatus: 200,
    collectionDate: input.collectionDate,
    productId: input.productId,
    notes: `manual_live_cdr_import lender=${input.lenderCode} dataset=${input.dataset}`,
  })

  cache.set(cacheKey, result.fetchEventId)
  return result.fetchEventId
}

async function processHomeDataset(
  env: AppContext['Bindings'],
  rows: NormalizedRateRow[],
  input: { lenderCode: string; runId: string; collectionDate: string },
  fetchCache: FetchEventCache,
): Promise<{ bankName: string; written: number; products: number }> {
  const bankName = rowBankName(rows[0] ?? { bankName: '' })
  const productIds = uniqueStrings(rows.map((row) => asText(row.productId)))
  await ensureLenderDatasetRun(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'home_loans',
    bankName,
    collectionDate: input.collectionDate,
  })
  await setLenderDatasetExpectedDetails(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'home_loans',
    bankName,
    collectionDate: input.collectionDate,
    expectedDetailCount: productIds.length,
  })

  let written = 0
  for (const rawRow of rows) {
    const fetchEventId = await persistDetailFetchEvent(env, fetchCache, {
      dataset: 'home_loans',
      lenderCode: input.lenderCode,
      collectionDate: input.collectionDate,
      runId: input.runId,
      productId: rawRow.productId,
      sourceUrl: rawRow.sourceUrl,
      cdrProductDetailJson: rawRow.cdrProductDetailJson || '',
    })
    const row: NormalizedRateRow = { ...rawRow, fetchEventId, runId: input.runId, runSource: 'manual' }
    await upsertHistoricalRateRow(env.DB, row)
    const seriesKey = homeLoanSeriesKey(row)
    await markRunSeenProduct(env.DB, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'home_loans',
      bankName: row.bankName,
      productId: row.productId,
      productCode: row.productId,
      collectionDate: row.collectionDate,
    })
    await markRunSeenSeries(env.DB, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'home_loans',
      seriesKey,
      bankName: row.bankName,
      productId: row.productId,
      productCode: row.productId,
      collectionDate: row.collectionDate,
    })
    written += 1
  }

  await recordLenderDatasetWriteStats(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'home_loans',
    acceptedRows: rows.length,
    writtenRows: written,
    droppedRows: rows.length - written,
    detailFetchEventCount: productIds.length,
  })
  for (let i = 0; i < productIds.length; i += 1) {
    await markLenderDatasetDetailProcessed(env.DB, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'home_loans',
    })
  }
  await finalizePresenceForRun(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'home_loans',
    bankName,
    collectionDate: input.collectionDate,
  })
  await tryMarkLenderDatasetFinalized(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'home_loans',
  })
  return { bankName, written, products: productIds.length }
}

async function processSavingsDataset(
  env: AppContext['Bindings'],
  rows: NormalizedSavingsRow[],
  input: { lenderCode: string; runId: string; collectionDate: string },
  fetchCache: FetchEventCache,
): Promise<{ bankName: string; written: number; products: number }> {
  const bankName = rowBankName(rows[0] ?? { bankName: '' })
  const productIds = uniqueStrings(rows.map((row) => asText(row.productId)))
  await ensureLenderDatasetRun(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'savings',
    bankName,
    collectionDate: input.collectionDate,
  })
  await setLenderDatasetExpectedDetails(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'savings',
    bankName,
    collectionDate: input.collectionDate,
    expectedDetailCount: productIds.length,
  })

  let written = 0
  for (const rawRow of rows) {
    const fetchEventId = await persistDetailFetchEvent(env, fetchCache, {
      dataset: 'savings',
      lenderCode: input.lenderCode,
      collectionDate: input.collectionDate,
      runId: input.runId,
      productId: rawRow.productId,
      sourceUrl: rawRow.sourceUrl,
      cdrProductDetailJson: rawRow.cdrProductDetailJson || '',
    })
    const row: NormalizedSavingsRow = { ...rawRow, fetchEventId, runId: input.runId, runSource: 'manual' }
    await upsertSavingsRateRow(env.DB, row)
    const seriesKey = savingsSeriesKey(row)
    await markRunSeenProduct(env.DB, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'savings',
      bankName: row.bankName,
      productId: row.productId,
      productCode: row.productId,
      collectionDate: row.collectionDate,
    })
    await markRunSeenSeries(env.DB, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'savings',
      seriesKey,
      bankName: row.bankName,
      productId: row.productId,
      productCode: row.productId,
      collectionDate: row.collectionDate,
    })
    written += 1
  }

  await recordLenderDatasetWriteStats(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'savings',
    acceptedRows: rows.length,
    writtenRows: written,
    droppedRows: rows.length - written,
    detailFetchEventCount: productIds.length,
  })
  for (let i = 0; i < productIds.length; i += 1) {
    await markLenderDatasetDetailProcessed(env.DB, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'savings',
    })
  }
  await finalizePresenceForRun(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'savings',
    bankName,
    collectionDate: input.collectionDate,
  })
  await tryMarkLenderDatasetFinalized(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'savings',
  })
  return { bankName, written, products: productIds.length }
}

async function processTdDataset(
  env: AppContext['Bindings'],
  rows: NormalizedTdRow[],
  input: { lenderCode: string; runId: string; collectionDate: string },
  fetchCache: FetchEventCache,
): Promise<{ bankName: string; written: number; products: number }> {
  const bankName = rowBankName(rows[0] ?? { bankName: '' })
  const productIds = uniqueStrings(rows.map((row) => asText(row.productId)))
  await ensureLenderDatasetRun(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'term_deposits',
    bankName,
    collectionDate: input.collectionDate,
  })
  await setLenderDatasetExpectedDetails(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'term_deposits',
    bankName,
    collectionDate: input.collectionDate,
    expectedDetailCount: productIds.length,
  })

  let written = 0
  for (const rawRow of rows) {
    const fetchEventId = await persistDetailFetchEvent(env, fetchCache, {
      dataset: 'term_deposits',
      lenderCode: input.lenderCode,
      collectionDate: input.collectionDate,
      runId: input.runId,
      productId: rawRow.productId,
      sourceUrl: rawRow.sourceUrl,
      cdrProductDetailJson: rawRow.cdrProductDetailJson || '',
    })
    const row: NormalizedTdRow = { ...rawRow, fetchEventId, runId: input.runId, runSource: 'manual' }
    await upsertTdRateRow(env.DB, row)
    const seriesKey = tdSeriesKey(row)
    await markRunSeenProduct(env.DB, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'term_deposits',
      bankName: row.bankName,
      productId: row.productId,
      productCode: row.productId,
      collectionDate: row.collectionDate,
    })
    await markRunSeenSeries(env.DB, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'term_deposits',
      seriesKey,
      bankName: row.bankName,
      productId: row.productId,
      productCode: row.productId,
      collectionDate: row.collectionDate,
    })
    written += 1
  }

  await recordLenderDatasetWriteStats(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'term_deposits',
    acceptedRows: rows.length,
    writtenRows: written,
    droppedRows: rows.length - written,
    detailFetchEventCount: productIds.length,
  })
  for (let i = 0; i < productIds.length; i += 1) {
    await markLenderDatasetDetailProcessed(env.DB, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'term_deposits',
    })
  }
  await finalizePresenceForRun(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'term_deposits',
    bankName,
    collectionDate: input.collectionDate,
  })
  await tryMarkLenderDatasetFinalized(env.DB, {
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: 'term_deposits',
  })
  return { bankName, written, products: productIds.length }
}

export const adminLiveCdrRepairRoutes = new Hono<AppContext>()

adminLiveCdrRepairRoutes.post('/repairs/live-cdr-import', async (c) => {
  const body = (await c.req.json<RepairBody>().catch(() => ({}))) as RepairBody
  const lenderCode = asText(body.lender_code)
  const datasetRows = parseDatasetRows(body)
  const allRows = [...datasetRows.home_loans, ...datasetRows.savings, ...datasetRows.term_deposits]
  const collectionDate = asText(body.collection_date) || rowCollectionDate(allRows[0] ?? { collectionDate: '' })

  if (!lenderCode) return jsonError(c, 400, 'INVALID_REQUEST', 'lender_code is required.')
  if (!collectionDate) return jsonError(c, 400, 'INVALID_REQUEST', 'collection_date is required.')
  if (allRows.length === 0) return jsonError(c, 400, 'INVALID_REQUEST', 'At least one dataset row is required.')

  const dates = uniqueStrings(allRows.map((row) => rowCollectionDate(row)))
  if (dates.length > 1) return jsonError(c, 400, 'INVALID_REQUEST', `repair_import_mixed_collection_dates:${dates.join(',')}`)
  if (dates[0] !== collectionDate) {
    return jsonError(c, 400, 'INVALID_REQUEST', `repair_import_collection_date_mismatch:${dates[0]}!=${collectionDate}`)
  }

  const bankNames = uniqueStrings(allRows.map((row) => rowBankName(row)))
  if (bankNames.length > 1) return jsonError(c, 400, 'INVALID_REQUEST', `repair_import_mixed_bank_names:${bankNames.join(',')}`)

  for (const row of datasetRows.home_loans) {
    if (!row.cdrProductDetailJson) return jsonError(c, 400, 'INVALID_REQUEST', `missing_cdr_product_detail_json:${row.productId}`)
    const verdict = validateNormalizedRow(row)
    if (!verdict.ok) return jsonError(c, 400, 'INVALID_REQUEST', `invalid_home_row:${row.productId}:${verdict.reason}`)
  }
  for (const row of datasetRows.savings) {
    if (!row.cdrProductDetailJson) return jsonError(c, 400, 'INVALID_REQUEST', `missing_cdr_product_detail_json:${row.productId}`)
    const verdict = validateNormalizedSavingsRow(row)
    if (!verdict.ok) return jsonError(c, 400, 'INVALID_REQUEST', `invalid_savings_row:${row.productId}:${verdict.reason}`)
  }
  for (const row of datasetRows.term_deposits) {
    if (!row.cdrProductDetailJson) return jsonError(c, 400, 'INVALID_REQUEST', `missing_cdr_product_detail_json:${row.productId}`)
    const verdict = validateNormalizedTdRow(row)
    if (!verdict.ok) return jsonError(c, 400, 'INVALID_REQUEST', `invalid_td_row:${row.productId}:${verdict.reason}`)
  }

  const touchedDatasets =
    (datasetRows.home_loans.length ? 1 : 0) +
    (datasetRows.savings.length ? 1 : 0) +
    (datasetRows.term_deposits.length ? 1 : 0)
  const runId = asText(body.run_id) || buildRunId(lenderCode, collectionDate)
  const perLenderSummary = {
    _meta: {
      enqueued_total: touchedDatasets,
      processed_total: 0,
      failed_total: 0,
      updated_at: new Date().toISOString(),
    },
    [lenderCode]: {
      enqueued: touchedDatasets,
      processed: 0,
      failed: 0,
      updated_at: new Date().toISOString(),
    },
  }

  await createRunReport(c.env.DB, {
    runId,
    runType: 'daily',
    runSource: 'manual',
    perLenderSummary,
  })

  const fetchCache: FetchEventCache = new Map()
  const summary: {
    run_id: string
    lender_code: string
    collection_date: string
    datasets: Record<string, unknown>
  } = {
    run_id: runId,
    lender_code: lenderCode,
    collection_date: collectionDate,
    datasets: {},
  }

  try {
    if (datasetRows.home_loans.length > 0) {
      const result = await processHomeDataset(c.env, datasetRows.home_loans, { lenderCode, runId, collectionDate }, fetchCache)
      await recordRunQueueOutcome(c.env.DB, { runId, lenderCode, success: true })
      summary.datasets = { ...summary.datasets, home_loans: result }
    }
    if (datasetRows.savings.length > 0) {
      const result = await processSavingsDataset(c.env, datasetRows.savings, { lenderCode, runId, collectionDate }, fetchCache)
      await recordRunQueueOutcome(c.env.DB, { runId, lenderCode, success: true })
      summary.datasets = { ...summary.datasets, savings: result }
    }
    if (datasetRows.term_deposits.length > 0) {
      const result = await processTdDataset(c.env, datasetRows.term_deposits, { lenderCode, runId, collectionDate }, fetchCache)
      await recordRunQueueOutcome(c.env.DB, { runId, lenderCode, success: true })
      summary.datasets = { ...summary.datasets, term_deposits: result }
    }
  } catch (error) {
    const message = (error as Error)?.message || String(error)
    await recordRunQueueOutcome(c.env.DB, { runId, lenderCode, success: false, errorMessage: message })
    log.error('admin', 'live_cdr_import_failed', {
      runId,
      lenderCode,
      context: message,
    })
    return jsonError(c, 500, 'LIVE_CDR_IMPORT_FAILED', message)
  }

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    summary,
  })
})
