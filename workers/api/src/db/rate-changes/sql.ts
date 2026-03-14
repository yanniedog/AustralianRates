import type { RateChangeDatasetConfig } from './config'

export type RateChangeQueryInput = {
  limit?: number
  offset?: number
  windowStartDate?: string
  maxLimit?: number
}

export function safeRateChangeLimit(limit: number | undefined, fallback: number, max = 1000): number {
  if (!Number.isFinite(limit)) return fallback
  return Math.min(max, Math.max(1, Math.floor(limit as number)))
}

export function safeRateChangeOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset)) return 0
  return Math.max(0, Math.floor(offset as number))
}

function columnReference(column: string, alias?: string): string {
  return alias ? `${alias}.${column}` : column
}

export function buildMissingKeyClause(config: RateChangeDatasetConfig, alias?: string): string {
  return config.keyDimensions
    .map((column) => `COALESCE(TRIM(CAST(${columnReference(column, alias)} AS TEXT)), '') = ''`)
    .join(' OR ')
}

export function buildPresentKeyClause(config: RateChangeDatasetConfig, alias?: string): string {
  return config.keyDimensions
    .map((column) => `COALESCE(TRIM(CAST(${columnReference(column, alias)} AS TEXT)), '') != ''`)
    .join(' AND ')
}

type CteBuildResult = {
  cte: string
  bindings: Array<string | number>
}

function buildNormalizedSelectColumns(config: RateChangeDatasetConfig): string[] {
  const baseColumns = new Set(['bank_name', 'product_id', 'product_name'])
  return Array.from(new Set([...config.keyDimensions, ...config.detailColumns])).filter((column) => !baseColumns.has(column))
}

function buildPrefixedSelect(columns: string[], alias: string): string {
  return columns.map((column) => `${alias}.${column}`).join(',\n        ')
}

export function buildRateChangeCte(config: RateChangeDatasetConfig): CteBuildResult {
  const selectColumns = buildNormalizedSelectColumns(config)
  const normalizedSelect = buildPrefixedSelect(selectColumns, 'h')
  const orderedDetailSelect = buildPrefixedSelect(config.detailColumns, 'o')
  const changedDetailSelect = buildPrefixedSelect(config.detailColumns, 'c')
  const cte = `
    WITH normalized AS (
      SELECT
        h.collection_date,
        h.parsed_at,
        h.run_id,
        h.bank_name,
        h.product_id,
        h.product_name,
        ${normalizedSelect},
        h.interest_rate,
        h.confidence_score,
        h.run_source,
        ${config.productKeyExpression} AS product_key,
        ${config.seriesKeyExpression} AS series_key
      FROM ${config.table} h
    ),
    included AS (
      SELECT *
      FROM normalized
      WHERE interest_rate BETWEEN ? AND ?
        AND confidence_score >= ?
        AND ${buildPresentKeyClause(config)}
    ),
    ordered AS (
      SELECT
        i.*,
        LAG(i.interest_rate) OVER (
          PARTITION BY i.series_key
          ORDER BY i.collection_date ASC, i.parsed_at ASC
        ) AS prior_snapshot_rate
      FROM included i
    ),
    change_events AS (
      SELECT
        o.parsed_at AS changed_at,
        o.collection_date,
        o.bank_name,
        o.product_name,
        o.series_key,
        o.product_key,
        ${orderedDetailSelect},
        o.prior_snapshot_rate AS previous_rate,
        o.interest_rate AS new_rate,
        o.run_source
      FROM ordered o
      WHERE o.prior_snapshot_rate IS NOT NULL
        AND o.interest_rate != o.prior_snapshot_rate
    ),
    changed AS (
      SELECT
        c.changed_at,
        LAG(c.changed_at) OVER (
          PARTITION BY c.series_key
          ORDER BY c.collection_date ASC, c.changed_at ASC
        ) AS previous_changed_at,
        c.collection_date,
        LAG(c.collection_date) OVER (
          PARTITION BY c.series_key
          ORDER BY c.collection_date ASC, c.changed_at ASC
        ) AS previous_collection_date,
        c.bank_name,
        c.product_name,
        c.series_key,
        c.product_key,
        ${changedDetailSelect},
        c.previous_rate,
        c.new_rate,
        ROUND((c.new_rate - c.previous_rate) * 100, 3) AS delta_bps,
        c.run_source
      FROM change_events c
    )
  `
  const bindings: Array<string | number> = [config.minRate, config.maxRate, config.minConfidence]
  return { cte, bindings }
}

export function buildRateChangeCountSql(
  config: RateChangeDatasetConfig,
  windowStartDate?: string,
): { sql: string; bindings: Array<string | number> } {
  const includeWindow = typeof windowStartDate === 'string' && windowStartDate.length > 0
  const { cte, bindings } = buildRateChangeCte(config)
  return {
    sql: `${cte} SELECT COUNT(*) AS total FROM changed${includeWindow ? ' WHERE collection_date >= ?' : ''}`,
    bindings: includeWindow && windowStartDate ? [...bindings, windowStartDate] : bindings,
  }
}

export function buildRateChangeDataSql(
  config: RateChangeDatasetConfig,
  input: RateChangeQueryInput,
): { sql: string; bindings: Array<string | number>; limit: number; offset: number } {
  const maxLimit = Number.isFinite(input.maxLimit) ? Math.max(1, Math.floor(Number(input.maxLimit))) : 1000
  const limit = safeRateChangeLimit(input.limit, 200, maxLimit)
  const offset = safeRateChangeOffset(input.offset)
  const includeWindow = typeof input.windowStartDate === 'string' && input.windowStartDate.length > 0
  const { cte, bindings } = buildRateChangeCte(config)
  return {
    sql: `${cte}
      SELECT *
      FROM changed
      ${includeWindow ? 'WHERE collection_date >= ?' : ''}
      ORDER BY changed_at DESC
      LIMIT ? OFFSET ?
    `,
    bindings: [
      ...bindings,
      ...(includeWindow && input.windowStartDate ? [input.windowStartDate] : []),
      limit,
      offset,
    ],
    limit,
    offset,
  }
}

export function buildRateChangeIncludedCte(
  config: RateChangeDatasetConfig,
): { cte: string; bindings: Array<string | number> } {
  const selectColumns = buildNormalizedSelectColumns(config)
  const normalizedSelect = selectColumns.map((column) => `h.${column}`).join(',\n        ')
  const cte = `
    WITH normalized AS (
      SELECT
        h.collection_date,
        h.parsed_at,
        h.run_id,
        h.bank_name,
        h.product_id,
        h.product_name,
        ${normalizedSelect},
        h.interest_rate,
        h.confidence_score,
        h.run_source,
        ${config.productKeyExpression} AS product_key,
        ${config.seriesKeyExpression} AS series_key
      FROM ${config.table} h
    ),
    included AS (
      SELECT *
      FROM normalized
      WHERE interest_rate BETWEEN ? AND ?
        AND confidence_score >= ?
        AND ${buildPresentKeyClause(config)}
    )
  `
  return {
    cte,
    bindings: [config.minRate, config.maxRate, config.minConfidence],
  }
}
