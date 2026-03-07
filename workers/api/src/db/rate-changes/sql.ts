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

export function buildRateChangeCte(config: RateChangeDatasetConfig, windowStartDate?: string): CteBuildResult {
  const selectColumns = buildNormalizedSelectColumns(config)
  const normalizedSelect = selectColumns.map((column) => `h.${column}`).join(',\n        ')
  const detailSelect = config.detailSelect.join(',\n        ')
  const includeWindow = typeof windowStartDate === 'string' && windowStartDate.length > 0
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
        ${includeWindow ? 'AND collection_date >= ?' : ''}
    ),
    ordered AS (
      SELECT
        i.*,
        LAG(i.interest_rate) OVER (
          PARTITION BY i.series_key
          ORDER BY i.collection_date ASC, i.parsed_at ASC
        ) AS previous_rate,
        LAG(i.parsed_at) OVER (
          PARTITION BY i.series_key
          ORDER BY i.collection_date ASC, i.parsed_at ASC
        ) AS previous_changed_at,
        LAG(i.collection_date) OVER (
          PARTITION BY i.series_key
          ORDER BY i.collection_date ASC, i.parsed_at ASC
        ) AS previous_collection_date
      FROM included i
    ),
    changed AS (
      SELECT
        o.parsed_at AS changed_at,
        o.previous_changed_at,
        o.collection_date,
        o.previous_collection_date,
        o.bank_name,
        o.product_name,
        o.series_key,
        o.product_key,
        ${detailSelect},
        o.previous_rate,
        o.interest_rate AS new_rate,
        ROUND((o.interest_rate - o.previous_rate) * 100, 3) AS delta_bps,
        o.run_source
      FROM ordered o
      WHERE o.previous_rate IS NOT NULL
        AND o.interest_rate != o.previous_rate
    )
  `
  const bindings: Array<string | number> = [config.minRate, config.maxRate, config.minConfidence]
  if (includeWindow && windowStartDate) bindings.push(windowStartDate)
  return { cte, bindings }
}

export function buildRateChangeCountSql(
  config: RateChangeDatasetConfig,
  windowStartDate?: string,
): { sql: string; bindings: Array<string | number> } {
  const { cte, bindings } = buildRateChangeCte(config, windowStartDate)
  return {
    sql: `${cte} SELECT COUNT(*) AS total FROM changed`,
    bindings,
  }
}

export function buildRateChangeDataSql(
  config: RateChangeDatasetConfig,
  input: RateChangeQueryInput,
): { sql: string; bindings: Array<string | number>; limit: number; offset: number } {
  const maxLimit = Number.isFinite(input.maxLimit) ? Math.max(1, Math.floor(Number(input.maxLimit))) : 1000
  const limit = safeRateChangeLimit(input.limit, 200, maxLimit)
  const offset = safeRateChangeOffset(input.offset)
  const { cte, bindings } = buildRateChangeCte(config, input.windowStartDate)
  return {
    sql: `${cte}
      SELECT *
      FROM changed
      ORDER BY changed_at DESC
      LIMIT ? OFFSET ?
    `,
    bindings: [...bindings, limit, offset],
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
