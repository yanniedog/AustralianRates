import { Hono } from 'hono'
import {
  missingFetchEventLineageClause,
  repairableFetchEventLineageClause,
} from '../db/fetch-event-lineage'
import { FETCH_EVENTS_RETENTION_DAYS } from '../db/retention-prune'
import { repairCatalogAndPresence } from '../pipeline/catalog-presence-repair'
import { repairLegacyRawPayloadLinkage } from '../pipeline/legacy-raw-payload-repair'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'
import type { DatasetKind } from '../../../../packages/shared/src'

const DATASET_TABLES = [
  { dataset: 'home_loans', table: 'historical_loan_rates' },
  { dataset: 'savings', table: 'historical_savings_rates' },
  { dataset: 'term_deposits', table: 'historical_term_deposit_rates' },
] as const

function parseDataset(value: string | undefined): DatasetKind | null {
  if (value === 'home_loans' || value === 'savings' || value === 'term_deposits') {
    return value
  }
  return null
}

function buildRatesWhere(
  target: (typeof DATASET_TABLES)[number],
  input: { runId?: string; lenderCode?: string; cutoffDate: string },
): { clause: string; binds: string[] } {
  const where: string[] = [`rates.collection_date >= ?1`]
  const binds: string[] = [input.cutoffDate]

  if (input.runId) {
    where.push(`rates.run_id = ?${binds.length + 1}`)
    binds.push(input.runId)
  }
  if (input.lenderCode) {
    const lenderBindIndex = binds.length + 1
    const datasetBindIndex = binds.length + 2
    where.push(
      `EXISTS (
         SELECT 1
         FROM lender_dataset_runs ldr
         WHERE ldr.run_id = rates.run_id
           AND ldr.dataset_kind = ?${datasetBindIndex}
           AND ldr.bank_name = rates.bank_name
           AND ldr.lender_code = ?${lenderBindIndex}
       )`,
    )
    binds.push(input.lenderCode, target.dataset)
  }

  return {
    clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    binds,
  }
}

export const adminRemediationRoutes = new Hono<AppContext>()

adminRemediationRoutes.get('/diagnostics/lineage', async (c) => {
  const runId = String(c.req.query('run_id') || '').trim() || undefined
  const lenderCode = String(c.req.query('lender_code') || '').trim() || undefined
  const datasetFilter = parseDataset(c.req.query('dataset'))
  const lookbackDays = Math.max(
    1,
    Math.min(3650, Math.floor(Number(c.req.query('lookback_days') || FETCH_EVENTS_RETENTION_DAYS))),
  )
  const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  if (c.req.query('dataset') && !datasetFilter) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'dataset must be one of home_loans, savings, term_deposits.')
  }

  const targets = datasetFilter ? DATASET_TABLES.filter((item) => item.dataset === datasetFilter) : DATASET_TABLES
  const datasets = []
  for (const target of targets) {
    const { clause, binds } = buildRatesWhere(target, { runId, lenderCode, cutoffDate })
    const counts = await c.env.DB
      .prepare(
        `SELECT
           COUNT(*) AS total_rows,
           SUM(CASE WHEN ${missingFetchEventLineageClause('rates')} THEN 1 ELSE 0 END) AS missing_fetch_event_rows,
           SUM(CASE WHEN rates.fetch_event_id IS NOT NULL AND lineage.id IS NULL THEN 1 ELSE 0 END) AS unresolved_fetch_event_rows,
           SUM(CASE WHEN ${repairableFetchEventLineageClause('rates', 'lineage')} THEN 1 ELSE 0 END) AS repairable_fetch_event_rows,
           SUM(
             CASE
               WHEN ${repairableFetchEventLineageClause('rates', 'lineage')}
                AND (rates.cdr_product_detail_hash IS NULL OR TRIM(rates.cdr_product_detail_hash) = '')
               THEN 1 ELSE 0
             END
           ) AS missing_hash_rows
         FROM ${target.table} rates
         LEFT JOIN fetch_events lineage
           ON lineage.id = rates.fetch_event_id
         ${clause}`,
      )
      .bind(...binds)
      .first<Record<string, unknown>>()

    const sample = await c.env.DB
      .prepare(
        `SELECT
           rates.bank_name,
           rates.product_id,
           rates.collection_date,
           rates.run_id,
           rates.source_url,
           rates.fetch_event_id,
           rates.cdr_product_detail_hash,
           CASE
             WHEN ${missingFetchEventLineageClause('rates')} THEN 'missing'
             ELSE 'unresolved'
           END AS lineage_state
         FROM ${target.table} rates
         LEFT JOIN fetch_events repairable_sample_lineage
           ON repairable_sample_lineage.id = rates.fetch_event_id
         ${clause ? `${clause} AND` : 'WHERE'}
           ${repairableFetchEventLineageClause('rates', 'repairable_sample_lineage')}
         ORDER BY rates.collection_date DESC, rates.parsed_at DESC
         LIMIT 10`,
      )
      .bind(...binds)
      .all<Record<string, unknown>>()

    datasets.push({
      dataset: target.dataset,
      total_rows: Number(counts?.total_rows ?? 0),
      missing_fetch_event_rows: Number(counts?.missing_fetch_event_rows ?? 0),
      unresolved_fetch_event_rows: Number(counts?.unresolved_fetch_event_rows ?? 0),
      repairable_fetch_event_rows: Number(counts?.repairable_fetch_event_rows ?? 0),
      missing_hash_rows: Number(counts?.missing_hash_rows ?? 0),
      sample: sample.results ?? [],
    })
  }

  const fetchEventWhere: string[] = []
  const fetchEventBinds: string[] = []
  if (runId) {
    fetchEventWhere.push(`run_id = ?${fetchEventBinds.length + 1}`)
    fetchEventBinds.push(runId)
  }
  if (lenderCode) {
    fetchEventWhere.push(`lender_code = ?${fetchEventBinds.length + 1}`)
    fetchEventBinds.push(lenderCode)
  }
  if (datasetFilter) {
    fetchEventWhere.push(`dataset_kind = ?${fetchEventBinds.length + 1}`)
    fetchEventBinds.push(datasetFilter)
  }

  const fetchEvents = await c.env.DB
    .prepare(
      `SELECT source_type, COUNT(*) AS count
       FROM fetch_events
       ${fetchEventWhere.length ? `WHERE ${fetchEventWhere.join(' AND ')}` : ''}
       GROUP BY source_type
       ORDER BY count DESC, source_type ASC`,
    )
    .bind(...fetchEventBinds)
    .all<Record<string, unknown>>()

  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    filters: {
      run_id: runId ?? null,
      lender_code: lenderCode ?? null,
      dataset: datasetFilter ?? null,
      lookback_days: lookbackDays,
      cutoff_date: cutoffDate,
    },
    fetch_events: fetchEvents.results ?? [],
    datasets,
  })
})

adminRemediationRoutes.post('/runs/repair-catalog-presence', async (c) => {
  const result = await repairCatalogAndPresence(c.env.DB)
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    result,
  })
})

adminRemediationRoutes.post('/runs/repair-legacy-raw-linkage', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const dryRun = Boolean(body.dry_run ?? body.dryRun)
  const limit = Number(body.limit ?? 500)
  const result = await repairLegacyRawPayloadLinkage(c.env, {
    dryRun,
    limit,
  })
  return c.json({
    ok: true,
    auth_mode: c.get('adminAuthState')?.mode || null,
    result,
  })
})
