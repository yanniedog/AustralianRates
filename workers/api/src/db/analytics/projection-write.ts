import { nowIso } from '../../utils/time'
import { emitDownloadChange } from './change-feed'
import { hashHomeLoanState, hashSavingsState, hashTdState } from './state-hash'

type DatasetKind = 'home_loans' | 'savings' | 'term_deposits'
type ProjectionEventType = 'initial' | 'state_change' | 'rate_change' | 'spec_change' | 'removed' | 'reinstated'

type ProjectionRow = {
  [key: string]: string | number | null
  series_key: string
  product_key: string
  bank_name: string
  product_id: string
  product_name: string
  collection_date: string
  parsed_at: string
  source_url: string
  product_url: string | null
  published_at: string | null
  cdr_product_detail_hash: string | null
  data_quality_flag: string
  confidence_score: number
  retrieval_type: string
  run_id: string | null
  run_source: string
  is_removed: number
  removed_at: string | null
  state_hash: string
}

type ProjectionConfig = {
  datasetKind: DatasetKind
  eventsTable: string
  intervalsTable: string
  dimensionColumns: string[]
  metricColumns: string[]
  rateColumns: string[]
}

export type ProjectionWriteOptions = {
  emitChangeFeed?: boolean
}

type DiffMap = Record<string, { from: string | number | null; to: string | number | null }>

const COMMON_COLUMNS = [
  'series_key',
  'product_key',
  'bank_name',
  'product_id',
  'product_name',
  'source_url',
  'product_url',
  'published_at',
  'cdr_product_detail_hash',
  'data_quality_flag',
  'confidence_score',
  'retrieval_type',
  'run_id',
  'run_source',
  'is_removed',
  'removed_at',
  'state_hash',
] as const

const HOME_LOAN_CONFIG: ProjectionConfig = {
  datasetKind: 'home_loans',
  eventsTable: 'home_loan_rate_events',
  intervalsTable: 'home_loan_rate_intervals',
  dimensionColumns: ['security_purpose', 'repayment_type', 'rate_structure', 'lvr_tier', 'feature_set', 'has_offset_account'],
  metricColumns: ['interest_rate', 'comparison_rate', 'annual_fee'],
  rateColumns: ['interest_rate', 'comparison_rate', 'annual_fee'],
}

const SAVINGS_CONFIG: ProjectionConfig = {
  datasetKind: 'savings',
  eventsTable: 'savings_rate_events',
  intervalsTable: 'savings_rate_intervals',
  dimensionColumns: ['account_type', 'rate_type', 'deposit_tier'],
  metricColumns: ['interest_rate', 'min_balance', 'max_balance', 'conditions', 'monthly_fee'],
  rateColumns: ['interest_rate', 'min_balance', 'max_balance', 'monthly_fee'],
}

const TD_CONFIG: ProjectionConfig = {
  datasetKind: 'term_deposits',
  eventsTable: 'td_rate_events',
  intervalsTable: 'td_rate_intervals',
  dimensionColumns: ['term_months', 'deposit_tier', 'interest_payment'],
  metricColumns: ['interest_rate', 'min_deposit', 'max_deposit'],
  rateColumns: ['interest_rate', 'min_deposit', 'max_deposit'],
}

function projectionColumns(config: ProjectionConfig): string[] {
  return [...COMMON_COLUMNS, ...config.dimensionColumns, ...config.metricColumns]
}

function previousDateIso(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function equalValues(left: unknown, right: unknown): boolean {
  if (left == null && right == null) return true
  if (typeof left === 'number' || typeof right === 'number') {
    const a = left == null ? null : Number(left)
    const b = right == null ? null : Number(right)
    if (a == null || b == null) return a === b
    return Number.isFinite(a) && Number.isFinite(b) ? a === b : String(left) === String(right)
  }
  return String(left ?? '') === String(right ?? '')
}

function buildDiff(current: Record<string, unknown> | null, next: ProjectionRow, fields: string[]): DiffMap {
  const diff: DiffMap = {}
  if (!current) return diff
  for (const field of fields) {
    const left = current[field] ?? null
    const right = next[field] ?? null
    if (equalValues(left, right)) continue
    diff[field] = { from: left as string | number | null, to: right as string | number | null }
  }
  return diff
}

function classifyEvent(
  current: Record<string, unknown> | null,
  next: ProjectionRow,
  diff: DiffMap,
  config: ProjectionConfig,
): ProjectionEventType {
  if (!current) return next.is_removed ? 'removed' : 'initial'
  const currentRemoved = Number(current.is_removed ?? 0) === 1
  const nextRemoved = next.is_removed === 1
  if (!currentRemoved && nextRemoved) return 'removed'
  if (currentRemoved && !nextRemoved) return 'reinstated'
  for (const column of config.rateColumns) {
    if (column in diff) return 'rate_change'
  }
  const changedColumns = Object.keys(diff)
  return changedColumns.length > 0 ? 'spec_change' : 'state_change'
}

async function getCurrentOpenInterval(
  db: D1Database,
  config: ProjectionConfig,
  seriesKey: string,
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare(
      `SELECT *
       FROM ${config.intervalsTable}
       WHERE series_key = ?1
         AND effective_to_collection_date IS NULL
       ORDER BY effective_from_collection_date DESC
       LIMIT 1`,
    )
    .bind(seriesKey)
    .first<Record<string, unknown>>()
  return row ?? null
}

async function updateCurrentInterval(
  db: D1Database,
  config: ProjectionConfig,
  input: ProjectionRow,
  extraSet: Record<string, string | number | null>,
): Promise<void> {
  const columns = [...projectionColumns(config), 'last_confirmed_collection_date', 'last_confirmed_at', 'effective_to_collection_date']
  const values: Array<string | number | null> = columns.map((column) => {
    if (column === 'last_confirmed_collection_date') return input.collection_date
    if (column === 'last_confirmed_at') return input.parsed_at || nowIso()
    if (column === 'effective_to_collection_date') return extraSet.effective_to_collection_date ?? null
    return input[column] ?? null
  })
  const setClause = columns.map((column, index) => `${column} = ?${index + 1}`).join(', ')
  await db
    .prepare(
      `UPDATE ${config.intervalsTable}
       SET ${setClause}
       WHERE series_key = ?${columns.length + 1}
         AND effective_to_collection_date IS NULL`,
    )
    .bind(...values, input.series_key)
    .run()
}

async function touchCurrentInterval(db: D1Database, config: ProjectionConfig, input: ProjectionRow): Promise<void> {
  await db
    .prepare(
      `UPDATE ${config.intervalsTable}
       SET last_confirmed_collection_date = ?1,
           last_confirmed_at = ?2,
           run_id = ?3,
           run_source = ?4,
           source_url = ?5,
           product_url = ?6,
           published_at = ?7,
           cdr_product_detail_hash = COALESCE(?8, cdr_product_detail_hash),
           removed_at = ?9,
           is_removed = ?10
       WHERE series_key = ?11
         AND effective_to_collection_date IS NULL`,
    )
    .bind(
      input.collection_date,
      input.parsed_at,
      input.run_id,
      input.run_source,
      input.source_url,
      input.product_url,
      input.published_at,
      input.cdr_product_detail_hash,
      input.removed_at,
      input.is_removed,
      input.series_key,
    )
    .run()
}

async function insertInterval(db: D1Database, config: ProjectionConfig, input: ProjectionRow): Promise<void> {
  const columns = [...projectionColumns(config), 'effective_from_collection_date', 'effective_to_collection_date', 'opened_at', 'last_confirmed_collection_date', 'last_confirmed_at']
  const values = columns.map((column) => {
    if (column === 'effective_from_collection_date') return input.collection_date
    if (column === 'effective_to_collection_date') return null
    if (column === 'opened_at') return input.parsed_at
    if (column === 'last_confirmed_collection_date') return input.collection_date
    if (column === 'last_confirmed_at') return input.parsed_at
    return input[column] ?? null
  })
  const placeholders = columns.map((_column, index) => `?${index + 1}`).join(', ')
  await db
    .prepare(
      `INSERT INTO ${config.intervalsTable} (${columns.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT(series_key, effective_from_collection_date) DO UPDATE SET
         ${columns.filter((column) => column !== 'effective_from_collection_date').map((column) => `${column} = excluded.${column}`).join(', ')}`,
    )
    .bind(...values)
    .run()
}

async function insertEvent(
  db: D1Database,
  config: ProjectionConfig,
  input: ProjectionRow,
  eventType: ProjectionEventType,
  diff: DiffMap,
  previousStateHash: string | null,
): Promise<void> {
  const columns = [
    ...projectionColumns(config),
    'collection_date',
    'parsed_at',
    'event_type',
    'change_json',
    'previous_state_hash',
  ]
  const values = columns.map((column) => {
    if (column === 'collection_date') return input.collection_date
    if (column === 'parsed_at') return input.parsed_at
    if (column === 'event_type') return eventType
    if (column === 'change_json') return JSON.stringify(diff)
    if (column === 'previous_state_hash') return previousStateHash
    return input[column] ?? null
  })
  const placeholders = columns.map((_column, index) => `?${index + 1}`).join(', ')
  await db
    .prepare(
      `INSERT OR IGNORE INTO ${config.eventsTable} (${columns.join(', ')})
       VALUES (${placeholders})`,
    )
    .bind(...values)
    .run()
}

async function emitIntervalUpsert(db: D1Database, config: ProjectionConfig, input: ProjectionRow): Promise<void> {
  await emitDownloadChange(db, {
    stream: 'optimized',
    datasetKind: config.datasetKind,
    tableName: config.intervalsTable,
    entityKey: {
      series_key: input.series_key,
      effective_from_collection_date: input.collection_date,
    },
    op: 'upsert',
    runId: input.run_id,
    collectionDate: input.collection_date,
  })
}

async function emitCurrentIntervalUpsert(db: D1Database, config: ProjectionConfig, current: Record<string, unknown>): Promise<void> {
  await emitDownloadChange(db, {
    stream: 'optimized',
    datasetKind: config.datasetKind,
    tableName: config.intervalsTable,
    entityKey: {
      series_key: String(current.series_key || ''),
      effective_from_collection_date: String(current.effective_from_collection_date || ''),
    },
    op: 'upsert',
    runId: typeof current.run_id === 'string' ? current.run_id : null,
    collectionDate: typeof current.last_confirmed_collection_date === 'string' ? current.last_confirmed_collection_date : null,
  })
}

async function emitEventUpsert(
  db: D1Database,
  config: ProjectionConfig,
  input: ProjectionRow,
  eventType: ProjectionEventType,
): Promise<void> {
  await emitDownloadChange(db, {
    stream: 'optimized',
    datasetKind: config.datasetKind,
    tableName: config.eventsTable,
    entityKey: {
      series_key: input.series_key,
      collection_date: input.collection_date,
      state_hash: input.state_hash,
      event_type: eventType,
      run_source: input.run_source,
    },
    op: 'upsert',
    runId: input.run_id,
    collectionDate: input.collection_date,
  })
}

async function writeProjection(
  db: D1Database,
  config: ProjectionConfig,
  input: ProjectionRow,
  options?: ProjectionWriteOptions,
): Promise<void> {
  const emitFeed = options?.emitChangeFeed !== false
  const current = await getCurrentOpenInterval(db, config, input.series_key)
  const diff = buildDiff(current, input, [...projectionColumns(config), 'effective_to_collection_date'])

  if (current && String(current.state_hash || '') === input.state_hash) {
    await touchCurrentInterval(db, config, input)
    return
  }

  const eventType = classifyEvent(current, input, diff, config)

  if (current && String(current.effective_from_collection_date || '') === input.collection_date) {
    await updateCurrentInterval(db, config, input, { effective_to_collection_date: null })
    await insertEvent(db, config, input, eventType, diff, String(current.state_hash || '') || null)
    if (emitFeed) {
      await emitCurrentIntervalUpsert(db, config, {
        ...current,
        run_id: input.run_id,
        last_confirmed_collection_date: input.collection_date,
      })
      await emitEventUpsert(db, config, input, eventType)
    }
    return
  }

  if (current) {
    await db
      .prepare(
        `UPDATE ${config.intervalsTable}
         SET effective_to_collection_date = ?1
         WHERE series_key = ?2
           AND effective_to_collection_date IS NULL`,
      )
      .bind(previousDateIso(input.collection_date), input.series_key)
      .run()
    if (emitFeed) {
      await emitCurrentIntervalUpsert(db, config, {
        ...current,
        last_confirmed_collection_date: previousDateIso(input.collection_date),
      })
    }
  }

  await insertInterval(db, config, input)
  await insertEvent(db, config, input, eventType, diff, current ? String(current.state_hash || '') || null : null)
  if (emitFeed) {
    await emitIntervalUpsert(db, config, input)
    await emitEventUpsert(db, config, input, eventType)
  }
}

export async function writeHomeLoanProjection(
  db: D1Database,
  input: {
    seriesKey: string
    productKey: string
    bankName: string
    productId: string
    productName: string
    collectionDate: string
    parsedAt: string
    securityPurpose: string
    repaymentType: string
    rateStructure: string
    lvrTier: string
    featureSet: string
    hasOffsetAccount?: boolean | null
    interestRate: number
    comparisonRate?: number | null
    annualFee?: number | null
    sourceUrl: string
    productUrl?: string | null
    publishedAt?: string | null
    cdrProductDetailHash?: string | null
    dataQualityFlag: string
    confidenceScore: number
    retrievalType: string
    runId?: string | null
    runSource: string
    isRemoved?: boolean
    removedAt?: string | null
  },
  options?: ProjectionWriteOptions,
): Promise<void> {
  const stateHash = await hashHomeLoanState(input)
  await writeProjection(db, HOME_LOAN_CONFIG, {
    series_key: input.seriesKey,
    product_key: input.productKey,
    bank_name: input.bankName,
    product_id: input.productId,
    product_name: input.productName,
    collection_date: input.collectionDate,
    parsed_at: input.parsedAt,
    security_purpose: input.securityPurpose,
    repayment_type: input.repaymentType,
    rate_structure: input.rateStructure,
    lvr_tier: input.lvrTier,
    feature_set: input.featureSet,
    has_offset_account: input.hasOffsetAccount == null ? null : (input.hasOffsetAccount ? 1 : 0),
    interest_rate: input.interestRate,
    comparison_rate: input.comparisonRate ?? null,
    annual_fee: input.annualFee ?? null,
    source_url: input.sourceUrl,
    product_url: input.productUrl ?? null,
    published_at: input.publishedAt ?? null,
    cdr_product_detail_hash: input.cdrProductDetailHash ?? null,
    data_quality_flag: input.dataQualityFlag,
    confidence_score: input.confidenceScore,
    retrieval_type: input.retrievalType,
    run_id: input.runId ?? null,
    run_source: input.runSource,
    is_removed: input.isRemoved ? 1 : 0,
    removed_at: input.removedAt ?? null,
    state_hash: stateHash,
  }, options)
}

export async function writeSavingsProjection(
  db: D1Database,
  input: {
    seriesKey: string
    productKey: string
    bankName: string
    productId: string
    productName: string
    collectionDate: string
    parsedAt: string
    accountType: string
    rateType: string
    depositTier: string
    interestRate: number
    minBalance?: number | null
    maxBalance?: number | null
    conditions?: string | null
    monthlyFee?: number | null
    sourceUrl: string
    productUrl?: string | null
    publishedAt?: string | null
    cdrProductDetailHash?: string | null
    dataQualityFlag: string
    confidenceScore: number
    retrievalType: string
    runId?: string | null
    runSource: string
    isRemoved?: boolean
    removedAt?: string | null
  },
  options?: ProjectionWriteOptions,
): Promise<void> {
  const stateHash = await hashSavingsState(input)
  await writeProjection(db, SAVINGS_CONFIG, {
    series_key: input.seriesKey,
    product_key: input.productKey,
    bank_name: input.bankName,
    product_id: input.productId,
    product_name: input.productName,
    collection_date: input.collectionDate,
    parsed_at: input.parsedAt,
    account_type: input.accountType,
    rate_type: input.rateType,
    deposit_tier: input.depositTier,
    interest_rate: input.interestRate,
    min_balance: input.minBalance ?? null,
    max_balance: input.maxBalance ?? null,
    conditions: input.conditions ?? null,
    monthly_fee: input.monthlyFee ?? null,
    source_url: input.sourceUrl,
    product_url: input.productUrl ?? null,
    published_at: input.publishedAt ?? null,
    cdr_product_detail_hash: input.cdrProductDetailHash ?? null,
    data_quality_flag: input.dataQualityFlag,
    confidence_score: input.confidenceScore,
    retrieval_type: input.retrievalType,
    run_id: input.runId ?? null,
    run_source: input.runSource,
    is_removed: input.isRemoved ? 1 : 0,
    removed_at: input.removedAt ?? null,
    state_hash: stateHash,
  }, options)
}

export async function writeTdProjection(
  db: D1Database,
  input: {
    seriesKey: string
    productKey: string
    bankName: string
    productId: string
    productName: string
    collectionDate: string
    parsedAt: string
    termMonths: number
    depositTier: string
    interestPayment: string
    interestRate: number
    minDeposit?: number | null
    maxDeposit?: number | null
    sourceUrl: string
    productUrl?: string | null
    publishedAt?: string | null
    cdrProductDetailHash?: string | null
    dataQualityFlag: string
    confidenceScore: number
    retrievalType: string
    runId?: string | null
    runSource: string
    isRemoved?: boolean
    removedAt?: string | null
  },
  options?: ProjectionWriteOptions,
): Promise<void> {
  const stateHash = await hashTdState(input)
  await writeProjection(db, TD_CONFIG, {
    series_key: input.seriesKey,
    product_key: input.productKey,
    bank_name: input.bankName,
    product_id: input.productId,
    product_name: input.productName,
    collection_date: input.collectionDate,
    parsed_at: input.parsedAt,
    term_months: input.termMonths,
    deposit_tier: input.depositTier,
    interest_payment: input.interestPayment,
    interest_rate: input.interestRate,
    min_deposit: input.minDeposit ?? null,
    max_deposit: input.maxDeposit ?? null,
    source_url: input.sourceUrl,
    product_url: input.productUrl ?? null,
    published_at: input.publishedAt ?? null,
    cdr_product_detail_hash: input.cdrProductDetailHash ?? null,
    data_quality_flag: input.dataQualityFlag,
    confidence_score: input.confidenceScore,
    retrieval_type: input.retrievalType,
    run_id: input.runId ?? null,
    run_source: input.runSource,
    is_removed: input.isRemoved ? 1 : 0,
    removed_at: input.removedAt ?? null,
    state_hash: stateHash,
  }, options)
}
