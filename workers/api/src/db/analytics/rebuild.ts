import type { DatasetKind } from '../../../../../packages/shared/src/index.js'
import { legacyProductKey } from '../../utils/series-identity'
import { nowIso } from '../../utils/time'
import { getAnalyticsDatasetConfig, getAnalyticsDatasetConfigs, type AnalyticsDatasetConfig } from './config'
import { writeHomeLoanProjection, writeSavingsProjection, writeTdProjection } from './projection-write'

type ProjectionCursor = {
  collectionDate: string
  parsedAt: string
  seriesKey: string
}

type RebuildInput = {
  dataset?: DatasetKind | 'all'
  fromDate?: string
  toDate?: string
  batchSize?: number
  limitRows?: number
}

type ProjectionStateRow = {
  state_key: string
  dataset_kind: DatasetKind
  status: 'pending' | 'processing' | 'completed' | 'failed'
  last_series_key: string | null
  last_collection_date: string | null
  last_parsed_at: string | null
  last_run_id: string | null
  notes: string | null
  updated_at: string
}

type DatasetRebuildResult = {
  dataset: DatasetKind
  processed_rows: number
  batches: number
  last_cursor: ProjectionCursor | null
  state_key: string
}

function datasetsFor(input: DatasetKind | 'all' | undefined): DatasetKind[] {
  if (!input || input === 'all') return getAnalyticsDatasetConfigs().map((config) => config.dataset)
  return [input]
}

function stateKey(dataset: DatasetKind): string {
  return `projection_rebuild:${dataset}`
}

function nextCursor(row: Record<string, unknown>): ProjectionCursor {
  return {
    collectionDate: String(row.collection_date || ''),
    parsedAt: String(row.parsed_at || ''),
    seriesKey: String(row.series_key || ''),
  }
}

async function upsertProjectionState(
  db: D1Database,
  input: {
    dataset: DatasetKind
    status: ProjectionStateRow['status']
    cursor?: ProjectionCursor | null
    lastRunId?: string | null
    notes?: string | null
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO analytics_projection_state (
         state_key, dataset_kind, status, last_series_key, last_collection_date, last_parsed_at, last_run_id, notes, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(state_key) DO UPDATE SET
         dataset_kind = excluded.dataset_kind,
         status = excluded.status,
         last_series_key = excluded.last_series_key,
         last_collection_date = excluded.last_collection_date,
         last_parsed_at = excluded.last_parsed_at,
         last_run_id = excluded.last_run_id,
         notes = excluded.notes,
         updated_at = excluded.updated_at`,
    )
    .bind(
      stateKey(input.dataset),
      input.dataset,
      input.status,
      input.cursor?.seriesKey ?? null,
      input.cursor?.collectionDate ?? null,
      input.cursor?.parsedAt ?? null,
      input.lastRunId ?? null,
      input.notes ?? null,
      nowIso(),
    )
    .run()
}

async function listProjectionStates(
  db: D1Database,
  dataset?: DatasetKind,
): Promise<ProjectionStateRow[]> {
  const result = await db
    .prepare(
      `SELECT
         state_key, dataset_kind, status, last_series_key, last_collection_date, last_parsed_at,
         last_run_id, notes, updated_at
       FROM analytics_projection_state
       ${dataset ? 'WHERE dataset_kind = ?1' : ''}
       ORDER BY dataset_kind ASC, updated_at DESC`,
    )
    .bind(...(dataset ? [dataset] : []))
    .all<ProjectionStateRow>()
  return result.results ?? []
}

async function readNextBatch(
  db: D1Database,
  config: AnalyticsDatasetConfig,
  input: RebuildInput,
  cursor: ProjectionCursor | null,
  batchSize: number,
): Promise<Array<Record<string, unknown>>> {
  const where: string[] = []
  const binds: Array<string | number> = []
  if (input.fromDate) {
    where.push(`collection_date >= ?${binds.length + 1}`)
    binds.push(input.fromDate)
  }
  if (input.toDate) {
    where.push(`collection_date <= ?${binds.length + 1}`)
    binds.push(input.toDate)
  }
  if (cursor) {
    where.push(
      `(collection_date > ?${binds.length + 1}
        OR (collection_date = ?${binds.length + 2} AND parsed_at > ?${binds.length + 3})
        OR (collection_date = ?${binds.length + 4} AND parsed_at = ?${binds.length + 5} AND series_key > ?${binds.length + 6}))`,
    )
    binds.push(
      cursor.collectionDate,
      cursor.collectionDate,
      cursor.parsedAt,
      cursor.collectionDate,
      cursor.parsedAt,
      cursor.seriesKey,
    )
  }
  binds.push(batchSize)
  const result = await db
    .prepare(
      `SELECT *
       FROM ${config.historicalTable}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY collection_date ASC, parsed_at ASC, series_key ASC
       LIMIT ?${binds.length}`,
    )
    .bind(...binds)
    .all<Record<string, unknown>>()
  return result.results ?? []
}

async function replayRow(db: D1Database, dataset: DatasetKind, row: Record<string, unknown>): Promise<void> {
  if (dataset === 'home_loans') {
    await writeHomeLoanProjection(
      db,
      {
        seriesKey: String(row.series_key || ''),
        productKey: legacyProductKey('home_loans', {
          bankName: String(row.bank_name || ''),
          productId: String(row.product_id || ''),
          securityPurpose: String(row.security_purpose || ''),
          repaymentType: String(row.repayment_type || ''),
          lvrTier: String(row.lvr_tier || ''),
          rateStructure: String(row.rate_structure || ''),
        }),
        bankName: String(row.bank_name || ''),
        productId: String(row.product_id || ''),
        productName: String(row.product_name || ''),
        collectionDate: String(row.collection_date || ''),
        parsedAt: String(row.parsed_at || ''),
        securityPurpose: String(row.security_purpose || ''),
        repaymentType: String(row.repayment_type || ''),
        rateStructure: String(row.rate_structure || ''),
        lvrTier: String(row.lvr_tier || ''),
        featureSet: String(row.feature_set || ''),
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
      },
      { emitChangeFeed: false },
    )
    return
  }

  if (dataset === 'savings') {
    await writeSavingsProjection(
      db,
      {
        seriesKey: String(row.series_key || ''),
        productKey: legacyProductKey('savings', {
          bankName: String(row.bank_name || ''),
          productId: String(row.product_id || ''),
          accountType: String(row.account_type || ''),
          rateType: String(row.rate_type || ''),
          depositTier: String(row.deposit_tier || ''),
        }),
        bankName: String(row.bank_name || ''),
        productId: String(row.product_id || ''),
        productName: String(row.product_name || ''),
        collectionDate: String(row.collection_date || ''),
        parsedAt: String(row.parsed_at || ''),
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
      },
      { emitChangeFeed: false },
    )
    return
  }

  await writeTdProjection(
    db,
    {
      seriesKey: String(row.series_key || ''),
      productKey: legacyProductKey('term_deposits', {
        bankName: String(row.bank_name || ''),
        productId: String(row.product_id || ''),
        termMonths: Number(row.term_months ?? 0),
        depositTier: String(row.deposit_tier || ''),
        interestPayment: String(row.interest_payment || ''),
      }),
      bankName: String(row.bank_name || ''),
      productId: String(row.product_id || ''),
      productName: String(row.product_name || ''),
      collectionDate: String(row.collection_date || ''),
      parsedAt: String(row.parsed_at || ''),
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
    },
    { emitChangeFeed: false },
  )
}

export async function rebuildAnalyticsProjections(
  db: D1Database,
  input: RebuildInput,
): Promise<{ started_at: string; completed_at: string; results: DatasetRebuildResult[] }> {
  const startedAt = nowIso()
  const results: DatasetRebuildResult[] = []
  for (const dataset of datasetsFor(input.dataset)) {
    const config = getAnalyticsDatasetConfig(dataset)
    let processedRows = 0
    let batches = 0
    let cursor: ProjectionCursor | null = null
    try {
      await upsertProjectionState(db, { dataset, status: 'processing', notes: 'Replay in progress' })
      while (true) {
        const remaining = input.limitRows == null ? null : Math.max(0, input.limitRows - processedRows)
        if (remaining === 0) break
        const rows = await readNextBatch(db, config, input, cursor, Math.max(1, Math.min(1000, remaining ?? input.batchSize ?? 250)))
        if (!rows.length) break
        for (const row of rows) {
          await replayRow(db, dataset, row)
          processedRows += 1
          cursor = nextCursor(row)
        }
        batches += 1
        await upsertProjectionState(db, {
          dataset,
          status: 'processing',
          cursor,
          notes: `Replay batches=${batches} rows=${processedRows}`,
        })
      }
      await upsertProjectionState(db, {
        dataset,
        status: 'completed',
        cursor,
        notes: `Replay completed rows=${processedRows}`,
      })
      results.push({
        dataset,
        processed_rows: processedRows,
        batches,
        last_cursor: cursor,
        state_key: stateKey(dataset),
      })
    } catch (error) {
      await upsertProjectionState(db, {
        dataset,
        status: 'failed',
        cursor,
        notes: (error as Error)?.message || String(error),
      })
      throw error
    }
  }
  return { started_at: startedAt, completed_at: nowIso(), results }
}

async function diagnosticsForDataset(
  db: D1Database,
  config: AnalyticsDatasetConfig,
  stateRows: ProjectionStateRow[],
): Promise<Record<string, unknown>> {
  const [events, intervals, overlaps, multiOpen, missingOpen] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM ${config.eventsTable}`).first<{ total: number }>(),
    db.prepare(`SELECT COUNT(*) AS total FROM ${config.intervalsTable}`).first<{ total: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS total
       FROM ${config.intervalsTable} a
       JOIN ${config.intervalsTable} b
         ON a.series_key = b.series_key
        AND a.interval_id < b.interval_id
        AND COALESCE(a.effective_to_collection_date, '9999-12-31') >= b.effective_from_collection_date
        AND COALESCE(b.effective_to_collection_date, '9999-12-31') >= a.effective_from_collection_date`,
    ).first<{ total: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT series_key
         FROM ${config.intervalsTable}
         WHERE effective_to_collection_date IS NULL
         GROUP BY series_key
         HAVING COUNT(*) > 1
       )`,
    ).first<{ total: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS total
       FROM ${config.latestTable} l
       LEFT JOIN ${config.intervalsTable} i
         ON i.series_key = l.series_key
        AND i.effective_to_collection_date IS NULL
       WHERE COALESCE(l.is_removed, 0) = 0
         AND i.series_key IS NULL`,
    ).first<{ total: number }>(),
  ])

  return {
    dataset: config.dataset,
    events_total: Number(events?.total ?? 0),
    intervals_total: Number(intervals?.total ?? 0),
    overlapping_interval_pairs: Number(overlaps?.total ?? 0),
    multi_open_interval_series: Number(multiOpen?.total ?? 0),
    active_series_missing_open_interval: Number(missingOpen?.total ?? 0),
    state: stateRows.find((row) => row.dataset_kind === config.dataset) ?? null,
  }
}

export async function getAnalyticsProjectionDiagnostics(
  db: D1Database,
  dataset?: DatasetKind | 'all',
): Promise<{ checked_at: string; states: ProjectionStateRow[]; datasets: Array<Record<string, unknown>> }> {
  const scopedDataset = dataset && dataset !== 'all' ? dataset : undefined
  const states = await listProjectionStates(db, scopedDataset)
  const datasets = await Promise.all(
    datasetsFor(dataset).map((name) => diagnosticsForDataset(db, getAnalyticsDatasetConfig(name), states)),
  )
  return {
    checked_at: nowIso(),
    states,
    datasets,
  }
}
