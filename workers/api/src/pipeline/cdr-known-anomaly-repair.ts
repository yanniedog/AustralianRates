import { TARGET_LENDERS } from '../constants'
import { emitHistoricalDeleteTombstones, readHistoricalDeleteKeys } from '../db/analytics/admin-tombstones'
import { loadCdrDetailPayloadMap } from '../db/cdr-detail-payloads'
import { upsertHistoricalRateRow } from '../db/historical-rates'
import { upsertLatestHomeLoanSeries, upsertLatestTdSeries } from '../db/latest-series'
import { buildInitialPerLenderSummary, createRunReport, markRunFailed, recordRunQueueOutcome } from '../db/run-reports'
import { upsertTdRateRow } from '../db/td-rates'
import { parseRatesFromDetail } from '../ingest/cdr/mortgage-parse'
import { isRecord, type JsonRecord } from '../ingest/cdr/primitives'
import { parseTermDepositRatesFromDetail } from '../ingest/cdr-savings'
import { validateNormalizedRow, type NormalizedRateRow } from '../ingest/normalize'
import { validateNormalizedTdRow, type NormalizedTdRow } from '../ingest/normalize-savings'
import type { DatasetKind } from '../../../../packages/shared/src/index.js'
import type { LenderConfig } from '../types'
import { homeLoanSeriesKey, legacyProductKey, tdSeriesKey } from '../utils/series-identity'

type RepairDataset = Extract<DatasetKind, 'home_loans' | 'term_deposits'>

type RepairScope = {
  dataset: RepairDataset
  lenderCode: string
  bankName: string
  fromDate: string
  toDate: string
  sourceUrlPrefix?: string
  productIds?: string[]
}

type RepairTarget = {
  dataset: RepairDataset
  lenderCode: string
  bankName: string
  productId: string
  collectionDate: string
  sourceUrl: string
  payloadHash: string
  fetchEventId: number | null
  existingRows: number
  existingSeriesKeys: string[]
}

type PlannedRepairTarget = RepairTarget & {
  parsedRows: NormalizedRateRow[] | NormalizedTdRow[]
  payloadJson: string
}

const HOME_SCOPES: RepairScope[] = [
  {
    dataset: 'home_loans',
    lenderCode: 'great_southern',
    bankName: 'Great Southern Bank',
    fromDate: '2026-03-09',
    toDate: '2026-03-13',
    sourceUrlPrefix: 'https://api.open-banking.greatsouthernbank.com.au/cds-au/v1/banking/products/',
  },
]

const TD_SCOPES: RepairScope[] = [
  {
    dataset: 'term_deposits',
    lenderCode: 'westpac',
    bankName: 'Westpac Banking Corporation',
    fromDate: '2026-03-09',
    toDate: '2026-03-21',
    productIds: ['TDTermDeposit', 'TDBusTermDeposit'],
  },
  {
    dataset: 'term_deposits',
    lenderCode: 'bankofmelbourne',
    bankName: 'Bank of Melbourne',
    fromDate: '2026-03-09',
    toDate: '2026-03-21',
    productIds: ['BOMTDTermDeposit', 'BOMTDBusTermDeposit'],
  },
  {
    dataset: 'term_deposits',
    lenderCode: 'stgeorge',
    bankName: 'St. George Bank',
    fromDate: '2026-03-09',
    toDate: '2026-03-21',
    productIds: ['STGTDTermDeposit', 'STGTDBusTermDeposit'],
  },
]

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function parseStoredDetail(payloadJson: string): JsonRecord {
  const parsed = JSON.parse(payloadJson) as unknown
  if (isRecord(parsed) && isRecord(parsed.data)) return parsed.data
  if (isRecord(parsed)) return parsed
  throw new Error('repair_payload_not_object')
}

function lenderByCode(lenderCode: string): LenderConfig {
  const lender = TARGET_LENDERS.find((candidate) => candidate.code === lenderCode)
  if (!lender) throw new Error(`repair_lender_not_found:${lenderCode}`)
  return lender
}

async function loadTargetSeriesKeys(db: D1Database, target: Omit<RepairTarget, 'existingSeriesKeys'>): Promise<string[]> {
  const table = target.dataset === 'home_loans' ? 'historical_loan_rates' : 'historical_term_deposit_rates'
  const rows = await db
    .prepare(
      `SELECT DISTINCT series_key
       FROM ${table}
       WHERE bank_name = ?1
         AND collection_date = ?2
         AND product_id = ?3
         AND source_url = ?4
         AND data_quality_flag = 'cdr_live'`,
    )
    .bind(target.bankName, target.collectionDate, target.productId, target.sourceUrl)
    .all<{ series_key: string }>()
  return uniqueStrings((rows.results ?? []).map((row) => String(row.series_key || '')))
}

async function loadTargetsForScope(db: D1Database, scope: RepairScope): Promise<RepairTarget[]> {
  const productFilter = scope.productIds?.length
    ? `AND product_id IN (${scope.productIds.map((_value, index) => `?${index + 4}`).join(', ')})`
    : ''
  const sourceFilter = scope.sourceUrlPrefix ? `AND source_url LIKE ?${scope.productIds?.length ? scope.productIds.length + 4 : 4}` : ''
  const binds: Array<string> = [scope.bankName, scope.fromDate, scope.toDate]
  if (scope.productIds?.length) binds.push(...scope.productIds)
  if (scope.sourceUrlPrefix) binds.push(`${scope.sourceUrlPrefix}%`)
  const table = scope.dataset === 'home_loans' ? 'historical_loan_rates' : 'historical_term_deposit_rates'
  const rows = await db
    .prepare(
      `SELECT
         bank_name,
         collection_date,
         product_id,
         MIN(source_url) AS source_url,
         MIN(cdr_product_detail_hash) AS payload_hash,
         MAX(fetch_event_id) AS fetch_event_id,
         COUNT(*) AS existing_rows,
         COUNT(DISTINCT source_url) AS source_count,
         COUNT(DISTINCT cdr_product_detail_hash) AS hash_count
       FROM ${table}
       WHERE bank_name = ?1
         AND collection_date BETWEEN ?2 AND ?3
         AND data_quality_flag = 'cdr_live'
         ${productFilter}
         ${sourceFilter}
       GROUP BY bank_name, collection_date, product_id
       ORDER BY collection_date ASC, product_id ASC`,
    )
    .bind(...binds)
    .all<Record<string, unknown>>()

  const targets: RepairTarget[] = []
  for (const row of rows.results ?? []) {
    const payloadHash = String(row.payload_hash || '').trim()
    const sourceUrl = String(row.source_url || '').trim()
    const sourceCount = Number(row.source_count ?? 0)
    const hashCount = Number(row.hash_count ?? 0)
    if (!payloadHash || !sourceUrl || sourceCount !== 1 || hashCount !== 1) {
      throw new Error(`repair_target_inconsistent:${scope.dataset}:${scope.bankName}:${String(row.product_id || '')}:${String(row.collection_date || '')}`)
    }
    const partialTarget = {
      dataset: scope.dataset,
      lenderCode: scope.lenderCode,
      bankName: scope.bankName,
      productId: String(row.product_id || '').trim(),
      collectionDate: String(row.collection_date || '').trim(),
      sourceUrl,
      payloadHash,
      fetchEventId: row.fetch_event_id == null ? null : Number(row.fetch_event_id),
      existingRows: Number(row.existing_rows ?? 0),
    }
    targets.push({
      ...partialTarget,
      existingSeriesKeys: await loadTargetSeriesKeys(db, partialTarget),
    })
  }

  return targets
}

async function buildPlan(db: D1Database): Promise<PlannedRepairTarget[]> {
  const targets = [
    ...(await Promise.all(HOME_SCOPES.map((scope) => loadTargetsForScope(db, scope)))).flat(),
    ...(await Promise.all(TD_SCOPES.map((scope) => loadTargetsForScope(db, scope)))).flat(),
  ]
  const payloadMap = await loadCdrDetailPayloadMap(db, uniqueStrings(targets.map((target) => target.payloadHash)))

  return targets.map((target) => {
    const lender = lenderByCode(target.lenderCode)
    const payloadJson = payloadMap.get(target.payloadHash)
    if (!payloadJson) throw new Error(`repair_payload_missing:${target.dataset}:${target.productId}:${target.collectionDate}`)
    const detail = parseStoredDetail(payloadJson)
    const parsedRows: NormalizedRateRow[] | NormalizedTdRow[] =
      target.dataset === 'home_loans'
        ? parseRatesFromDetail({
          lender,
          detail,
          sourceUrl: target.sourceUrl,
          collectionDate: target.collectionDate,
        }).map((row) => ({
          ...row,
          cdrProductDetailJson: payloadJson,
          fetchEventId: target.fetchEventId,
        }))
        : parseTermDepositRatesFromDetail({
          lender,
          detail,
          sourceUrl: target.sourceUrl,
          collectionDate: target.collectionDate,
        }).map((row) => ({
          ...row,
          cdrProductDetailJson: payloadJson,
          fetchEventId: target.fetchEventId,
        }))

    if (target.dataset === 'home_loans') {
      for (const row of parsedRows as NormalizedRateRow[]) {
        const verdict = validateNormalizedRow(row)
        if (!verdict.ok) {
          throw new Error(`repair_row_invalid:${target.dataset}:${target.productId}:${target.collectionDate}:${verdict.reason}`)
        }
      }
    } else {
      for (const row of parsedRows as NormalizedTdRow[]) {
        const verdict = validateNormalizedTdRow(row)
        if (!verdict.ok) {
          throw new Error(`repair_row_invalid:${target.dataset}:${target.productId}:${target.collectionDate}:${verdict.reason}`)
        }
      }
    }

    return {
      ...target,
      parsedRows,
      payloadJson,
    }
  })
}

async function deleteHistoricalTarget(db: D1Database, target: PlannedRepairTarget): Promise<number> {
  const table = target.dataset === 'home_loans' ? 'historical_loan_rates' : 'historical_term_deposit_rates'
  const where = `bank_name = ?1 AND collection_date = ?2 AND product_id = ?3 AND source_url = ?4 AND data_quality_flag = 'cdr_live'`
  const binds = [target.bankName, target.collectionDate, target.productId, target.sourceUrl]
  const deletedKeys = await readHistoricalDeleteKeys(db, table, where, binds)
  const deleted = await db.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(...binds).run()
  if (deletedKeys.length > 0) {
    await emitHistoricalDeleteTombstones(db, table, deletedKeys)
  }
  return Number(deleted.meta?.changes ?? 0)
}

async function refreshLatestHomeLoans(db: D1Database, seriesKeys: string[]): Promise<number> {
  let refreshed = 0
  for (const batch of chunkValues(uniqueStrings(seriesKeys), 80)) {
    if (batch.length === 0) continue
    const placeholders = batch.map((_value, index) => `?${index + 1}`).join(', ')
    await db.prepare(`DELETE FROM latest_home_loan_series WHERE series_key IN (${placeholders})`).bind(...batch).run()
    const rows = await db
      .prepare(
        `SELECT *
         FROM historical_loan_rates
         WHERE series_key IN (${placeholders})
         ORDER BY series_key ASC, collection_date DESC, parsed_at DESC`,
      )
      .bind(...batch)
      .all<Record<string, unknown>>()
    const seen = new Set<string>()
    for (const row of rows.results ?? []) {
      const seriesKey = String(row.series_key || '').trim()
      if (!seriesKey || seen.has(seriesKey)) continue
      seen.add(seriesKey)
      await upsertLatestHomeLoanSeries(db, {
        seriesKey,
        productKey: legacyProductKey('home_loans', {
          bankName: String(row.bank_name || ''),
          productId: String(row.product_id || ''),
          securityPurpose: String(row.security_purpose || ''),
          repaymentType: String(row.repayment_type || ''),
          lvrTier: String(row.lvr_tier || ''),
          rateStructure: String(row.rate_structure || ''),
        }),
        bankName: String(row.bank_name || ''),
        collectionDate: String(row.collection_date || ''),
        productId: String(row.product_id || ''),
        productCode: String(row.product_code || row.product_id || ''),
        productName: String(row.product_name || ''),
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
        parsedAt: String(row.parsed_at || ''),
        runId: row.run_id == null ? null : String(row.run_id),
        runSource: String(row.run_source || 'scheduled'),
      })
      refreshed += 1
    }
  }
  return refreshed
}

async function refreshLatestTermDeposits(db: D1Database, seriesKeys: string[]): Promise<number> {
  let refreshed = 0
  for (const batch of chunkValues(uniqueStrings(seriesKeys), 80)) {
    if (batch.length === 0) continue
    const placeholders = batch.map((_value, index) => `?${index + 1}`).join(', ')
    await db.prepare(`DELETE FROM latest_td_series WHERE series_key IN (${placeholders})`).bind(...batch).run()
    const rows = await db
      .prepare(
        `SELECT *
         FROM historical_term_deposit_rates
         WHERE series_key IN (${placeholders})
         ORDER BY series_key ASC, collection_date DESC, parsed_at DESC`,
      )
      .bind(...batch)
      .all<Record<string, unknown>>()
    const seen = new Set<string>()
    for (const row of rows.results ?? []) {
      const seriesKey = String(row.series_key || '').trim()
      if (!seriesKey || seen.has(seriesKey)) continue
      seen.add(seriesKey)
      await upsertLatestTdSeries(db, {
        seriesKey,
        productKey: legacyProductKey('term_deposits', {
          bankName: String(row.bank_name || ''),
          productId: String(row.product_id || ''),
          termMonths: Number(row.term_months ?? 0),
          depositTier: String(row.deposit_tier || ''),
          interestPayment: String(row.interest_payment || ''),
        }),
        bankName: String(row.bank_name || ''),
        collectionDate: String(row.collection_date || ''),
        productId: String(row.product_id || ''),
        productCode: String(row.product_code || row.product_id || ''),
        productName: String(row.product_name || ''),
        termMonths: Number(row.term_months ?? 0),
        interestRate: Number(row.interest_rate ?? 0),
        depositTier: String(row.deposit_tier || ''),
        minDeposit: row.min_deposit == null ? null : Number(row.min_deposit),
        maxDeposit: row.max_deposit == null ? null : Number(row.max_deposit),
        interestPayment: String(row.interest_payment || ''),
        sourceUrl: String(row.source_url || ''),
        productUrl: row.product_url == null ? null : String(row.product_url),
        publishedAt: row.published_at == null ? null : String(row.published_at),
        cdrProductDetailHash: row.cdr_product_detail_hash == null ? null : String(row.cdr_product_detail_hash),
        dataQualityFlag: String(row.data_quality_flag || ''),
        confidenceScore: Number(row.confidence_score ?? 0),
        retrievalType: String(row.retrieval_type || ''),
        parsedAt: String(row.parsed_at || ''),
        runId: row.run_id == null ? null : String(row.run_id),
        runSource: String(row.run_source || 'scheduled'),
      })
      refreshed += 1
    }
  }
  return refreshed
}

async function cleanupOrphanSeriesMetadata(db: D1Database, dataset: RepairDataset, seriesKeys: string[]): Promise<number> {
  const historicalTable = dataset === 'home_loans' ? 'historical_loan_rates' : 'historical_term_deposit_rates'
  let deleted = 0
  for (const batch of chunkValues(uniqueStrings(seriesKeys), 80)) {
    if (batch.length === 0) continue
    const placeholders = batch.map((_value, index) => `?${index + 2}`).join(', ')
    const presence = await db
      .prepare(
        `DELETE FROM series_presence_status
         WHERE dataset_kind = ?1
           AND series_key IN (${placeholders})
           AND NOT EXISTS (
             SELECT 1
             FROM ${historicalTable} historical
             WHERE historical.series_key = series_presence_status.series_key
           )`,
      )
      .bind(dataset, ...batch)
      .run()
    const catalog = await db
      .prepare(
        `DELETE FROM series_catalog
         WHERE dataset_kind = ?1
           AND series_key IN (${placeholders})
           AND NOT EXISTS (
             SELECT 1
             FROM ${historicalTable} historical
             WHERE historical.series_key = series_catalog.series_key
           )`,
      )
      .bind(dataset, ...batch)
      .run()
    deleted += Number(presence.meta?.changes ?? 0) + Number(catalog.meta?.changes ?? 0)
  }
  return deleted
}

export async function previewKnownCdrAnomalyRepair(db: D1Database): Promise<Record<string, unknown>> {
  const plan = await buildPlan(db)
  return {
    ok: true,
    targets: plan.length,
    by_dataset: {
      home_loans: plan.filter((target) => target.dataset === 'home_loans').length,
      term_deposits: plan.filter((target) => target.dataset === 'term_deposits').length,
    },
    existing_rows: plan.reduce((sum, target) => sum + target.existingRows, 0),
    replacement_rows: plan.reduce((sum, target) => sum + target.parsedRows.length, 0),
    sample_targets: plan.slice(0, 20).map((target) => ({
      dataset: target.dataset,
      lender_code: target.lenderCode,
      bank_name: target.bankName,
      collection_date: target.collectionDate,
      product_id: target.productId,
      existing_rows: target.existingRows,
      replacement_rows: target.parsedRows.length,
      existing_series_keys: target.existingSeriesKeys,
    })),
  }
}

export async function applyKnownCdrAnomalyRepair(db: D1Database): Promise<Record<string, unknown>> {
  const plan = await buildPlan(db)
  const lenderCodes = uniqueStrings(plan.map((target) => target.lenderCode))
  const runId = `repair:known-cdr-anomalies:${new Date().toISOString()}`
  await createRunReport(db, {
    runId,
    runType: 'daily',
    runSource: 'manual',
    perLenderSummary: buildInitialPerLenderSummary(Object.fromEntries(lenderCodes.map((code) => [code, 1]))),
  })

  let deletedRows = 0
  let insertedRows = 0
  const homeSeriesKeys: string[] = []
  const tdSeriesKeys: string[] = []

  try {
    for (const target of plan) {
      deletedRows += await deleteHistoricalTarget(db, target)
      if (target.dataset === 'home_loans') {
        homeSeriesKeys.push(...target.existingSeriesKeys)
        for (const row of target.parsedRows as NormalizedRateRow[]) {
          await upsertHistoricalRateRow(db, { ...row, runId, runSource: 'manual' })
          insertedRows += 1
          homeSeriesKeys.push(homeLoanSeriesKey(row))
        }
        continue
      }
      tdSeriesKeys.push(...target.existingSeriesKeys)
      for (const row of target.parsedRows as NormalizedTdRow[]) {
        await upsertTdRateRow(db, { ...row, runId, runSource: 'manual' })
        insertedRows += 1
        tdSeriesKeys.push(tdSeriesKey(row))
      }
    }

    const refreshedHomeLatest = await refreshLatestHomeLoans(db, homeSeriesKeys)
    const refreshedTdLatest = await refreshLatestTermDeposits(db, tdSeriesKeys)
    const deletedHomeMetadata = await cleanupOrphanSeriesMetadata(db, 'home_loans', homeSeriesKeys)
    const deletedTdMetadata = await cleanupOrphanSeriesMetadata(db, 'term_deposits', tdSeriesKeys)

    for (const lenderCode of lenderCodes) {
      await recordRunQueueOutcome(db, { runId, lenderCode, success: true })
    }

    return {
      ok: true,
      run_id: runId,
      targets: plan.length,
      deleted_rows: deletedRows,
      inserted_rows: insertedRows,
      refreshed_latest_rows: {
        home_loans: refreshedHomeLatest,
        term_deposits: refreshedTdLatest,
      },
      deleted_orphan_series_metadata: {
        home_loans: deletedHomeMetadata,
        term_deposits: deletedTdMetadata,
      },
    }
  } catch (error) {
    const message = (error as Error)?.message || String(error)
    await markRunFailed(db, runId, message)
    for (const lenderCode of lenderCodes) {
      await recordRunQueueOutcome(db, { runId, lenderCode, success: false, errorMessage: message })
    }
    throw error
  }
}
