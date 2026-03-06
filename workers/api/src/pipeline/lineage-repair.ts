type DatasetKind = 'home_loans' | 'savings' | 'term_deposits'

type DatasetTable = {
  dataset: DatasetKind
  table: 'historical_loan_rates' | 'historical_savings_rates' | 'historical_term_deposit_rates'
}

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
  if (!Number.isFinite(value)) return 120
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
  db: D1Database,
  input?: { lookbackDays?: number; dryRun?: boolean },
): Promise<LineageRepairResult> {
  const lookbackDays = clampLookbackDays(input?.lookbackDays)
  const cutoffDate = cutoffDateFromLookbackDays(lookbackDays)
  const dryRun = Boolean(input?.dryRun)
  const missingBefore = await countMissingFetchEventRows(db, cutoffDate)

  const strategyCounts: Array<{ dataset: DatasetKind; strategy: string; rows: number }> = []
  if (!dryRun) {
    for (const target of DATASET_TABLES) {
      const byHashRows = await updateByDetailHash(db, target.table, cutoffDate)
      strategyCounts.push({ dataset: target.dataset, strategy: 'detail_hash', rows: byHashRows })

      const byRunSeenRows = await updateByRunSeenProductIndex(db, {
        dataset: target.dataset,
        table: target.table,
        cutoffDate,
      })
      strategyCounts.push({ dataset: target.dataset, strategy: 'run_seen_products_index', rows: byRunSeenRows })

      const byRunSourceRows = await updateByRunIdAndSourceUrl(db, target.table, cutoffDate)
      strategyCounts.push({ dataset: target.dataset, strategy: 'run_id_source_url', rows: byRunSourceRows })
    }
  }

  const missingAfter = await countMissingFetchEventRows(db, cutoffDate)
  const unresolved = await unresolvedByDatasetAndRunSource(db, cutoffDate)

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
