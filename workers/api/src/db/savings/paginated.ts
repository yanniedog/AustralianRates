import { presentCoreRowFields, presentSavingsRow } from '../../utils/row-presentation'
import { rows } from '../query-common'
import { buildWhere, type SavingsPaginatedFilters, SORT_COLUMNS } from './shared'

export async function querySavingsRatesPaginated(db: D1Database, filters: SavingsPaginatedFilters) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`

  const page = Math.max(1, Math.floor(Number(filters.page) || 1))
  const size = Math.min(1000, Math.max(1, Math.floor(Number(filters.size) || 50)))
  const offset = (page - 1) * size

  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const sourceSql = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.account_type, h.rate_type, h.interest_rate, h.deposit_tier,
      h.min_balance, h.max_balance, h.conditions, h.monthly_fee,
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_json, h.data_quality_flag, h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.account_type, h.rate_type, h.deposit_tier
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.account_type,
          h.rate_type,
          h.deposit_tier,
          h.interest_rate,
          h.monthly_fee,
          h.min_balance,
          h.max_balance,
          h.conditions
      ) AS rate_confirmed_at,
      h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause} ${orderClause}
    LIMIT ? OFFSET ?
  `

  const [countResult, sourceResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(sourceSql).bind(...binds).all<{ run_source: string; n: number }>(),
    db.prepare(dataSql).bind(...binds, size, offset).all<Record<string, unknown>>(),
  ])

  const total = Number(countResult?.total ?? 0)
  let scheduled = 0
  let manual = 0
  for (const row of rows(sourceResult)) {
    if (String(row.run_source).toLowerCase() === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }
  const data = rows(dataResult).map((row) => presentSavingsRow(row))

  return {
    last_page: Math.max(1, Math.ceil(total / size)),
    total,
    data,
    source_mix: { scheduled, manual },
  }
}

export async function querySavingsForExport(db: D1Database, filters: SavingsPaginatedFilters, maxRows = 10000) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.min(maxRows, Math.max(1, Math.floor(Number(maxRows))))

  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const sourceSql = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.account_type, h.rate_type, h.interest_rate, h.deposit_tier,
      h.min_balance, h.max_balance, h.conditions, h.monthly_fee,
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_json, h.data_quality_flag, h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.account_type, h.rate_type, h.deposit_tier
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.account_type,
          h.rate_type,
          h.deposit_tier,
          h.interest_rate,
          h.monthly_fee,
          h.min_balance,
          h.max_balance,
          h.conditions
      ) AS rate_confirmed_at,
      h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC
    LIMIT ?
  `

  const [countResult, sourceResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(sourceSql).bind(...binds).all<{ run_source: string; n: number }>(),
    db.prepare(dataSql).bind(...binds, limit).all<Record<string, unknown>>(),
  ])

  let scheduled = 0
  let manual = 0
  for (const row of rows(sourceResult)) {
    if (String(row.run_source).toLowerCase() === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }
  return {
    data: rows(dataResult).map((row) => presentCoreRowFields(row)),
    total: Number(countResult?.total ?? 0),
    source_mix: { scheduled, manual },
  }
}
