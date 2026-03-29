import { loadCdrDetailPayloadMap } from '../db/cdr-detail-payloads'
import { repairableFetchEventLineageClause } from '../db/fetch-event-lineage'
import { persistRawPayload } from '../db/raw-payloads'
import { resolveFetchEventIdByPayloadIdentity } from '../db/fetch-events'
import { repairMissingFetchEventLineageByBaseUrl } from './lineage-repair-base-url'
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

type DetailRawPayloadRow = {
  source_url: string
  fetched_at: string
  http_status: number | null
}

type RepairEnv = Pick<EnvBindings, 'DB' | 'RAW_BUCKET'>

type RepairScope = {
  runId?: string
  dataset?: DatasetKind
}

export type LineageRepairResult = {
  cutoff_date: string
  lookback_days: number
  dry_run: boolean
  filters: {
    run_id: string | null
    dataset: DatasetKind | null
  }
  missing_before: number
  missing_after: number
  repairable_before: number
  repairable_after: number
  repaired_rows: number
  strategy_counts: Array<{ dataset: DatasetKind; strategy: string; rows: number }>
  unresolved: Array<{ dataset: DatasetKind; run_source: string; unresolved_rows: number }>
}

const DATASET_TABLES: DatasetTable[] = [
  { dataset: 'home_loans', table: 'historical_loan_rates' },
  { dataset: 'savings', table: 'historical_savings_rates' },
  { dataset: 'term_deposits', table: 'historical_term_deposit_rates' },
]
const DETAIL_HASH_BATCH_SIZE = 100

function targetDatasetTables(dataset?: DatasetKind): DatasetTable[] {
  return dataset ? DATASET_TABLES.filter((target) => target.dataset === dataset) : DATASET_TABLES
}

function clampLookbackDays(input: number | null | undefined): number {
  const value = Math.floor(Number(input))
  if (!Number.isFinite(value)) return 365
  return Math.max(1, Math.min(3650, value))
}

function cutoffDateFromLookbackDays(lookbackDays: number): string {
  return new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function countMissingFetchEventRows(db: D1Database, cutoffDate: string): Promise<number> {
  return countRepairableRows(db, DATASET_TABLES, cutoffDate)
}

async function countRepairableRows(
  db: D1Database,
  targets: DatasetTable[],
  cutoffDate: string,
  runId?: string,
): Promise<number> {
  let total = 0
  for (const target of targets) {
    const query = runId
      ? `SELECT COUNT(*) AS n
         FROM ${target.table} rates
         WHERE ${repairableFetchEventLineageClause('rates', 'current_lineage')}
           AND rates.collection_date >= ?1
           AND rates.run_id = ?2`
      : `SELECT COUNT(*) AS n
         FROM ${target.table} rates
         WHERE ${repairableFetchEventLineageClause('rates', 'current_lineage')}
           AND rates.collection_date >= ?1`
    const row = await db.prepare(query).bind(...(runId ? [cutoffDate, runId] : [cutoffDate])).first<{ n: number }>()
    total += Number(row?.n ?? 0)
  }
  return total
}

async function updateByDetailHash(
  db: D1Database,
  table: DatasetTable['table'],
  cutoffDate: string,
  runId?: string,
): Promise<number> {
  let changed = 0

  while (true) {
    const hashesResult = await db
      .prepare(
        `SELECT DISTINCT rates.cdr_product_detail_hash AS content_hash
         FROM ${table} rates
         LEFT JOIN fetch_events current_lineage
           ON current_lineage.id = rates.fetch_event_id
         WHERE ${repairableFetchEventLineageClause('rates', 'current_lineage')}
           AND rates.collection_date >= ?1
           ${runId ? 'AND rates.run_id = ?2' : ''}
           AND rates.cdr_product_detail_hash IS NOT NULL
           AND TRIM(rates.cdr_product_detail_hash) != ''
           AND EXISTS (
             SELECT 1
             FROM fetch_events fe
             WHERE fe.content_hash = rates.cdr_product_detail_hash
           )
         ORDER BY rates.cdr_product_detail_hash ASC
         LIMIT ?${runId ? 3 : 2}`,
      )
      .bind(...(runId ? [cutoffDate, runId, DETAIL_HASH_BATCH_SIZE] : [cutoffDate, DETAIL_HASH_BATCH_SIZE]))
      .all<{ content_hash: string }>()

    const hashes = (hashesResult.results ?? [])
      .map((row) => String(row.content_hash || '').trim())
      .filter(Boolean)
    if (hashes.length === 0) break

    for (const contentHash of hashes) {
      const event = await db
        .prepare(
          `SELECT id
           FROM fetch_events
           WHERE content_hash = ?1
           ORDER BY fetched_at DESC, id DESC
           LIMIT 1`,
        )
        .bind(contentHash)
        .first<{ id: number }>()
      const fetchEventId = Number(event?.id ?? 0)
      if (!fetchEventId) continue

      const update = await db
        .prepare(
          `UPDATE ${table}
           SET fetch_event_id = ?1
           WHERE cdr_product_detail_hash = ?2
             AND collection_date >= ?3
             ${runId ? 'AND run_id = ?4' : ''}
             AND ${repairableFetchEventLineageClause(table, 'current_lineage').replaceAll(`${table}.`, '')}`,
        )
        .bind(...(runId ? [fetchEventId, contentHash, cutoffDate, runId] : [fetchEventId, contentHash, cutoffDate]))
        .run()
      changed += Number(update.meta?.changes ?? 0)
    }
  }

  return changed
}

async function updateByRunSeenProductIndex(
  db: D1Database,
  input: { dataset: DatasetKind; table: DatasetTable['table']; cutoffDate: string },
  runId?: string,
): Promise<number> {
  const runFilter = runId ? 'AND rates.run_id = ?3' : ''
  const result = await db
    .prepare(
      `UPDATE ${input.table} AS rates
       SET fetch_event_id = (
         SELECT fe.id
         FROM run_seen_products rsp
         JOIN fetch_events fe
           ON fe.run_id = rsp.run_id
          AND fe.lender_code = rsp.lender_code
          AND fe.source_type = 'cdr_products'
          AND (
            fe.dataset_kind = rsp.dataset_kind
            OR (rsp.dataset_kind = 'term_deposits' AND fe.dataset_kind = 'savings')
          )
         WHERE rsp.run_id = rates.run_id
           AND rsp.dataset_kind = ?2
           AND rsp.bank_name = rates.bank_name
           AND rsp.product_id = rates.product_id
         ORDER BY
           CASE WHEN COALESCE(fe.http_status, 0) BETWEEN 200 AND 299 THEN 0 ELSE 1 END ASC,
           CASE
             WHEN fe.dataset_kind = rsp.dataset_kind THEN 0
             WHEN rsp.dataset_kind = 'term_deposits' AND fe.dataset_kind = 'savings' THEN 1
             ELSE 2
           END ASC,
           CASE WHEN fe.source_url LIKE 'summary://%' THEN 1 ELSE 0 END ASC,
           fe.fetched_at DESC,
           fe.id DESC
         LIMIT 1
       )
       WHERE ${repairableFetchEventLineageClause('rates', 'current_lineage')}
         AND rates.collection_date >= ?1
         ${runFilter}
         AND rates.run_id IS NOT NULL
         AND TRIM(rates.run_id) != ''
         AND EXISTS (
           SELECT 1
           FROM run_seen_products rsp
           JOIN fetch_events fe
             ON fe.run_id = rsp.run_id
            AND fe.lender_code = rsp.lender_code
            AND fe.source_type = 'cdr_products'
            AND (
              fe.dataset_kind = rsp.dataset_kind
              OR (rsp.dataset_kind = 'term_deposits' AND fe.dataset_kind = 'savings')
            )
           WHERE rsp.run_id = rates.run_id
             AND rsp.dataset_kind = ?2
             AND rsp.bank_name = rates.bank_name
             AND rsp.product_id = rates.product_id
         )`,
    )
    .bind(...(runId ? [input.cutoffDate, input.dataset, runId] : [input.cutoffDate, input.dataset]))
    .run()
  return Number(result.meta?.changes ?? 0)
}

async function updateByRunIdAndSourceUrl(
  db: D1Database,
  table: DatasetTable['table'],
  cutoffDate: string,
  runId?: string,
): Promise<number> {
  const runFilter = runId ? 'AND rates.run_id = ?2' : ''
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
       WHERE ${repairableFetchEventLineageClause('rates', 'current_lineage')}
         AND rates.collection_date >= ?1
         ${runFilter}
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
    .bind(...(runId ? [cutoffDate, runId] : [cutoffDate]))
    .run()
  return Number(result.meta?.changes ?? 0)
}

async function updateBySourceIdentity(
  db: D1Database,
  input: { dataset: DatasetKind; table: DatasetTable['table']; cutoffDate: string },
  runId?: string,
): Promise<number> {
  const runFilter = runId ? 'AND rates.run_id = ?3' : ''
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
       WHERE ${repairableFetchEventLineageClause('rates', 'current_lineage')}
         AND rates.collection_date >= ?1
         ${runFilter}
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
    .bind(...(runId ? [input.cutoffDate, input.dataset, runId] : [input.cutoffDate, input.dataset]))
    .run()
  return Number(result.meta?.changes ?? 0)
}

async function loadSyntheticCandidates(
  db: D1Database,
  input: { table: DatasetTable['table']; cutoffDate: string; runId?: string },
): Promise<SyntheticCandidate[]> {
  const runFilter = input.runId ? 'AND rates.run_id = ?2' : ''
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
       WHERE ${repairableFetchEventLineageClause('rates', 'current_lineage')}
         AND rates.collection_date >= ?1
         ${runFilter}
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
    .bind(...(input.runId ? [input.cutoffDate, input.runId] : [input.cutoffDate]))
    .all<SyntheticCandidate>()
  return rows.results ?? []
}

async function createSyntheticDetailFetchEvents(
  env: RepairEnv,
  target: DatasetTable,
  cutoffDate: string,
  dryRun: boolean,
  runId?: string,
): Promise<number> {
  const candidates = await loadSyntheticCandidates(env.DB, {
    table: target.table,
    cutoffDate,
    runId,
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
    const rawPayload = await loadDetailRawPayloadByHash(env.DB, contentHash)
    if (rawPayload) {
      const fetchEventId = await ensureSyntheticDetailFetchEventFromRawPayload(env.DB, target, candidate, rawPayload)
      if (fetchEventId != null) {
        updatedRows += await updateSyntheticCandidateRows(env.DB, target.table, cutoffDate, contentHash, fetchEventId, runId)
        continue
      }
    }

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

    updatedRows += await updateSyntheticCandidateRows(env.DB, target.table, cutoffDate, contentHash, persisted.fetchEventId, runId)
  }

  return updatedRows
}

async function loadDetailRawPayloadByHash(
  db: D1Database,
  contentHash: string,
): Promise<DetailRawPayloadRow | null> {
  return db
    .prepare(
      `SELECT rp.source_url, rp.fetched_at, rp.http_status
       FROM raw_payloads rp
       JOIN raw_objects ro
         ON ro.content_hash = rp.content_hash
       WHERE rp.source_type = 'cdr_product_detail'
         AND rp.content_hash = ?1
       ORDER BY rp.fetched_at DESC, rp.id DESC
       LIMIT 1`,
    )
    .bind(contentHash)
    .first<DetailRawPayloadRow>()
}

async function ensureSyntheticDetailFetchEventFromRawPayload(
  db: D1Database,
  target: DatasetTable,
  candidate: SyntheticCandidate,
  rawPayload: DetailRawPayloadRow,
): Promise<number | null> {
  const sourceUrl = candidate.source_url || rawPayload.source_url
  const existingId = await resolveFetchEventIdByPayloadIdentity(db, {
    runId: candidate.run_id || null,
    lenderCode: null,
    dataset: target.dataset,
    sourceType: 'cdr_product_detail',
    sourceUrl,
    contentHash: candidate.content_hash,
    productId: candidate.product_id || null,
    collectionDate: candidate.collection_date || null,
  })
  if (existingId != null) return existingId

  const inserted = await db
    .prepare(
      `INSERT INTO fetch_events (
         run_id,
         lender_code,
         dataset_kind,
         source_type,
         source_url,
         collection_date,
         fetched_at,
         http_status,
         content_hash,
         product_id,
         raw_object_created
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      candidate.run_id || null,
      null,
      target.dataset,
      'cdr_product_detail',
      sourceUrl,
      candidate.collection_date || null,
      rawPayload.fetched_at,
      rawPayload.http_status == null ? null : Number(rawPayload.http_status),
      candidate.content_hash,
      candidate.product_id || null,
      0,
    )
    .run()

  return Number(inserted.meta?.last_row_id ?? 0) || null
}

async function updateSyntheticCandidateRows(
  db: D1Database,
  table: DatasetTable['table'],
  cutoffDate: string,
  contentHash: string,
  fetchEventId: number,
  runId?: string,
): Promise<number> {
  const runFilter = runId ? 'AND run_id = ?4' : ''
  const update = await db
    .prepare(
      `UPDATE ${table}
       SET fetch_event_id = ?1
       WHERE ${repairableFetchEventLineageClause(table, 'current_lineage').replaceAll(`${table}.`, '')}
         AND collection_date >= ?2
         AND cdr_product_detail_hash = ?3
         ${runFilter}`,
    )
    .bind(...(runId ? [fetchEventId, cutoffDate, contentHash, runId] : [fetchEventId, cutoffDate, contentHash]))
    .run()
  return Number(update.meta?.changes ?? 0)
}

async function unresolvedByDatasetAndRunSource(
  db: D1Database,
  cutoffDate: string,
  targets: DatasetTable[],
  runId?: string,
): Promise<Array<{ dataset: DatasetKind; run_source: string; unresolved_rows: number }>> {
  const rows: Array<{ dataset: DatasetKind; run_source: string; unresolved_rows: number }> = []
  for (const target of targets) {
    const query = runId
      ? `SELECT run_source, COUNT(*) AS unresolved_rows
         FROM ${target.table}
         WHERE ${repairableFetchEventLineageClause(target.table, 'current_lineage').replaceAll(`${target.table}.`, '')}
           AND collection_date >= ?1
           AND run_id = ?2
         GROUP BY run_source
         ORDER BY unresolved_rows DESC, run_source ASC`
      : `SELECT run_source, COUNT(*) AS unresolved_rows
         FROM ${target.table}
         WHERE ${repairableFetchEventLineageClause(target.table, 'current_lineage').replaceAll(`${target.table}.`, '')}
           AND collection_date >= ?1
         GROUP BY run_source
         ORDER BY unresolved_rows DESC, run_source ASC`
    const result = await db.prepare(query).bind(...(runId ? [cutoffDate, runId] : [cutoffDate])).all<Record<string, unknown>>()
    for (const row of result.results ?? []) {
      rows.push({
        dataset: target.dataset,
        run_source: String(row.run_source ?? 'unknown'),
        unresolved_rows: Number(row.unresolved_rows ?? 0),
      })
    }
  }
  return rows.sort((left, right) => right.unresolved_rows - left.unresolved_rows || left.dataset.localeCompare(right.dataset) || left.run_source.localeCompare(right.run_source))
}

export async function repairMissingFetchEventLineage(
  env: RepairEnv,
  input?: { lookbackDays?: number; dryRun?: boolean; runId?: string; dataset?: DatasetKind },
): Promise<LineageRepairResult> {
  const lookbackDays = clampLookbackDays(input?.lookbackDays)
  const cutoffDate = cutoffDateFromLookbackDays(lookbackDays)
  const dryRun = Boolean(input?.dryRun)
  const targets = targetDatasetTables(input?.dataset)
  const missingBefore = await countRepairableRows(env.DB, targets, cutoffDate, input?.runId)

  const strategyCounts: Array<{ dataset: DatasetKind; strategy: string; rows: number }> = []
  for (const target of targets) {
    if (!dryRun) {
      const byHashRows = await updateByDetailHash(env.DB, target.table, cutoffDate, input?.runId)
      strategyCounts.push({ dataset: target.dataset, strategy: 'detail_hash', rows: byHashRows })

      if (input?.runId) {
        const byRunSourceRows = await updateByRunIdAndSourceUrl(env.DB, target.table, cutoffDate, input.runId)
        strategyCounts.push({ dataset: target.dataset, strategy: 'run_id_source_url', rows: byRunSourceRows })

        const bySourceIdentityRows = await updateBySourceIdentity(
          env.DB,
          {
            dataset: target.dataset,
            table: target.table,
            cutoffDate,
          },
          input.runId,
        )
        strategyCounts.push({ dataset: target.dataset, strategy: 'source_identity', rows: bySourceIdentityRows })
      } else {
        strategyCounts.push({ dataset: target.dataset, strategy: 'run_id_source_url', rows: 0 })
        strategyCounts.push({ dataset: target.dataset, strategy: 'source_identity', rows: 0 })
      }
    }

    const byBaseUrlRows = await repairMissingFetchEventLineageByBaseUrl(env, target, cutoffDate, dryRun, input?.runId)
    strategyCounts.push({ dataset: target.dataset, strategy: 'base_url_cdr_products', rows: byBaseUrlRows })

    if (dryRun) continue

    if (input?.runId) {
      const byRunSeenRows = await updateByRunSeenProductIndex(
        env.DB,
        {
          dataset: target.dataset,
          table: target.table,
          cutoffDate,
        },
        input.runId,
      )
      strategyCounts.push({ dataset: target.dataset, strategy: 'run_seen_products_index', rows: byRunSeenRows })
    } else {
      strategyCounts.push({ dataset: target.dataset, strategy: 'run_seen_products_index', rows: 0 })
    }

    const syntheticRows = await createSyntheticDetailFetchEvents(env, target, cutoffDate, false, input?.runId)
    strategyCounts.push({ dataset: target.dataset, strategy: 'synthetic_detail_payload', rows: syntheticRows })
  }

  const missingAfter = dryRun ? missingBefore : await countRepairableRows(env.DB, targets, cutoffDate, input?.runId)
  const unresolved = await unresolvedByDatasetAndRunSource(env.DB, cutoffDate, targets, input?.runId)

  return {
    cutoff_date: cutoffDate,
    lookback_days: lookbackDays,
    dry_run: dryRun,
    filters: {
      run_id: input?.runId ?? null,
      dataset: input?.dataset ?? null,
    },
    missing_before: missingBefore,
    missing_after: missingAfter,
    repairable_before: missingBefore,
    repairable_after: missingAfter,
    repaired_rows: Math.max(0, missingBefore - missingAfter),
    strategy_counts: strategyCounts,
    unresolved,
  }
}
