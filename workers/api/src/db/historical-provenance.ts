import { repairMissingFetchEventLineage, type LineageRepairResult } from '../pipeline/lineage-repair'
import { FETCH_EVENT_PROVENANCE_ENFORCEMENT_START } from './retention-prune'
import { tdSeriesKeySql } from './term-deposits/identity'

type DatasetKind = 'home_loans' | 'savings' | 'term_deposits'
export type HistoricalProvenanceState =
  | 'verified_exact'
  | 'verified_reconstructed'
  | 'legacy_unverifiable'
  | 'quarantined'

type DatasetConfig = {
  dataset: DatasetKind
  table: 'historical_loan_rates' | 'historical_savings_rates' | 'historical_term_deposit_rates'
  seriesKeySql: string
}

type RawEnv = {
  DB: D1Database
  RAW_BUCKET: R2Bucket
}

type SummaryRow = {
  provenance_state: HistoricalProvenanceState
  n: number | null
}

type SampleRow = {
  dataset_kind: DatasetKind
  series_key: string
  collection_date: string
  bank_name: string
  product_id: string
  run_id: string | null
  provenance_state: HistoricalProvenanceState
  recovery_method: string | null
  reason_code: string
  verified_fetch_event_id: number | null
  verified_content_hash: string | null
  verified_source_url: string | null
  last_classified_at: string
}

export type HistoricalProvenanceSummary = {
  available: boolean
  checked_at: string | null
  lookback_days: number
  cutoff_date: string
  filters: {
    dataset: DatasetKind | null
    run_id: string | null
  }
  states: Record<HistoricalProvenanceState, number>
  by_dataset: Record<DatasetKind, Record<HistoricalProvenanceState, number>>
  legacy_unverifiable_rows: number
  quarantined_rows: number
  verified_exact_rows: number
  verified_reconstructed_rows: number
  legacy_unverifiable_sample: SampleRow[]
  quarantined_sample: SampleRow[]
}

export type HistoricalProvenanceRefreshResult = {
  ok: boolean
  recovery_job_id: string
  actor: string
  lookback_days: number
  cutoff_date: string
  filters: {
    dataset: DatasetKind | null
    run_id: string | null
  }
  status_rows_upserted: number
  log_rows_written: number
  summary: HistoricalProvenanceSummary
}

export type HistoricalProvenanceRecoveryResult = {
  ok: boolean
  recovery_job_id: string
  actor: string
  lookback_days: number
  cutoff_date: string
  filters: {
    dataset: DatasetKind | null
    run_id: string | null
  }
  repair: LineageRepairResult
  before: HistoricalProvenanceSummary
  after: HistoricalProvenanceSummary
  sync: HistoricalProvenanceRefreshResult
}

const DATASET_CONFIGS: DatasetConfig[] = [
  {
    dataset: 'home_loans',
    table: 'historical_loan_rates',
    seriesKeySql:
      "COALESCE(NULLIF(TRIM(rates.series_key), ''), rates.bank_name || '|' || rates.product_id || '|' || rates.security_purpose || '|' || rates.repayment_type || '|' || rates.lvr_tier || '|' || rates.rate_structure)",
  },
  {
    dataset: 'savings',
    table: 'historical_savings_rates',
    seriesKeySql:
      "COALESCE(NULLIF(TRIM(rates.series_key), ''), rates.bank_name || '|' || rates.product_id || '|' || rates.account_type || '|' || rates.rate_type || '|' || rates.deposit_tier)",
  },
  {
    dataset: 'term_deposits',
    table: 'historical_term_deposit_rates',
    seriesKeySql: tdSeriesKeySql('rates'),
  },
]

function clampLookbackDays(input: number | null | undefined): number {
  const value = Math.floor(Number(input))
  if (!Number.isFinite(value)) return 3650
  return Math.max(1, Math.min(3650, value))
}

function cutoffDateFromLookbackDays(lookbackDays: number): string {
  return new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM sqlite_master
       WHERE type = 'table' AND name = ?1`,
    )
    .bind(table)
    .first<{ n: number }>()
  return toNumber(row?.n) > 0
}

function buildRateScopeWhere(tableAlias: string, cutoffDate: string, runId?: string): { clause: string; binds: string[] } {
  const where = [`${tableAlias}.collection_date >= ?3`]
  const binds = [cutoffDate]
  if (runId) {
    where.push(`${tableAlias}.run_id = ?4`)
    binds.push(runId)
  }
  return {
    clause: where.join(' AND '),
    binds,
  }
}

function computedRowsSql(config: DatasetConfig, scopeClause: string): string {
  return `WITH computed AS (
      SELECT
        ?1 AS dataset_kind,
        ${config.seriesKeySql} AS series_key,
        rates.collection_date,
        rates.bank_name,
        rates.product_id,
        rates.run_id,
        prev.provenance_state AS previous_state,
        prev.verified_fetch_event_id AS previous_fetch_event_id,
        fe.id AS resolved_fetch_event_id,
        fe.source_type AS fetch_source_type,
        fe.source_url AS fetch_source_url,
        fe.product_id AS fetch_product_id,
        fe.content_hash AS fetch_content_hash,
        ro.content_hash AS raw_object_hash,
        CASE
          WHEN fe.id IS NOT NULL
           AND ro.content_hash IS NOT NULL
           AND fe.product_id IS NOT NULL
           AND TRIM(fe.product_id) != ''
           AND rates.product_id IS NOT NULL
           AND TRIM(rates.product_id) != ''
           AND fe.product_id != rates.product_id
          THEN 'quarantined'
          WHEN fe.id IS NOT NULL
           AND ro.content_hash IS NOT NULL
           AND (
             (
               rates.cdr_product_detail_hash IS NOT NULL
               AND TRIM(rates.cdr_product_detail_hash) != ''
               AND rates.cdr_product_detail_hash = fe.content_hash
             )
             OR (
               rates.source_url IS NOT NULL
               AND TRIM(rates.source_url) != ''
               AND rates.source_url = fe.source_url
             )
           )
          THEN CASE
            WHEN prev.provenance_state IN ('legacy_unverifiable', 'quarantined')
              OR (
                prev.verified_fetch_event_id IS NOT NULL
                AND prev.verified_fetch_event_id != fe.id
              )
            THEN 'verified_reconstructed'
            ELSE 'verified_exact'
          END
          WHEN fe.id IS NOT NULL AND ro.content_hash IS NOT NULL THEN 'verified_reconstructed'
          WHEN datetime(rates.parsed_at) < datetime(?2) THEN 'legacy_unverifiable'
          ELSE 'quarantined'
        END AS provenance_state,
        CASE
          WHEN fe.id IS NOT NULL
           AND ro.content_hash IS NOT NULL
           AND rates.cdr_product_detail_hash IS NOT NULL
           AND TRIM(rates.cdr_product_detail_hash) != ''
           AND rates.cdr_product_detail_hash = fe.content_hash
          THEN 'detail_hash'
          WHEN fe.id IS NOT NULL
           AND ro.content_hash IS NOT NULL
           AND rates.source_url IS NOT NULL
           AND TRIM(rates.source_url) != ''
           AND rates.source_url = fe.source_url
          THEN 'source_url_exact'
          WHEN fe.id IS NOT NULL AND ro.content_hash IS NOT NULL AND fe.source_type = 'cdr_product_detail'
          THEN 'cdr_product_detail_relink'
          WHEN fe.id IS NOT NULL AND ro.content_hash IS NOT NULL AND fe.source_type = 'wayback_html'
          THEN 'wayback_html_relink'
          WHEN fe.id IS NOT NULL AND ro.content_hash IS NOT NULL AND fe.source_type = 'cdr_products'
          THEN 'cdr_products_relink'
          ELSE NULL
        END AS recovery_method,
        CASE
          WHEN fe.id IS NOT NULL
           AND ro.content_hash IS NOT NULL
           AND fe.product_id IS NOT NULL
           AND TRIM(fe.product_id) != ''
           AND rates.product_id IS NOT NULL
           AND TRIM(rates.product_id) != ''
           AND fe.product_id != rates.product_id
          THEN 'fetch_event_product_id_conflict'
          WHEN fe.id IS NOT NULL
           AND ro.content_hash IS NOT NULL
           AND rates.cdr_product_detail_hash IS NOT NULL
           AND TRIM(rates.cdr_product_detail_hash) != ''
           AND rates.cdr_product_detail_hash = fe.content_hash
          THEN 'detail_hash_exact'
          WHEN fe.id IS NOT NULL
           AND ro.content_hash IS NOT NULL
           AND rates.source_url IS NOT NULL
           AND TRIM(rates.source_url) != ''
           AND rates.source_url = fe.source_url
          THEN 'source_url_exact'
          WHEN fe.id IS NOT NULL AND ro.content_hash IS NOT NULL
          THEN 'resolved_without_exact_row_match'
          WHEN datetime(rates.parsed_at) < datetime(?2)
          THEN 'legacy_missing_or_pruned_provenance'
          ELSE 'post_enforcement_lineage_failure'
        END AS reason_code,
        COALESCE(fe.id, rates.fetch_event_id) AS verified_fetch_event_id,
        COALESCE(fe.content_hash, NULLIF(TRIM(rates.cdr_product_detail_hash), '')) AS verified_content_hash,
        COALESCE(NULLIF(TRIM(fe.source_url), ''), NULLIF(TRIM(rates.source_url), '')) AS verified_source_url,
        json_object(
          'row_fetch_event_id', rates.fetch_event_id,
          'fetch_source_type', fe.source_type,
          'fetch_dataset_kind', fe.dataset_kind,
          'fetch_product_id', fe.product_id,
          'row_source_url', rates.source_url,
          'fetch_source_url', fe.source_url,
          'detail_content_hash', rates.cdr_product_detail_hash,
          'fetch_content_hash', fe.content_hash,
          'raw_object_present', CASE WHEN ro.content_hash IS NULL THEN 0 ELSE 1 END
        ) AS evidence_json
      FROM ${config.table} rates
      LEFT JOIN fetch_events fe
        ON fe.id = rates.fetch_event_id
      LEFT JOIN raw_objects ro
        ON ro.content_hash = fe.content_hash
       LEFT JOIN historical_provenance_status prev
         ON prev.dataset_kind = ?1
        AND prev.series_key = ${config.seriesKeySql}
        AND prev.collection_date = rates.collection_date
      WHERE ${scopeClause}
    )`
}

async function refreshDatasetStatus(
  db: D1Database,
  config: DatasetConfig,
  input: {
    actor: string
    recoveryJobId: string
    checkedAt: string
    cutoffDate: string
    runId?: string
  },
): Promise<{ statusRowsUpserted: number; logRowsWritten: number }> {
  const { clause, binds } = buildRateScopeWhere('rates', input.cutoffDate, input.runId)
  const cteSql = computedRowsSql(config, clause)
  const commonBinds = [config.dataset, FETCH_EVENT_PROVENANCE_ENFORCEMENT_START, ...binds]

  const logInsert = await db
    .prepare(
      `${cteSql}
       INSERT INTO historical_provenance_recovery_log (
         recovery_job_id,
         actor,
         dataset_kind,
         series_key,
         collection_date,
         bank_name,
         product_id,
         run_id,
         previous_state,
         new_state,
         recovery_method,
         reason_code,
         fetch_event_id,
         content_hash,
         source_url,
         evidence_json,
         created_at
       )
       SELECT
         ?${commonBinds.length + 1},
         ?${commonBinds.length + 2},
         computed.dataset_kind,
         computed.series_key,
         computed.collection_date,
         computed.bank_name,
         computed.product_id,
         computed.run_id,
         computed.previous_state,
         computed.provenance_state,
         computed.recovery_method,
         computed.reason_code,
         computed.verified_fetch_event_id,
         computed.verified_content_hash,
         computed.verified_source_url,
         computed.evidence_json,
         ?${commonBinds.length + 3}
       FROM computed
       WHERE computed.previous_state IS NULL
          OR computed.previous_state != computed.provenance_state
          OR COALESCE(computed.previous_fetch_event_id, -1) != COALESCE(computed.verified_fetch_event_id, -1)`,
    )
    .bind(...commonBinds, input.recoveryJobId, input.actor, input.checkedAt)
    .run()

  const statusUpsert = await db
    .prepare(
      `${cteSql}
       INSERT OR REPLACE INTO historical_provenance_status (
         dataset_kind,
         series_key,
         collection_date,
         bank_name,
         product_id,
         run_id,
         provenance_state,
         recovery_method,
         reason_code,
         verified_fetch_event_id,
         verified_content_hash,
         verified_source_url,
         evidence_json,
         first_classified_at,
         last_classified_at
       )
        SELECT
          computed.dataset_kind,
          computed.series_key,
          computed.collection_date,
          computed.bank_name,
          computed.product_id,
          computed.run_id,
          computed.provenance_state,
          computed.recovery_method,
          computed.reason_code,
          computed.verified_fetch_event_id,
          computed.verified_content_hash,
          computed.verified_source_url,
          computed.evidence_json,
          COALESCE(
            (
              SELECT existing.first_classified_at
              FROM historical_provenance_status existing
              WHERE existing.dataset_kind = computed.dataset_kind
                AND existing.series_key = computed.series_key
                AND existing.collection_date = computed.collection_date
            ),
            ?${commonBinds.length + 1}
          ),
          ?${commonBinds.length + 2}
        FROM computed`,
    )
    .bind(...commonBinds, input.checkedAt, input.checkedAt)
    .run()

  return {
    statusRowsUpserted: toNumber(statusUpsert.meta?.changes),
    logRowsWritten: toNumber(logInsert.meta?.changes),
  }
}

async function readSummary(
  db: D1Database,
  input: { lookbackDays?: number; dataset?: DatasetKind; runId?: string; limit?: number },
): Promise<HistoricalProvenanceSummary> {
  const lookbackDays = clampLookbackDays(input.lookbackDays)
  const cutoffDate = cutoffDateFromLookbackDays(lookbackDays)
  const limit = Math.max(1, Math.min(50, Math.floor(Number(input.limit) || 20)))
  const where = ['collection_date >= ?1']
  const binds: Array<string | number> = [cutoffDate]
  if (input.dataset) {
    where.push(`dataset_kind = ?${binds.length + 1}`)
    binds.push(input.dataset)
  }
  if (input.runId) {
    where.push(`run_id = ?${binds.length + 1}`)
    binds.push(input.runId)
  }
  const whereClause = `WHERE ${where.join(' AND ')}`

  const hasTable = await tableExists(db, 'historical_provenance_status')
  const emptyStates: Record<HistoricalProvenanceState, number> = {
    verified_exact: 0,
    verified_reconstructed: 0,
    legacy_unverifiable: 0,
    quarantined: 0,
  }
  const emptyByDataset: Record<DatasetKind, Record<HistoricalProvenanceState, number>> = {
    home_loans: { ...emptyStates },
    savings: { ...emptyStates },
    term_deposits: { ...emptyStates },
  }

  if (!hasTable) {
    return {
      available: false,
      checked_at: null,
      lookback_days: lookbackDays,
      cutoff_date: cutoffDate,
      filters: { dataset: input.dataset ?? null, run_id: input.runId ?? null },
      states: emptyStates,
      by_dataset: emptyByDataset,
      legacy_unverifiable_rows: 0,
      quarantined_rows: 0,
      verified_exact_rows: 0,
      verified_reconstructed_rows: 0,
      legacy_unverifiable_sample: [],
      quarantined_sample: [],
    }
  }

  const [summaryRows, sampleRows, latestRow] = await Promise.all([
    db
      .prepare(
        `SELECT dataset_kind, provenance_state, COUNT(*) AS n
         FROM historical_provenance_status
         ${whereClause}
         GROUP BY dataset_kind, provenance_state`,
      )
      .bind(...binds)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT dataset_kind, series_key, collection_date, bank_name, product_id, run_id,
                provenance_state, recovery_method, reason_code, verified_fetch_event_id,
                verified_content_hash, verified_source_url, last_classified_at
         FROM historical_provenance_status
         ${whereClause}
           AND provenance_state IN ('legacy_unverifiable', 'quarantined')
         ORDER BY
           CASE provenance_state WHEN 'quarantined' THEN 0 ELSE 1 END ASC,
           collection_date DESC,
           last_classified_at DESC
         LIMIT ?${binds.length + 1}`,
      )
      .bind(...binds, limit)
      .all<SampleRow>(),
    db
      .prepare(
        `SELECT MAX(last_classified_at) AS checked_at
         FROM historical_provenance_status
         ${whereClause}`,
      )
      .bind(...binds)
      .first<{ checked_at: string | null }>(),
  ])

  const states = { ...emptyStates }
  const byDataset: Record<DatasetKind, Record<HistoricalProvenanceState, number>> = {
    home_loans: { ...emptyStates },
    savings: { ...emptyStates },
    term_deposits: { ...emptyStates },
  }

  for (const row of summaryRows.results ?? []) {
    const dataset = String(row.dataset_kind || '') as DatasetKind
    const state = String(row.provenance_state || '') as HistoricalProvenanceState
    if (!(dataset in byDataset) || !(state in states)) continue
    const count = toNumber(row.n)
    states[state] += count
    byDataset[dataset][state] += count
  }

  const samples = sampleRows.results ?? []
  return {
    available: true,
    checked_at: latestRow?.checked_at ?? null,
    lookback_days: lookbackDays,
    cutoff_date: cutoffDate,
    filters: { dataset: input.dataset ?? null, run_id: input.runId ?? null },
    states,
    by_dataset: byDataset,
    legacy_unverifiable_rows: states.legacy_unverifiable,
    quarantined_rows: states.quarantined,
    verified_exact_rows: states.verified_exact,
    verified_reconstructed_rows: states.verified_reconstructed,
    legacy_unverifiable_sample: samples.filter((row) => row.provenance_state === 'legacy_unverifiable'),
    quarantined_sample: samples.filter((row) => row.provenance_state === 'quarantined'),
  }
}

export async function getHistoricalProvenanceSummary(
  db: D1Database,
  input?: { lookbackDays?: number; dataset?: DatasetKind; runId?: string; limit?: number },
): Promise<HistoricalProvenanceSummary> {
  return readSummary(db, input || {})
}

export async function refreshHistoricalProvenanceStatus(
  db: D1Database,
  input?: { lookbackDays?: number; dataset?: DatasetKind; runId?: string; actor?: string; recoveryJobId?: string },
): Promise<HistoricalProvenanceRefreshResult> {
  const lookbackDays = clampLookbackDays(input?.lookbackDays)
  const cutoffDate = cutoffDateFromLookbackDays(lookbackDays)
  const actor = String(input?.actor || 'system').trim() || 'system'
  const recoveryJobId = String(input?.recoveryJobId || `historical-provenance:${new Date().toISOString()}:${crypto.randomUUID()}`)
  const checkedAt = new Date().toISOString()
  const targets = input?.dataset
    ? DATASET_CONFIGS.filter((config) => config.dataset === input.dataset)
    : DATASET_CONFIGS

  let statusRowsUpserted = 0
  let logRowsWritten = 0
  for (const target of targets) {
    const result = await refreshDatasetStatus(db, target, {
      actor,
      recoveryJobId,
      checkedAt,
      cutoffDate,
      runId: input?.runId,
    })
    statusRowsUpserted += result.statusRowsUpserted
    logRowsWritten += result.logRowsWritten
  }

  const summary = await readSummary(db, {
    lookbackDays,
    dataset: input?.dataset,
    runId: input?.runId,
  })

  return {
    ok: true,
    recovery_job_id: recoveryJobId,
    actor,
    lookback_days: lookbackDays,
    cutoff_date: cutoffDate,
    filters: {
      dataset: input?.dataset ?? null,
      run_id: input?.runId ?? null,
    },
    status_rows_upserted: statusRowsUpserted,
    log_rows_written: logRowsWritten,
    summary,
  }
}

export async function runHistoricalProvenanceRecoveryProgram(
  env: RawEnv,
  input?: { lookbackDays?: number; dataset?: DatasetKind; runId?: string; dryRun?: boolean; actor?: string },
): Promise<HistoricalProvenanceRecoveryResult> {
  const lookbackDays = clampLookbackDays(input?.lookbackDays)
  const cutoffDate = cutoffDateFromLookbackDays(lookbackDays)
  const actor = String(input?.actor || 'admin').trim() || 'admin'
  const recoveryJobId = `historical-provenance-recovery:${new Date().toISOString()}:${crypto.randomUUID()}`
  const before = await readSummary(env.DB, {
    lookbackDays,
    dataset: input?.dataset,
    runId: input?.runId,
  })
  const repair = await repairMissingFetchEventLineage(env, {
    lookbackDays,
    runId: input?.runId,
    dataset: input?.dataset,
    dryRun: Boolean(input?.dryRun),
  })
  const sync = input?.dryRun
    ? {
        ok: true,
        recovery_job_id: recoveryJobId,
        actor,
        lookback_days: lookbackDays,
        cutoff_date: cutoffDate,
        filters: {
          dataset: input?.dataset ?? null,
          run_id: input?.runId ?? null,
        },
        status_rows_upserted: 0,
        log_rows_written: 0,
        summary: before,
      }
    : await refreshHistoricalProvenanceStatus(env.DB, {
        lookbackDays,
        dataset: input?.dataset,
        runId: input?.runId,
        actor,
        recoveryJobId,
      })
  const after = input?.dryRun
    ? before
    : await readSummary(env.DB, {
        lookbackDays,
        dataset: input?.dataset,
        runId: input?.runId,
      })

  return {
    ok: true,
    recovery_job_id: recoveryJobId,
    actor,
    lookback_days: lookbackDays,
    cutoff_date: cutoffDate,
    filters: {
      dataset: input?.dataset ?? null,
      run_id: input?.runId ?? null,
    },
    repair,
    before,
    after,
    sync,
  }
}
