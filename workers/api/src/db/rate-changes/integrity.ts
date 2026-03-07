import type { RateChangeDataset, RateChangeDatasetConfig } from './config'
import { buildMissingKeyClause, buildRateChangeCte, buildRateChangeIncludedCte } from './sql'

export type IntegritySeverity = 'info' | 'warn' | 'error'

export type RateChangeIntegrityCheck = {
  id: string
  title: string
  passed: boolean
  severity: IntegritySeverity
  metrics: Record<string, number | string | boolean | null>
  sample_rows: Array<Record<string, unknown>>
  detail: string
}

export type RateChangeIntegrity = {
  dataset: RateChangeDataset
  checked_at: string
  ok: boolean
  stale: boolean
  status: 'ok' | 'warn' | 'error'
  summary: string
  excluded_rows: {
    total: number
    included: number
    malformed_key: number
    low_confidence: number
    out_of_range: number
  }
  checks: RateChangeIntegrityCheck[]
}

function rows<T>(result: D1Result<T>): T[] {
  return result.results ?? []
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function summarizeIntegrity(checks: RateChangeIntegrityCheck[]): { ok: boolean; status: 'ok' | 'warn' | 'error'; summary: string } {
  const failed = checks.filter((check) => !check.passed)
  if (failed.length === 0) {
    return {
      ok: true,
      status: 'ok',
      summary: 'Integrity checks passed with no collisions, duplicate transitions, or malformed-key omissions.',
    }
  }

  const hasError = failed.some((check) => check.severity === 'error')
  const topIssue = failed[0]
  return {
    ok: false,
    status: hasError ? 'error' : 'warn',
    summary: `${failed.length} integrity check(s) failed. Top issue: ${topIssue.title}.`,
  }
}

export async function queryRateChangeIntegrity(
  db: D1Database,
  config: RateChangeDatasetConfig,
): Promise<RateChangeIntegrity> {
  const missingKeyClause = buildMissingKeyClause(config, 'h')
  const nowIso = new Date().toISOString()

  const [missingCountResult, missingSamplesResult] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM ${config.table} h
         WHERE ${missingKeyClause}`,
      )
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT
           h.collection_date,
           h.parsed_at,
           h.bank_name,
           h.product_id,
           h.product_name,
           h.interest_rate,
           h.confidence_score
         FROM ${config.table} h
         WHERE ${missingKeyClause}
         ORDER BY h.collection_date DESC, h.parsed_at DESC
         LIMIT 8`,
      )
      .all<Record<string, unknown>>(),
  ])

  const missingKeyCount = num(missingCountResult?.total)
  const missingKeyCheck: RateChangeIntegrityCheck = {
    id: 'missing_key_dimensions',
    title: 'Missing product-key dimensions',
    passed: missingKeyCount === 0,
    severity: 'error',
    metrics: {
      missing_rows: missingKeyCount,
      key_dimensions: config.keyDimensions.join(','),
    },
    sample_rows: rows(missingSamplesResult),
    detail:
      missingKeyCount === 0
        ? 'All rows required for change-series identity are present.'
        : 'One or more rows are missing required change-series dimensions and were excluded from change derivation.',
  }

  const excludedRowResult = await db
    .prepare(
      `SELECT
         COUNT(*) AS total_rows,
         SUM(CASE WHEN ${missingKeyClause} THEN 1 ELSE 0 END) AS malformed_key_rows,
         SUM(CASE WHEN NOT (${missingKeyClause}) AND h.confidence_score < ? THEN 1 ELSE 0 END) AS low_confidence_rows,
         SUM(
           CASE
             WHEN NOT (${missingKeyClause}) AND h.confidence_score >= ? AND (h.interest_rate < ? OR h.interest_rate > ?)
             THEN 1 ELSE 0
           END
         ) AS out_of_range_rows,
         SUM(
           CASE
             WHEN NOT (${missingKeyClause}) AND h.confidence_score >= ? AND h.interest_rate BETWEEN ? AND ?
             THEN 1 ELSE 0
           END
         ) AS included_rows
       FROM ${config.table} h`,
    )
    .bind(
      config.minConfidence,
      config.minConfidence,
      config.minRate,
      config.maxRate,
      config.minConfidence,
      config.minRate,
      config.maxRate,
    )
    .first<{
      total_rows: number
      malformed_key_rows: number
      low_confidence_rows: number
      out_of_range_rows: number
      included_rows: number
    }>()

  const excludedRows = {
    total: num(excludedRowResult?.total_rows),
    malformed_key: num(excludedRowResult?.malformed_key_rows),
    low_confidence: num(excludedRowResult?.low_confidence_rows),
    out_of_range: num(excludedRowResult?.out_of_range_rows),
    included: num(excludedRowResult?.included_rows),
  }
  const expectedExcluded = Math.max(0, excludedRows.total - excludedRows.included)
  const trackedExcluded = excludedRows.malformed_key + excludedRows.low_confidence + excludedRows.out_of_range
  const excludedAccountingCheck: RateChangeIntegrityCheck = {
    id: 'excluded_row_accounting',
    title: 'Excluded-row accounting',
    passed: expectedExcluded === trackedExcluded,
    severity: 'error',
    metrics: {
      total_rows: excludedRows.total,
      included_rows: excludedRows.included,
      expected_excluded_rows: expectedExcluded,
      tracked_excluded_rows: trackedExcluded,
      malformed_key_rows: excludedRows.malformed_key,
      low_confidence_rows: excludedRows.low_confidence,
      out_of_range_rows: excludedRows.out_of_range,
      min_confidence: config.minConfidence,
      min_rate: config.minRate,
      max_rate: config.maxRate,
    },
    sample_rows: [],
    detail:
      expectedExcluded === trackedExcluded
        ? 'Excluded rows are fully accounted for by malformed key, low confidence, and out-of-range reasons.'
        : 'Excluded rows do not reconcile with the tracked exclusion categories.',
  }

  const includedCte = buildRateChangeIncludedCte(config)
  const [collisionCountResult, collisionSamplesResult] = await Promise.all([
    db
      .prepare(
        `${includedCte.cte},
         collisions AS (
           SELECT
             series_key,
             run_id,
             MAX(collection_date) AS collection_date,
             COUNT(*) AS row_count,
             COUNT(DISTINCT interest_rate) AS distinct_rates
           FROM included
           GROUP BY series_key, run_id
           HAVING COUNT(DISTINCT interest_rate) > 1
         )
         SELECT
           COUNT(*) AS collision_groups,
           COALESCE(SUM(row_count), 0) AS collision_rows
         FROM collisions`,
      )
      .bind(...includedCte.bindings)
      .first<{ collision_groups: number; collision_rows: number }>(),
    db
      .prepare(
        `${includedCte.cte},
         collisions AS (
           SELECT
             series_key,
             run_id,
             MAX(collection_date) AS collection_date,
             COUNT(*) AS row_count,
             COUNT(DISTINCT interest_rate) AS distinct_rates
           FROM included
           GROUP BY series_key, run_id
           HAVING COUNT(DISTINCT interest_rate) > 1
         ),
         ranked_samples AS (
           SELECT
             c.series_key,
             c.run_id,
             c.collection_date,
             c.row_count,
             c.distinct_rates,
             i.product_key,
             i.bank_name,
             i.product_name,
             i.interest_rate,
             i.parsed_at,
             ROW_NUMBER() OVER (
               PARTITION BY c.series_key, c.run_id
               ORDER BY i.parsed_at DESC
             ) AS sample_rank
           FROM collisions c
           JOIN included i
             ON i.series_key = c.series_key
            AND i.run_id = c.run_id
         )
         SELECT
           series_key,
           run_id,
           product_key,
           collection_date,
           row_count,
           distinct_rates,
           bank_name,
           product_name,
           interest_rate,
           parsed_at
         FROM ranked_samples
         WHERE sample_rank <= 3
         ORDER BY collection_date DESC, parsed_at DESC
         LIMIT 12`,
      )
      .bind(...includedCte.bindings)
      .all<Record<string, unknown>>(),
  ])

  const collisionGroups = num(collisionCountResult?.collision_groups)
  const collisionRows = num(collisionCountResult?.collision_rows)
  const collisionCheck: RateChangeIntegrityCheck = {
    id: 'identity_collisions',
    title: 'Identity collisions within a single run (series_key + run_id)',
    passed: collisionGroups === 0,
    severity: 'error',
    metrics: {
      collision_groups: collisionGroups,
      collision_rows: collisionRows,
    },
    sample_rows: rows(collisionSamplesResult),
    detail:
      collisionGroups === 0
        ? 'No same-run series collisions with conflicting rates were detected.'
        : 'At least one single-run change series resolves to multiple rate values.',
  }

  const changedCte = buildRateChangeCte(config)
  const [duplicateCountResult, duplicateSamplesResult] = await Promise.all([
    db
      .prepare(
        `${changedCte.cte},
         duplicate_transitions AS (
           SELECT
             series_key,
             collection_date,
             previous_rate,
             new_rate,
             COUNT(*) AS transition_count
           FROM changed
           GROUP BY series_key, collection_date, previous_rate, new_rate
           HAVING COUNT(*) > 1
         )
         SELECT
           COUNT(*) AS duplicate_groups,
           COALESCE(SUM(transition_count), 0) AS duplicate_rows
         FROM duplicate_transitions`,
      )
      .bind(...changedCte.bindings)
      .first<{ duplicate_groups: number; duplicate_rows: number }>(),
    db
      .prepare(
        `${changedCte.cte},
         duplicate_transitions AS (
           SELECT
             series_key,
             collection_date,
             previous_rate,
             new_rate,
             COUNT(*) AS transition_count
           FROM changed
           GROUP BY series_key, collection_date, previous_rate, new_rate
           HAVING COUNT(*) > 1
         ),
         ranked_samples AS (
           SELECT
             d.series_key,
             d.collection_date,
             d.previous_rate,
             d.new_rate,
             d.transition_count,
             c.product_key,
             c.bank_name,
             c.product_name,
             c.changed_at,
             ROW_NUMBER() OVER (
               PARTITION BY d.series_key, d.collection_date, d.previous_rate, d.new_rate
               ORDER BY c.changed_at DESC
             ) AS sample_rank
           FROM duplicate_transitions d
           JOIN changed c
             ON c.series_key = d.series_key
            AND c.collection_date = d.collection_date
            AND c.previous_rate = d.previous_rate
            AND c.new_rate = d.new_rate
         )
         SELECT
           series_key,
           product_key,
           collection_date,
           previous_rate,
           new_rate,
           transition_count,
            bank_name,
            product_name,
            changed_at
         FROM ranked_samples
         WHERE sample_rank <= 3
         ORDER BY collection_date DESC, changed_at DESC
         LIMIT 12`,
      )
      .bind(...changedCte.bindings)
      .all<Record<string, unknown>>(),
  ])

  const duplicateGroups = num(duplicateCountResult?.duplicate_groups)
  const duplicateRows = num(duplicateCountResult?.duplicate_rows)
  const duplicateTransitionCheck: RateChangeIntegrityCheck = {
    id: 'duplicate_transitions',
    title: 'Duplicate transitions (same series/date/rate pair)',
    passed: duplicateGroups === 0,
    severity: 'warn',
    metrics: {
      duplicate_groups: duplicateGroups,
      duplicate_rows: duplicateRows,
    },
    sample_rows: rows(duplicateSamplesResult),
    detail:
      duplicateGroups === 0
        ? 'No duplicate transition rows were detected.'
        : 'Duplicate transition records were detected for at least one series/date/rate pair.',
  }

  const checks = [missingKeyCheck, collisionCheck, duplicateTransitionCheck, excludedAccountingCheck]
  const summarized = summarizeIntegrity(checks)

  return {
    dataset: config.dataset,
    checked_at: nowIso,
    ok: summarized.ok,
    stale: !summarized.ok,
    status: summarized.status,
    summary: summarized.summary,
    excluded_rows: excludedRows,
    checks,
  }
}
