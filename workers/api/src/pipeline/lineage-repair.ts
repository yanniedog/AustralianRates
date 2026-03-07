import { loadCdrDetailPayloadMap } from '../db/cdr-detail-payloads'
import { persistRawPayload } from '../db/raw-payloads'
import type { EnvBindings } from '../types'

type DatasetKind = 'home_loans' | 'savings' | 'term_deposits'

type DatasetTable = {
  dataset: DatasetKind
  table: 'historical_loan_rates' | 'historical_savings_rates' | 'historical_term_deposit_rates'
}

type SyntheticCandidate = {
  content_hash: string
  source_url: string | null
  run_id: string | null
  product_id: string | null
  collection_date: string | null
  row_count: number
}

type RepairEnv = Pick<EnvBindings, 'DB' | 'RAW_BUCKET'>

export type LineageRepairResult = {
  cutoff_date: string
  lookback_days: number
  dry_run: boolean
  missing_before: number
  missing_after: number
  repaired_rows: number
  strategy_counts: Array<{ dataset: DatasetKind; strategy: string; rows: number }>
  unresolved: Array<{ dataset: DatasetKind; run_source: string; unresolved_rows: number }>
}

const DATASET_TABLES: DatasetTable[] = [
  { dataset: 'home_loans', table: 'historical_loan_rates' },
  { dataset: 'savings', table: 'historical_savings_rates' },
  { dataset: 'term_deposits', table: 'historical_term_deposit_rates' },
]

function clampLookbackDays(input: number | null | undefined): number {
  const value = Math.floor(Number(input))
  if (!Number.isFinite(value)) return 365
  return Math.max(1, Math.min(3650, value))
}

function cutoffDateFromLookbackDays(lookbackDays: number): string {
  return new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function countMissingFetchEventRows(db: D1Database, cutoffDate: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT (
         SELECT COUNT(*) FROM historical_loan_rates WHERE fetch_event_id IS NULL AND collection_date >= ?1
       ) + (
         SELECT COUNT(*) FROM historical_savings_rates WHERE fetch_event_id IS NULL AND collection_date >= ?1
       ) + (
         SELECT COUNT(*) FROM historical_term_deposit_rates WHERE fetch_event_id IS NULL AND collection_date >= ?1
       ) AS n`,
    )
    .bind(cutoffDate)
    .first<{ n: number }>()
  return Number(row?.n ?? 0)
}

async function updateByDetailHash(
  db: D1Database,
  table: DatasetTable['table'],
  cutoffDate: string,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE ${table} AS rates
       SET fetch_event_id = (
         SELECT fe.id
         FROM fetch_events fe
         WHERE fe.content_hash = rates.cdr_product_detail_hash
         ORDER BY fe.fetched_at DESC, fe.id DESC
         LIMIT 1
       )
       WHERE rates.fetch_event_id IS NULL
         AND rates.collection_date >= ?1
         AND rates.cdr_product_detail_hash IS NOT NULL
         AND TRIM(rates.cdr_product_detail_hash) != ''
         AND EXISTS (
           SELECT 1
           FROM fetch_events fe
           WHERE fe.content_hash = rates.cdr_product_detail_hash
         )`,
    )
    .bind(cutoffDate)
    .run()
  return Number(result.meta?.changes ?? 0)
}

async function updateByRunSeenProductIndex(
  db: D1Database,
  input: { dataset: DatasetKind; table: DatasetTable['table']; cutoffDate: string },
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE ${input.table} AS rates
       SET fetch_event_id = (
         SELECT fe.id
         FROM run_seen_products rsp
         JOIN fetch_events fe
           ON fe.run_id = rsp.run_id
          AND fe.lender_code = rsp.lender_code
          AND fe.dataset_kind = rsp.dataset_kind
          AND fe.source_type = 'cdr_products'
         WHERE rsp.run_id = rates.run_id
           AND rsp.dataset_kind = ?2
           AND rsp.bank_name = rates.bank_name
           AND rsp.product_id = rates.product_id
         ORDER BY fe.fetched_at DESC, fe.id DESC
         LIMIT 1
       )
       WHERE rates.fetch_event_id IS NULL
         AND rates.collection_date >= ?1
         AND rates.run_id IS NOT NULL
         AND TRIM(rates.run_id) != ''
         AND EXISTS (
           SELECT 1
           FROM run_seen_products rsp
           JOIN fetch_events fe
             ON fe.run_id = rsp.run_id
            AND fe.lender_code = rsp.lender_code
            AND fe.dataset_kind = rsp.dataset_kind
            AND fe.source_type = 'cdr_products'
           WHERE rsp.run_id = rates.run_id
             AND rsp.dataset_kind = ?2
             AND rsp.bank_name = rates.bank_name
             AND rsp.product_id = rates.product_id
         )`,
    )
    .bind(input.cutoffDate, input.dataset)
    .run()
  return Number(result.meta?.changes ?? 0)
}

async function updateByRunIdAndSourceUrl(
  db: D1Database,
  table: DatasetTable['table'],
  cutoffDate: string,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE ${table} AS rates
       SET fetch_event_id = (
         SELECT fe.id
         FROM fetch_events fe
         WHERE fe.run_id = rates.run_id
           AND fe.source_url = rates.source_url
         ORDER BY fe.fetched_at DESC, fe.id DESC
         LIMIT 1
       )
       WHERE rates.fetch_event_id IS NULL
         AND rates.collection_date >= ?1
         AND rates.run_id IS NOT NULL
         AND TRIM(rates.run_id) != ''
         AND rates.source_url IS NOT NULL
         AND TRIM(rates.source_url) != ''
         AND EXISTS (
           SELECT 1
           FROM fetch_events fe
           WHERE fe.run_id = rates.run_id
             AND fe.source_url = rates.source_url
         )`,
    )
    .bind(cutoffDate)
    .run()
  return Number(result.meta?.changes ?? 0)
}

async function updateBySourceIdentity(
  db: D1Database,
  input: { dataset: DatasetKind; table: DatasetTable['table']; cutoffDate: string },
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE ${input.table} AS rates
       SET fetch_event_id = (
         SELECT fe.id
         FROM fetch_events fe
         WHERE fe.dataset_kind = ?2
           AND fe.source_type = 'cdr_product_detail'
           AND fe.source_url = rates.source_url
           AND fe.product_id = rates.product_id
           AND fe.collection_date = rates.collection_date
         ORDER BY fe.fetched_at DESC, fe.id DESC
         LIMIT 1
       )
       WHERE rates.fetch_event_id IS NULL
         AND rates.collection_date >= ?1
         AND rates.source_url IS NOT NULL
         AND TRIM(rates.source_url) != ''
         AND rates.product_id IS NOT NULL
         AND TRIM(rates.product_id) != ''
         AND EXISTS (
           SELECT 1
           FROM fetch_events fe
           WHERE fe.dataset_kind = ?2
             AND fe.source_type = 'cdr_product_detail'
             AND fe.source_url = rates.source_url
             AND fe.product_id = rates.product_id
             AND fe.collection_date = rates.collection_date
         )`,
    )
    .bind(input.cutoffDate, input.dataset)
    .run()
  return Number(result.meta?.changes ?? 0)
}

async function loadSyntheticCandidates(
  db: D1Database,
  input: { table: DatasetTable['table']; cutoffDate: string },
): Promise<SyntheticCandidate[]> {
  const rows = await db
    .prepare(
      `SELECT
         rates.cdr_product_detail_hash AS content_hash,
         MAX(NULLIF(TRIM(rates.source_url), '')) AS source_url,
         MAX(NULLIF(TRIM(rates.run_id), '')) AS run_id,
         MAX(NULLIF(TRIM(rates.product_id), '')) AS product_id,
         MAX(rates.collection_date) AS collection_date,
         COUNT(*) AS row_count
       FROM ${input.table} rates
       WHERE rates.fetch_event_id IS NULL
         AND rates.collection_date >= ?1
         AND rates.cdr_product_detail_hash IS NOT NULL
         AND TRIM(rates.cdr_product_detail_hash) != ''
         AND NOT EXISTS (
           SELECT 1
           FROM fetch_events fe
           WHERE fe.content_hash = rates.cdr_product_detail_hash
         )
       GROUP BY rates.cdr_product_detail_hash
       ORDER BY row_count DESC, content_hash ASC`,
    )
    .bind(input.cutoffDate)
    .all<SyntheticCandidate>()
  return rows.results ?? []
}

async function createSyntheticDetailFetchEvents(
  env: RepairEnv,
  target: DatasetTable,
  cutoffDate: string,
  dryRun: boolean,
): Promise<number> {
  const candidates = await loadSyntheticCandidates(env.DB, {
    table: target.table,
    cutoffDate,
  })
  if (dryRun || candidates.length === 0) {
    return candidates.reduce((sum, candidate) => sum + Number(candidate.row_count || 0), 0)
  }

  const payloadMap = await loadCdrDetailPayloadMap(
    env.DB,
    candidates.map((candidate) => String(candidate.content_hash || '').trim()).filter(Boolean),
  )

  let updatedRows = 0
  for (const candidate of candidates) {
    const contentHash = String(candidate.content_hash || '').trim()
    const payloadText = payloadMap.get(contentHash)
    if (!payloadText) continue

    const persisted = await persistRawPayload(env, {
      sourceType: 'cdr_product_detail',
      sourceUrl: candidate.source_url || `repaired://cdr-detail/${contentHash}`,
      payload: payloadText,
      httpStatus: 200,
      runId: candidate.run_id || null,
      dataset: target.dataset,
      jobKind: 'lineage_repair_detail_fetch',
      collectionDate: candidate.collection_date || null,
      productId: candidate.product_id || null,
      notes: `lineage_repair synthetic_detail_payload hash=${contentHash}`,
    })
    if (persisted.fetchEventId == null) continue

    const update = await env.DB
      .prepare(
        `UPDATE ${target.table}
         SET fetch_event_id = ?1
         WHERE fetch_event_id IS NULL
           AND collection_date >= ?2
           AND cdr_product_detail_hash = ?3`,
      )
      .bind(persisted.fetchEventId, cutoffDate, contentHash)
      .run()
    updatedRows += Number(update.meta?.changes ?? 0)
  }

  return updatedRows
}

async function unresolvedByDatasetAndRunSource(
  db: D1Database,
  cutoffDate: string,
): Promise<Array<{ dataset: DatasetKind; run_source: string; unresolved_rows: number }>> {
  const rows = await db
    .prepare(
      `SELECT dataset_kind, run_source, unresolved_rows
       FROM (
         SELECT 'home_loans' AS dataset_kind, run_source, COUNT(*) AS unresolved_rows
         FROM historical_loan_rates
         WHERE fetch_event_id IS NULL
           AND collection_date >= ?1
         GROUP BY run_source
         UNION ALL
         SELECT 'savings', run_source, COUNT(*)
         FROM historical_savings_rates
         WHERE fetch_event_id IS NULL
           AND collection_date >= ?1
         GROUP BY run_source
         UNION ALL
         SELECT 'term_deposits', run_source, COUNT(*)
         FROM historical_term_deposit_rates
         WHERE fetch_event_id IS NULL
           AND collection_date >= ?1
         GROUP BY run_source
       )
       ORDER BY unresolved_rows DESC, dataset_kind ASC, run_source ASC`,
    )
    .bind(cutoffDate)
    .all<Record<string, unknown>>()

  return (rows.results ?? []).map((row) => ({
    dataset: String(row.dataset_kind) as DatasetKind,
    run_source: String(row.run_source ?? 'unknown'),
    unresolved_rows: Number(row.unresolved_rows ?? 0),
  }))
}

export async function repairMissingFetchEventLineage(
  env: RepairEnv,
  input?: { lookbackDays?: number; dryRun?: boolean },
): Promise<LineageRepairResult> {
  const lookbackDays = clampLookbackDays(input?.lookbackDays)
  const cutoffDate = cutoffDateFromLookbackDays(lookbackDays)
  const dryRun = Boolean(input?.dryRun)
  const missingBefore = await countMissingFetchEventRows(env.DB, cutoffDate)

  const strategyCounts: Array<{ dataset: DatasetKind; strategy: string; rows: number }> = []
  for (const target of DATASET_TABLES) {
    const syntheticRows = await createSyntheticDetailFetchEvents(env, target, cutoffDate, dryRun)
    strategyCounts.push({ dataset: target.dataset, strategy: 'synthetic_detail_payload', rows: syntheticRows })

    if (dryRun) continue

    const byHashRows = await updateByDetailHash(env.DB, target.table, cutoffDate)
    strategyCounts.push({ dataset: target.dataset, strategy: 'detail_hash', rows: byHashRows })

    const byRunSeenRows = await updateByRunSeenProductIndex(env.DB, {
      dataset: target.dataset,
      table: target.table,
      cutoffDate,
    })
    strategyCounts.push({ dataset: target.dataset, strategy: 'run_seen_products_index', rows: byRunSeenRows })

    const byRunSourceRows = await updateByRunIdAndSourceUrl(env.DB, target.table, cutoffDate)
    strategyCounts.push({ dataset: target.dataset, strategy: 'run_id_source_url', rows: byRunSourceRows })

    const bySourceIdentityRows = await updateBySourceIdentity(env.DB, {
      dataset: target.dataset,
      table: target.table,
      cutoffDate,
    })
    strategyCounts.push({ dataset: target.dataset, strategy: 'source_identity', rows: bySourceIdentityRows })
  }

  const missingAfter = dryRun ? missingBefore : await countMissingFetchEventRows(env.DB, cutoffDate)
  const unresolved = await unresolvedByDatasetAndRunSource(env.DB, cutoffDate)

  return {
    cutoff_date: cutoffDate,
    lookback_days: lookbackDays,
    dry_run: dryRun,
    missing_before: missingBefore,
    missing_after: missingAfter,
    repaired_rows: Math.max(0, missingBefore - missingAfter),
    strategy_counts: strategyCounts,
    unresolved,
  }
}
