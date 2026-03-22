import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { gzipDecompressToText } from '../../../../workers/api/src/utils/compression'
import { stableStringify } from '../../../../workers/api/src/utils/hash'
import { TARGET_LENDERS } from '../../../../workers/api/src/constants'
import { parseRatesFromDetail } from '../../../../workers/api/src/ingest/cdr/mortgage-parse'
import { parseTermDepositRatesFromDetail } from '../../../../workers/api/src/ingest/cdr-savings'
import { isRecord, type JsonRecord } from '../../../../workers/api/src/ingest/cdr/primitives'
import { validateNormalizedRow, type NormalizedRateRow } from '../../../../workers/api/src/ingest/normalize'
import { validateNormalizedTdRow, type NormalizedTdRow } from '../../../../workers/api/src/ingest/normalize-savings'
import { homeLoanDimensionJson, homeLoanSeriesKey, tdDimensionJson, tdSeriesKey } from '../../../../workers/api/src/utils/series-identity'
import type { LenderConfig } from '../../../../workers/api/src/types'
import { executeRemoteSqlCommandForTest, executeRemoteSqlFileForTest } from './repair-presence-prod'

const DB_NAME = 'australianrates_api'

type Dataset = 'home_loans' | 'term_deposits'

type Scope = {
  dataset: Dataset
  lenderCode: string
  bankName: string
  fromDate: string
  toDate: string
  productIds?: string[]
  sourceUrlPrefix?: string
}

type ExistingKey = Record<string, unknown>

type Target = {
  dataset: Dataset
  lenderCode: string
  bankName: string
  productId: string
  collectionDate: string
  sourceUrl: string
  payloadHash: string
  fetchEventId: number | null
  existingRows: number
  existingSeriesKeys: string[]
  deletedKeys: ExistingKey[]
}

type SliceCandidate = {
  sourceUrl: string
  payloadHash: string
  fetchEventId: number | null
  rowCount: number
  scheduledRowCount: number
  manualRowCount: number
  latestParsedAt: string
}

type PlannedTarget = Target & {
  payloadJson: string
  parsedRows: NormalizedRateRow[] | NormalizedTdRow[]
}

const HOME_SCOPES: Scope[] = [
  {
    dataset: 'home_loans',
    lenderCode: 'great_southern',
    bankName: 'Great Southern Bank',
    fromDate: '2026-03-09',
    toDate: '2026-03-13',
    sourceUrlPrefix: 'https://api.open-banking.greatsouthernbank.com.au/cds-au/v1/banking/products/',
  },
]

const TD_SCOPES: Scope[] = [
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

function sqlString(value: unknown): string {
  return `'${String(value ?? '').replace(/'/g, "''")}'`
}

function sqlNumber(value: number | null | undefined): string {
  return value == null ? 'NULL' : Number.isFinite(value) ? String(value) : 'NULL'
}

function sqlBoolean(value: boolean | null | undefined): string {
  if (value == null) return 'NULL'
  return value ? '1' : '0'
}

function sqlNullableText(value: unknown): string {
  return value == null || String(value) === '' ? 'NULL' : sqlString(value)
}

function resultRows(result: ReturnType<typeof executeRemoteSqlCommandForTest>): Array<Record<string, unknown>> {
  return (result.payload[0]?.results ?? []) as Array<Record<string, unknown>>
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function normalizedText(value: unknown): string {
  return String(value || '').trim()
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size))
  return chunks
}

function requireBackupArtifact(pathValue: string | undefined): string {
  const resolved = String(pathValue || '').trim()
  if (!resolved) throw new Error('--backup-artifact is required')
  if (!fs.existsSync(resolved)) throw new Error(`backup artifact not found: ${resolved}`)
  return resolved
}

function parseArgs(argv: string[]): { apply: boolean; backupArtifact?: string } {
  const apply = argv.includes('--apply')
  const backupIndex = argv.indexOf('--backup-artifact')
  return {
    apply,
    backupArtifact: backupIndex >= 0 ? argv[backupIndex + 1] : undefined,
  }
}

function lenderByCode(code: string): LenderConfig {
  const lender = TARGET_LENDERS.find((candidate) => candidate.code === code)
  if (!lender) throw new Error(`unknown lender code: ${code}`)
  return lender
}

function parseStoredDetail(payloadJson: string): JsonRecord {
  const parsed = JSON.parse(payloadJson) as unknown
  if (isRecord(parsed) && isRecord(parsed.data)) return parsed.data
  if (isRecord(parsed)) return parsed
  throw new Error('payload detail is not a JSON object')
}

function gzipHexToText(hex: string): Promise<string> {
  const bytes = new Uint8Array(Buffer.from(hex, 'hex'))
  return gzipDecompressToText(bytes)
}

function choosePreferredCandidate(candidates: SliceCandidate[], sliceLabel: string): SliceCandidate {
  if (candidates.length === 0) throw new Error(`missing payload candidate for ${sliceLabel}`)
  const preferred = [...candidates].sort((left, right) => {
    const scheduledBias = Number(right.scheduledRowCount > 0) - Number(left.scheduledRowCount > 0)
    if (scheduledBias !== 0) return scheduledBias
    if (right.rowCount !== left.rowCount) return right.rowCount - left.rowCount
    const parsedAtComparison = normalizedText(right.latestParsedAt).localeCompare(normalizedText(left.latestParsedAt))
    if (parsedAtComparison !== 0) return parsedAtComparison
    if (right.manualRowCount !== left.manualRowCount) return right.manualRowCount - left.manualRowCount
    const sourceUrlComparison = normalizedText(left.sourceUrl).localeCompare(normalizedText(right.sourceUrl))
    if (sourceUrlComparison !== 0) return sourceUrlComparison
    return normalizedText(left.payloadHash).localeCompare(normalizedText(right.payloadHash))
  })[0]
  return preferred
}

function listScopeTargets(scope: Scope): Target[] {
  const table = scope.dataset === 'home_loans' ? 'historical_loan_rates' : 'historical_term_deposit_rates'
  const productFilter = scope.productIds?.length
    ? `AND product_id IN (${scope.productIds.map(sqlString).join(', ')})`
    : ''
  const sourceFilter = scope.sourceUrlPrefix
    ? `AND substr(source_url, 1, ${scope.sourceUrlPrefix.length}) = ${sqlString(scope.sourceUrlPrefix)}`
    : ''
  const rows = resultRows(executeRemoteSqlCommandForTest(
    DB_NAME,
    `SELECT
       bank_name,
       collection_date,
       product_id,
       source_url,
       cdr_product_detail_hash AS payload_hash,
       MAX(fetch_event_id) AS fetch_event_id,
       COUNT(*) AS row_count,
       SUM(CASE WHEN run_source = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_row_count,
       SUM(CASE WHEN run_source = 'manual' THEN 1 ELSE 0 END) AS manual_row_count,
       MAX(parsed_at) AS latest_parsed_at
     FROM ${table}
     WHERE bank_name = ${sqlString(scope.bankName)}
       AND collection_date BETWEEN ${sqlString(scope.fromDate)} AND ${sqlString(scope.toDate)}
       AND data_quality_flag = 'cdr_live'
       ${productFilter}
       ${sourceFilter}
     GROUP BY bank_name, collection_date, product_id, source_url, cdr_product_detail_hash
     ORDER BY collection_date ASC, product_id ASC, source_url ASC, cdr_product_detail_hash ASC`,
    spawnSync,
  ))

  const keyRows = resultRows(executeRemoteSqlCommandForTest(
    DB_NAME,
    scope.dataset === 'home_loans'
      ? `SELECT bank_name, collection_date, product_id, source_url, lvr_tier, rate_structure, security_purpose, repayment_type, run_source, run_id, series_key
         FROM historical_loan_rates
         WHERE bank_name = ${sqlString(scope.bankName)}
           AND collection_date BETWEEN ${sqlString(scope.fromDate)} AND ${sqlString(scope.toDate)}
           AND data_quality_flag = 'cdr_live'
           ${productFilter}
           ${sourceFilter}`
      : `SELECT bank_name, collection_date, product_id, source_url, term_months, deposit_tier, interest_payment, run_source, run_id, series_key
         FROM historical_term_deposit_rates
         WHERE bank_name = ${sqlString(scope.bankName)}
           AND collection_date BETWEEN ${sqlString(scope.fromDate)} AND ${sqlString(scope.toDate)}
           AND data_quality_flag = 'cdr_live'
           ${productFilter}
           ${sourceFilter}`,
    spawnSync,
  ))
  const keysBySlice = new Map<string, ExistingKey[]>()
  for (const keyRow of keyRows) {
    const sliceKey = [normalizedText(keyRow.bank_name), normalizedText(keyRow.collection_date), normalizedText(keyRow.product_id)].join('|')
    const existing = keysBySlice.get(sliceKey) ?? []
    existing.push(keyRow)
    keysBySlice.set(sliceKey, existing)
  }

  const candidatesBySlice = new Map<string, { bankName: string; collectionDate: string; productId: string; candidates: SliceCandidate[] }>()
  for (const row of rows) {
    const bankName = normalizedText(row.bank_name)
    const collectionDate = normalizedText(row.collection_date)
    const productId = normalizedText(row.product_id)
    const sliceKey = [bankName, collectionDate, productId].join('|')
    const existing = candidatesBySlice.get(sliceKey) ?? {
      bankName,
      collectionDate,
      productId,
      candidates: [],
    }
    existing.candidates.push({
      sourceUrl: normalizedText(row.source_url),
      payloadHash: normalizedText(row.payload_hash),
      fetchEventId: row.fetch_event_id == null ? null : Number(row.fetch_event_id),
      rowCount: Number(row.row_count ?? 0),
      scheduledRowCount: Number(row.scheduled_row_count ?? 0),
      manualRowCount: Number(row.manual_row_count ?? 0),
      latestParsedAt: normalizedText(row.latest_parsed_at),
    })
    candidatesBySlice.set(sliceKey, existing)
  }

  return Array.from(candidatesBySlice.values())
    .sort((left, right) => {
      const dateComparison = left.collectionDate.localeCompare(right.collectionDate)
      if (dateComparison !== 0) return dateComparison
      return left.productId.localeCompare(right.productId)
    })
    .map((slice) => {
      const selected = choosePreferredCandidate(
        slice.candidates,
        `${scope.dataset}:${slice.bankName}:${slice.productId}:${slice.collectionDate}`,
      )
      const deletedKeys = keysBySlice.get([slice.bankName, slice.collectionDate, slice.productId].join('|')) ?? []
      return {
        dataset: scope.dataset,
        lenderCode: scope.lenderCode,
        bankName: slice.bankName,
        productId: slice.productId,
        collectionDate: slice.collectionDate,
        sourceUrl: selected.sourceUrl,
        payloadHash: selected.payloadHash,
        fetchEventId: selected.fetchEventId,
        existingRows: deletedKeys.length,
        existingSeriesKeys: uniqueStrings(deletedKeys.map((key) => String(key.series_key || ''))),
        deletedKeys,
      }
    })
}

async function buildPlan(): Promise<PlannedTarget[]> {
  const targets = [...HOME_SCOPES.flatMap(listScopeTargets), ...TD_SCOPES.flatMap(listScopeTargets)]
  const hashes = uniqueStrings(targets.map((target) => target.payloadHash))
  const payloadRows = resultRows(executeRemoteSqlCommandForTest(
    DB_NAME,
    `SELECT payload_hash, hex(payload_blob) AS payload_hex
     FROM cdr_detail_payload_store
     WHERE payload_hash IN (${hashes.map(sqlString).join(', ')})`,
    spawnSync,
  ))
  const payloadMap = new Map<string, string>()
  for (const row of payloadRows) {
    payloadMap.set(String(row.payload_hash || '').trim(), await gzipHexToText(String(row.payload_hex || '').trim()))
  }

  return targets.map((target) => {
    const payloadJson = payloadMap.get(target.payloadHash)
    if (!payloadJson) throw new Error(`missing payload JSON for ${target.dataset}:${target.productId}:${target.collectionDate}`)
    const lender = lenderByCode(target.lenderCode)
    const detail = parseStoredDetail(payloadJson)
    const parsedRows =
      target.dataset === 'home_loans'
        ? parseRatesFromDetail({ lender, detail, sourceUrl: target.sourceUrl, collectionDate: target.collectionDate }).map((row) => ({
          ...row,
          fetchEventId: target.fetchEventId,
        }))
        : parseTermDepositRatesFromDetail({ lender, detail, sourceUrl: target.sourceUrl, collectionDate: target.collectionDate }).map((row) => ({
          ...row,
          fetchEventId: target.fetchEventId,
        }))
    if (target.dataset === 'home_loans') {
      for (const row of parsedRows as NormalizedRateRow[]) {
        const verdict = validateNormalizedRow(row)
        if (!verdict.ok) throw new Error(`invalid repaired home row: ${target.productId}:${verdict.reason}`)
      }
    } else {
      for (const row of parsedRows as NormalizedTdRow[]) {
        const verdict = validateNormalizedTdRow(row)
        if (!verdict.ok) throw new Error(`invalid repaired td row: ${target.productId}:${verdict.reason}`)
      }
    }
    return { ...target, payloadJson, parsedRows }
  })
}

function historicalHomeUpsertSql(row: NormalizedRateRow, payloadHash: string, runId: string, parsedAt: string): string {
  const seriesKey = homeLoanSeriesKey(row)
  return `INSERT INTO historical_loan_rates (
    bank_name, collection_date, product_id, product_code, product_name, series_key, security_purpose, repayment_type, rate_structure, lvr_tier,
    feature_set, has_offset_account, interest_rate, comparison_rate, annual_fee, source_url, product_url, published_at, cdr_product_detail_hash,
    data_quality_flag, confidence_score, retrieval_type, parsed_at, fetch_event_id, run_id, run_source
  ) VALUES (
    ${sqlString(row.bankName)}, ${sqlString(row.collectionDate)}, ${sqlString(row.productId)}, ${sqlString(row.productId)}, ${sqlString(row.productName)}, ${sqlString(seriesKey)},
    ${sqlString(row.securityPurpose)}, ${sqlString(row.repaymentType)}, ${sqlString(row.rateStructure)}, ${sqlString(row.lvrTier)},
    ${sqlString(row.featureSet)}, ${sqlBoolean(row.hasOffsetAccount ?? null)}, ${sqlNumber(row.interestRate)}, ${sqlNumber(row.comparisonRate)}, ${sqlNumber(row.annualFee)},
    ${sqlString(row.sourceUrl)}, ${sqlString(row.productUrl ?? row.sourceUrl)}, ${sqlNullableText(row.publishedAt)}, ${sqlString(payloadHash)},
    ${sqlString(row.dataQualityFlag)}, ${sqlNumber(row.confidenceScore)}, ${sqlString(row.retrievalType ?? 'present_scrape_same_date')}, ${sqlString(parsedAt)},
    ${sqlNumber(row.fetchEventId)}, ${sqlString(runId)}, 'manual'
  )
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
    run_source = excluded.run_source;`
}

function historicalTdUpsertSql(row: NormalizedTdRow, payloadHash: string, runId: string, parsedAt: string): string {
  const seriesKey = tdSeriesKey(row)
  return `INSERT INTO historical_term_deposit_rates (
    bank_name, collection_date, product_id, product_code, product_name, series_key, term_months, interest_rate, deposit_tier,
    min_deposit, max_deposit, interest_payment, source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag,
    confidence_score, retrieval_type, parsed_at, fetch_event_id, run_id, run_source
  ) VALUES (
    ${sqlString(row.bankName)}, ${sqlString(row.collectionDate)}, ${sqlString(row.productId)}, ${sqlString(row.productId)}, ${sqlString(row.productName)},
    ${sqlString(seriesKey)}, ${sqlNumber(row.termMonths)}, ${sqlNumber(row.interestRate)}, ${sqlString(row.depositTier)},
    ${sqlNumber(row.minDeposit)}, ${sqlNumber(row.maxDeposit)}, ${sqlString(row.interestPayment)}, ${sqlString(row.sourceUrl)}, ${sqlString(row.productUrl ?? row.sourceUrl)},
    ${sqlNullableText(row.publishedAt)}, ${sqlString(payloadHash)}, ${sqlString(row.dataQualityFlag)}, ${sqlNumber(row.confidenceScore)},
    ${sqlString(row.retrievalType ?? 'present_scrape_same_date')}, ${sqlString(parsedAt)}, ${sqlNumber(row.fetchEventId)}, ${sqlString(runId)}, 'manual'
  )
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
    run_source = excluded.run_source;`
}

function changeFeedSql(input: {
  dataset: Dataset
  tableName: string
  entityKey: Record<string, unknown>
  op: 'upsert' | 'tombstone'
  runId?: string | null
  collectionDate: string
}): string {
  return `INSERT INTO download_change_feed (stream, dataset_kind, table_name, entity_key_json, op, run_id, collection_date)
  VALUES ('canonical', ${sqlString(input.dataset)}, ${sqlString(input.tableName)}, ${sqlString(stableStringify(input.entityKey))}, ${sqlString(input.op)}, ${sqlNullableText(input.runId)}, ${sqlString(input.collectionDate)});`
}

function seriesCatalogInsertSql(row: NormalizedRateRow | NormalizedTdRow, collectionDate: string): string {
  if ('securityPurpose' in row) {
    const seriesKey = homeLoanSeriesKey(row)
    return `INSERT OR IGNORE INTO series_catalog (
      dataset_kind, series_key, bank_name, product_id, product_code, product_name,
      security_purpose, repayment_type, lvr_tier, rate_structure,
      account_type, rate_type, deposit_tier, term_months, interest_payment,
      raw_dimensions_json, latest_source_url, latest_product_url, latest_published_at,
      first_seen_collection_date, last_seen_collection_date, first_seen_at, last_seen_at, is_removed, removed_at, last_successful_run_id
    ) VALUES (
      'home_loans', ${sqlString(seriesKey)}, ${sqlString(row.bankName)}, ${sqlString(row.productId)}, ${sqlString(row.productId)}, ${sqlString(row.productName)},
      ${sqlString(row.securityPurpose)}, ${sqlString(row.repaymentType)}, ${sqlString(row.lvrTier)}, ${sqlString(row.rateStructure)},
      NULL, NULL, NULL, NULL, NULL,
      ${sqlString(homeLoanDimensionJson(row))}, ${sqlString(row.sourceUrl)}, ${sqlString(row.productUrl ?? row.sourceUrl)}, ${sqlNullableText(row.publishedAt)},
      ${sqlString(collectionDate)}, ${sqlString(collectionDate)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, NULL, NULL
    );`
  }
  const seriesKey = tdSeriesKey(row)
  return `INSERT OR IGNORE INTO series_catalog (
    dataset_kind, series_key, bank_name, product_id, product_code, product_name,
    security_purpose, repayment_type, lvr_tier, rate_structure,
    account_type, rate_type, deposit_tier, term_months, interest_payment,
    raw_dimensions_json, latest_source_url, latest_product_url, latest_published_at,
    first_seen_collection_date, last_seen_collection_date, first_seen_at, last_seen_at, is_removed, removed_at, last_successful_run_id
  ) VALUES (
    'term_deposits', ${sqlString(seriesKey)}, ${sqlString(row.bankName)}, ${sqlString(row.productId)}, ${sqlString(row.productId)}, ${sqlString(row.productName)},
    NULL, NULL, NULL, NULL,
    NULL, NULL, ${sqlString(row.depositTier)}, ${sqlNumber(row.termMonths)}, ${sqlString(row.interestPayment)},
    ${sqlString(tdDimensionJson(row))}, ${sqlString(row.sourceUrl)}, ${sqlString(row.productUrl ?? row.sourceUrl)}, ${sqlNullableText(row.publishedAt)},
    ${sqlString(collectionDate)}, ${sqlString(collectionDate)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, NULL, NULL
  );`
}

function seriesPresenceInsertSql(row: NormalizedRateRow | NormalizedTdRow, dataset: Dataset, runId: string): string {
  const seriesKey = 'securityPurpose' in row ? homeLoanSeriesKey(row) : tdSeriesKey(row)
  return `INSERT OR IGNORE INTO series_presence_status (
    dataset_kind, series_key, bank_name, product_id, product_code, is_removed, removed_at, last_seen_collection_date, last_seen_at, last_seen_run_id
  ) VALUES (
    ${sqlString(dataset)}, ${sqlString(seriesKey)}, ${sqlString(row.bankName)}, ${sqlString(row.productId)}, ${sqlString(row.productId)}, 0, NULL,
    ${sqlString(row.collectionDate)}, CURRENT_TIMESTAMP, ${sqlString(runId)}
  );`
}

function latestRefreshSql(dataset: Dataset, seriesKeys: string[]): string {
  if (seriesKeys.length === 0) return ''
  const inList = seriesKeys.map(sqlString).join(', ')
  if (dataset === 'home_loans') {
    return `DELETE FROM latest_home_loan_series WHERE series_key IN (${inList});
    INSERT INTO latest_home_loan_series (
      series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
      security_purpose, repayment_type, rate_structure, lvr_tier, feature_set, has_offset_account, interest_rate, comparison_rate, annual_fee,
      source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score, retrieval_type,
      parsed_at, run_id, run_source, is_removed, removed_at
    )
    SELECT
      series_key, series_key, bank_name, collection_date, product_id, product_code, product_name,
      security_purpose, repayment_type, rate_structure, lvr_tier, feature_set, has_offset_account, interest_rate, comparison_rate, annual_fee,
      source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score, retrieval_type,
      parsed_at, run_id, run_source, 0, NULL
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY series_key ORDER BY collection_date DESC, parsed_at DESC) AS rn
      FROM historical_loan_rates
      WHERE series_key IN (${inList})
    ) latest
    WHERE rn = 1;`
  }
  return `DELETE FROM latest_td_series WHERE series_key IN (${inList});
  INSERT INTO latest_td_series (
    series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
    term_months, interest_rate, deposit_tier, min_deposit, max_deposit, interest_payment,
    source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score, retrieval_type,
    parsed_at, run_id, run_source, is_removed, removed_at
  )
  SELECT
    series_key, series_key, bank_name, collection_date, product_id, product_code, product_name,
    term_months, interest_rate, deposit_tier, min_deposit, max_deposit, interest_payment,
    source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score, retrieval_type,
    parsed_at, run_id, run_source, 0, NULL
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY series_key ORDER BY collection_date DESC, parsed_at DESC) AS rn
    FROM historical_term_deposit_rates
    WHERE series_key IN (${inList})
  ) latest
  WHERE rn = 1;`
}

function orphanSeriesCleanupSql(dataset: Dataset, seriesKeys: string[]): string {
  if (seriesKeys.length === 0) return ''
  const inList = seriesKeys.map(sqlString).join(', ')
  const historicalTable = dataset === 'home_loans' ? 'historical_loan_rates' : 'historical_term_deposit_rates'
  return `DELETE FROM series_presence_status
  WHERE dataset_kind = ${sqlString(dataset)}
    AND series_key IN (${inList})
    AND NOT EXISTS (SELECT 1 FROM ${historicalTable} historical WHERE historical.series_key = series_presence_status.series_key);
  DELETE FROM series_catalog
  WHERE dataset_kind = ${sqlString(dataset)}
    AND series_key IN (${inList})
    AND NOT EXISTS (SELECT 1 FROM ${historicalTable} historical WHERE historical.series_key = series_catalog.series_key);`
}

async function rebuildProjections(): Promise<void> {
  const token = String(process.env.ADMIN_API_TOKEN || '').trim()
  if (!token) throw new Error('ADMIN_API_TOKEN missing for projection rebuild')
  for (const dataset of ['home_loans', 'term_deposits']) {
    const response = await fetch('https://www.australianrates.com/api/home-loan-rates/admin/analytics/projections/rebuild', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ dataset, resume: false }),
    })
    if (!response.ok) {
      throw new Error(`projection rebuild failed for ${dataset}: ${response.status} ${await response.text()}`)
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.apply) requireBackupArtifact(args.backupArtifact)
  const plan = await buildPlan()
  const summary = {
    targets: plan.length,
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
    })),
  }
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify({ ok: true, mode: 'plan', ...summary }, null, 2)}\n`)
    return
  }

  const runId = `repair:known-cdr-anomalies:${new Date().toISOString()}`
  const parsedAt = new Date().toISOString()
  const statements: string[] = []
  const homeSeriesKeys: string[] = []
  const tdSeriesKeys: string[] = []

  for (const target of plan) {
    for (const key of target.deletedKeys) {
      statements.push(changeFeedSql({
        dataset: target.dataset,
        tableName: target.dataset === 'home_loans' ? 'historical_loan_rates' : 'historical_term_deposit_rates',
        entityKey: Object.fromEntries(Object.entries(key).filter(([entry]) => entry !== 'series_key' && entry !== 'run_id')),
        op: 'tombstone',
        runId: typeof key.run_id === 'string' ? key.run_id : null,
        collectionDate: target.collectionDate,
      }))
    }
    statements.push(
      target.dataset === 'home_loans'
        ? `DELETE FROM historical_loan_rates WHERE bank_name = ${sqlString(target.bankName)} AND collection_date = ${sqlString(target.collectionDate)} AND product_id = ${sqlString(target.productId)} AND data_quality_flag = 'cdr_live';`
        : `DELETE FROM historical_term_deposit_rates WHERE bank_name = ${sqlString(target.bankName)} AND collection_date = ${sqlString(target.collectionDate)} AND product_id = ${sqlString(target.productId)} AND data_quality_flag = 'cdr_live';`,
    )
    if (target.dataset === 'home_loans') {
      homeSeriesKeys.push(...target.existingSeriesKeys)
      for (const row of target.parsedRows as NormalizedRateRow[]) {
        statements.push(historicalHomeUpsertSql(row, target.payloadHash, runId, parsedAt))
        statements.push(seriesCatalogInsertSql(row, target.collectionDate))
        statements.push(seriesPresenceInsertSql(row, 'home_loans', runId))
        statements.push(changeFeedSql({
          dataset: 'home_loans',
          tableName: 'historical_loan_rates',
          entityKey: {
            bank_name: row.bankName,
            collection_date: row.collectionDate,
            product_id: row.productId,
            lvr_tier: row.lvrTier,
            rate_structure: row.rateStructure,
            security_purpose: row.securityPurpose,
            repayment_type: row.repaymentType,
            run_source: 'manual',
          },
          op: 'upsert',
          runId,
          collectionDate: row.collectionDate,
        }))
        homeSeriesKeys.push(homeLoanSeriesKey(row))
      }
    } else {
      tdSeriesKeys.push(...target.existingSeriesKeys)
      for (const row of target.parsedRows as NormalizedTdRow[]) {
        statements.push(historicalTdUpsertSql(row, target.payloadHash, runId, parsedAt))
        statements.push(seriesCatalogInsertSql(row, target.collectionDate))
        statements.push(seriesPresenceInsertSql(row, 'term_deposits', runId))
        statements.push(changeFeedSql({
          dataset: 'term_deposits',
          tableName: 'historical_term_deposit_rates',
          entityKey: {
            bank_name: row.bankName,
            collection_date: row.collectionDate,
            product_id: row.productId,
            term_months: row.termMonths,
            deposit_tier: row.depositTier,
            interest_payment: row.interestPayment,
            run_source: 'manual',
          },
          op: 'upsert',
          runId,
          collectionDate: row.collectionDate,
        }))
        tdSeriesKeys.push(tdSeriesKey(row))
      }
    }
  }

  statements.push(latestRefreshSql('home_loans', uniqueStrings(homeSeriesKeys)))
  statements.push(latestRefreshSql('term_deposits', uniqueStrings(tdSeriesKeys)))
  statements.push(orphanSeriesCleanupSql('home_loans', uniqueStrings(homeSeriesKeys)))
  statements.push(orphanSeriesCleanupSql('term_deposits', uniqueStrings(tdSeriesKeys)))

  const sql = statements.filter(Boolean).join('\n')
  const execution = executeRemoteSqlFileForTest(DB_NAME, sql, spawnSync)
  await rebuildProjections()
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: 'apply',
    run_id: runId,
    backup_artifact: args.backupArtifact,
    executed_command: execution.command,
    exit_code: execution.exitCode,
    ...summary,
    refreshed_latest_series_keys: {
      home_loans: uniqueStrings(homeSeriesKeys).length,
      term_deposits: uniqueStrings(tdSeriesKeys).length,
    },
  }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${(error as Error)?.message || String(error)}\n`)
  process.exitCode = 1
})
