import { PUBLIC_EXPORT_FETCH_CHUNK_SIZE } from '../../constants'
import { presentCoreRowFields, presentTdRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import { withD1TransientRetry } from '../d1-retry'
import { rows } from '../query-common'
import { tdProductKeySql, tdSeriesKeySql } from './identity'
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
      h.bank_name, h.collection_date, h.product_id, h.product_name, h.series_key,
      h.term_months, h.interest_rate, h.deposit_tier,
      h.min_deposit, h.max_deposit, h.interest_payment,
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_hash, h.data_quality_flag, h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY ${tdSeriesKeySql('h')}
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
      ${tdProductKeySql('h')} AS product_key,
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
    withD1TransientRetry(() => db.prepare(countSql).bind(...binds).first<{ total: number }>()),
    withD1TransientRetry(() => db.prepare(dataSql).bind(...binds, size, offset).all<Record<string, unknown>>()),
  ])

  const total = Number(countResult?.total ?? 0)
  let scheduled = 0
  let manual = 0
  for (const row of rows(dataResult)) {
    if (String((row as Record<string, unknown>).run_source ?? 'scheduled').toLowerCase() === 'manual') manual += 1
    else scheduled += 1
  }
  const hydratedData = await hydrateCdrDetailJson(db, rows(dataResult))
  const data = hydratedData.map((row) => presentTdRow(row))

  return {
    last_page: Math.max(1, Math.ceil(total / size)),
    total,
    data,
    source_mix: { scheduled, manual },
  }
}

const TD_JOIN = `
    FROM historical_term_deposit_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id`

/** Min and max collection_date for the given filters (date filters omitted). */
export async function queryTdCollectionDateRange(
  db: D1Database,
  filters: Omit<TdPaginatedFilters, 'startDate' | 'endDate'> & { startDate?: string; endDate?: string },
): Promise<{ startDate: string; endDate: string } | null> {
  const rangeFilters = { ...filters, startDate: undefined, endDate: undefined }
  const { clause: whereClause, binds } = buildWhere(rangeFilters)
  const row = await withD1TransientRetry(() =>
    db
      .prepare(
        `SELECT MIN(h.collection_date) AS min_date, MAX(h.collection_date) AS max_date ${TD_JOIN} ${whereClause}`,
      )
      .bind(...binds)
      .first<{ min_date: string | null; max_date: string | null }>(),
  )
  if (!row?.min_date || !row?.max_date) return null
  return { startDate: row.min_date, endDate: row.max_date }
}

export async function queryTdForExport(db: D1Database, filters: TdPaginatedFilters) {
  const { clause: whereClause, binds } = buildWhere(filters)
  const sortCol = SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const chunkSize = Math.max(1, Math.floor(PUBLIC_EXPORT_FETCH_CHUNK_SIZE))

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
      h.bank_name, h.collection_date, h.product_id, h.product_name, h.series_key,
      h.term_months, h.interest_rate, h.deposit_tier,
      h.min_deposit, h.max_deposit, h.interest_payment,
      h.source_url, h.product_url, h.published_at, h.cdr_product_detail_hash, h.data_quality_flag, h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY ${tdSeriesKeySql('h')}
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
      ${tdProductKeySql('h')} AS product_key,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
FROM historical_term_deposit_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'term_deposits'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC
    LIMIT ? OFFSET ?
  `

  const countResult = await withD1TransientRetry(() => db.prepare(countSql).bind(...binds).first<{ total: number }>())
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
    const dataResult = await withD1TransientRetry(() =>
      db.prepare(dataSql).bind(...binds, take, offset).all<Record<string, unknown>>(),
    )
    const chunk = rows(dataResult)
    if (chunk.length === 0) break
    rawRows.push(...chunk)
    offset += chunk.length
    if (chunk.length < take) break
  }

  let scheduled = 0
  let manual = 0
  for (const row of rawRows) {
    if (String((row as Record<string, unknown>).run_source ?? 'scheduled').toLowerCase() === 'manual') manual += 1
    else scheduled += 1
  }
  const hydratedData = await hydrateCdrDetailJson(db, rawRows)
  return {
    data: hydratedData.map((row) => presentCoreRowFields(row)),
    total,
    source_mix: { scheduled, manual },
  }
}
