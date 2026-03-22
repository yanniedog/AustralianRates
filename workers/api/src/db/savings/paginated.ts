import { presentCoreRowFields, presentSavingsRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import { rows } from '../query-common'
import { PUBLIC_EXPORT_FETCH_CHUNK_SIZE } from '../../constants'
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
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_hash, h.data_quality_flag, h.confidence_score,
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
  const hydratedData = await hydrateCdrDetailJson(db, rows(dataResult))
  const data = hydratedData.map((row) => presentSavingsRow(row))

  return {
    last_page: Math.max(1, Math.ceil(total / size)),
    total,
    data,
    source_mix: { scheduled, manual },
  }
}

const SAVINGS_JOIN = `
    FROM historical_savings_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'savings'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id`

/** Min and max collection_date for the given filters (date filters omitted). */
export async function querySavingsCollectionDateRange(
  db: D1Database,
  filters: Omit<SavingsPaginatedFilters, 'startDate' | 'endDate'> & { startDate?: string; endDate?: string },
): Promise<{ startDate: string; endDate: string } | null> {
  const rangeFilters = { ...filters, startDate: undefined, endDate: undefined }
  const { clause: whereClause, binds } = buildWhere(rangeFilters)
  const row = await db
    .prepare(
      `SELECT MIN(h.collection_date) AS min_date, MAX(h.collection_date) AS max_date ${SAVINGS_JOIN} ${whereClause}`,
    )
    .bind(...binds)
    .first<{ min_date: string | null; max_date: string | null }>()
  if (!row?.min_date || !row?.max_date) return null
  return { startDate: row.min_date, endDate: row.max_date }
}

export async function querySavingsForExport(db: D1Database, filters: SavingsPaginatedFilters) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const chunkSize = Math.max(1, Math.floor(PUBLIC_EXPORT_FETCH_CHUNK_SIZE))

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
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_hash, h.data_quality_flag, h.confidence_score,
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
    LIMIT ? OFFSET ?
  `

  const [countResult, sourceResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first<{ total: number }>(),
    db.prepare(sourceSql).bind(...binds).all<{ run_source: string; n: number }>(),
  ])

  let scheduled = 0
  let manual = 0
  for (const row of rows(sourceResult)) {
    if (String(row.run_source).toLowerCase() === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }

  const total = Number(countResult?.total ?? 0)
  const cap =
    filters.limit != null && Number.isFinite(Number(filters.limit))
      ? Math.min(total, Math.max(0, Math.floor(Number(filters.limit))))
      : total
  const rawRows: Record<string, unknown>[] = []
  let offset = 0
  while (offset < cap) {
    const take = Math.min(chunkSize, cap - offset)
    if (take <= 0) break
    const dataResult = await db.prepare(dataSql).bind(...binds, take, offset).all<Record<string, unknown>>()
    const chunk = rows(dataResult)
    if (chunk.length === 0) break
    rawRows.push(...chunk)
    offset += chunk.length
    if (chunk.length < take) break
  }

  const hydratedData = await hydrateCdrDetailJson(db, rawRows)
  return {
    data: hydratedData.map((row) => presentCoreRowFields(row)),
    total,
    source_mix: { scheduled, manual },
  }
}
