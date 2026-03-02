import { presentCoreRowFields, presentTdRow } from '../../utils/row-presentation'
import { rows } from '../query-common'
import { buildWhere, SORT_COLUMNS, type TdPaginatedFilters } from './shared'

export async function queryTdRatesPaginated(db: D1Database, filters: TdPaginatedFilters) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`

  const page = Math.max(1, Math.floor(Number(filters.page) || 1))
  const size = Math.min(1000, Math.max(1, Math.floor(Number(filters.size) || 50)))
  const offset = (page - 1) * size

  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_term_deposit_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.term_months, h.interest_rate, h.deposit_tier,
      h.min_deposit, h.max_deposit, h.interest_payment,
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_json, h.data_quality_flag, h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.term_months, h.deposit_tier
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.term_months,
          h.deposit_tier,
          h.interest_payment,
          h.interest_rate,
          h.min_deposit,
          h.max_deposit
      ) AS rate_confirmed_at,
      h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier AS product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_term_deposit_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause} ${orderClause}
    LIMIT ? OFFSET ?
  `

  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(dataSql).bind(...binds, size, offset).all<Record<string, unknown>>(),
  ])

  const total = Number(countResult?.total ?? 0)
  let scheduled = 0
  let manual = 0
  for (const row of rows(dataResult)) {
    if (String((row as Record<string, unknown>).run_source ?? 'scheduled').toLowerCase() === 'manual') manual += 1
    else scheduled += 1
  }
  const data = rows(dataResult).map((row) => presentTdRow(row))

  return {
    last_page: Math.max(1, Math.ceil(total / size)),
    total,
    data,
    source_mix: { scheduled, manual },
  }
}

export async function queryTdForExport(db: D1Database, filters: TdPaginatedFilters, maxRows = 10000) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.min(maxRows, Math.max(1, Math.floor(Number(maxRows))))

  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_term_deposit_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.term_months, h.interest_rate, h.deposit_tier,
      h.min_deposit, h.max_deposit, h.interest_payment,
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_json, h.data_quality_flag, h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.term_months, h.deposit_tier
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.term_months,
          h.deposit_tier,
          h.interest_payment,
          h.interest_rate,
          h.min_deposit,
          h.max_deposit
      ) AS rate_confirmed_at,
      h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier AS product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
FROM historical_term_deposit_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC
    LIMIT ?
  `

  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(dataSql).bind(...binds, limit).all<Record<string, unknown>>(),
  ])

  let scheduled = 0
  let manual = 0
  for (const row of rows(dataResult)) {
    if (String((row as Record<string, unknown>).run_source ?? 'scheduled').toLowerCase() === 'manual') manual += 1
    else scheduled += 1
  }
  return {
    data: rows(dataResult).map((row) => presentCoreRowFields(row)),
    total: Number(countResult?.total ?? 0),
    source_mix: { scheduled, manual },
  }
}
