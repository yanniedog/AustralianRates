import { applyHomeLoanCompareEdgeExclusions } from '../compare-edge-exclusions'
import { runSourceWhereClause } from '../../utils/source-mode'
import { presentCoreRowFields, presentHomeLoanRow } from '../../utils/row-presentation'
import { hydrateCdrDetailJson } from '../cdr-detail-payloads'
import { addBankWhere, addRateBoundsWhere, rows } from '../query-common'
import { PUBLIC_EXPORT_FETCH_CHUNK_SIZE } from '../../constants'
import {
  MAX_PUBLIC_RATE,
  MIN_CONFIDENCE_ALL,
  MIN_CONFIDENCE_DAILY,
  MIN_CONFIDENCE_HISTORICAL,
  MIN_PUBLIC_RATE,
  PAGINATED_SORT_COLUMNS,
  type RatesExportFilters,
  type RatesPaginatedFilters,
} from './shared'

export type { RatesExportFilters, RatesPaginatedFilters } from './shared'

export async function queryRatesPaginated(db: D1Database, filters: RatesPaginatedFilters) {
  const where: string[] = []; const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', 'h.comparison_rate', filters)

  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("h.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("h.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  if (filters.securityPurpose) {
    where.push('h.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('h.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('h.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('h.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('h.feature_set = ?')
    binds.push(filters.featureSet)
  }
  if (filters.startDate) {
    where.push('h.collection_date >= ?')
    binds.push(filters.startDate)
  }
  if (filters.endDate) {
    where.push('h.collection_date <= ?')
    binds.push(filters.endDate)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(pps.is_removed, 0) = 0')
  }

  applyHomeLoanCompareEdgeExclusions(where, 'h.product_name', filters.excludeCompareEdgeCases)

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const whereWithoutPps = where.filter((w) => !w.includes('pps.'))
  const whereClauseNoPps =
    whereWithoutPps.length ? `WHERE ${whereWithoutPps.join(' AND ')}` : ''

  const sortCol = PAGINATED_SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`

  const page = Math.max(1, Math.floor(Number(filters.page) || 1))
  const size = Math.min(1000, Math.max(1, Math.floor(Number(filters.size) || 50)))
  const offset = (page - 1) * size

  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const sourceSql = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const dataSql = `
    SELECT
      h.bank_name,
      h.collection_date,
      h.product_id,
      h.product_name,
      h.security_purpose,
      h.repayment_type,
      h.rate_structure,
      h.lvr_tier,
      h.feature_set,
      h.has_offset_account,
      h.interest_rate,
      h.comparison_rate,
      h.annual_fee,
      h.source_url,
      h.product_url,
      h.published_at,
      h.cdr_product_detail_hash,
      h.data_quality_flag,
      h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.security_purpose,
          h.repayment_type,
          h.lvr_tier,
          h.rate_structure,
          h.interest_rate,
          h.comparison_rate,
          h.annual_fee
      ) AS rate_confirmed_at,
      h.run_id,
      h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= h.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `

  const countSqlNoPps = `
    SELECT COUNT(*) AS total FROM historical_loan_rates h ${whereClauseNoPps}
  `
  const sourceSqlNoPps = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_loan_rates h ${whereClauseNoPps}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const dataSqlNoPps = `
    SELECT
      h.bank_name,
      h.collection_date,
      h.product_id,
      h.product_name,
      h.security_purpose,
      h.repayment_type,
      h.rate_structure,
      h.lvr_tier,
      h.feature_set,
      h.has_offset_account,
      h.interest_rate,
      h.comparison_rate,
      h.annual_fee,
      h.source_url,
      h.product_url,
      h.published_at,
      h.cdr_product_detail_hash,
      h.data_quality_flag,
      h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.security_purpose,
          h.repayment_type,
          h.lvr_tier,
          h.rate_structure,
          h.interest_rate,
          h.comparison_rate,
          h.annual_fee
      ) AS rate_confirmed_at,
      h.run_id,
      h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= h.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      0 AS is_removed,
      NULL AS removed_at
    FROM historical_loan_rates h
    ${whereClauseNoPps}
    ${orderClause}
    LIMIT ? OFFSET ?
  `

  const dataBinds = [...binds, size, offset]

  async function runWithPps(): Promise<{
    countResult: { total: number } | null
    sourceResult: D1Result<{ run_source: string; n: number }>
    dataResult: D1Result<Record<string, unknown>>
  }> {
    const [countResult, sourceResult, dataResult] = await Promise.all([
      db.prepare(countSql).bind(...binds).first<{ total: number }>(),
      db.prepare(sourceSql).bind(...binds).all<{ run_source: string; n: number }>(),
      db.prepare(dataSql).bind(...dataBinds).all<Record<string, unknown>>(),
    ])
    return { countResult: countResult ?? null, sourceResult, dataResult }
  }

  async function runWithoutPps(): Promise<{
    countResult: { total: number } | null
    sourceResult: D1Result<{ run_source: string; n: number }>
    dataResult: D1Result<Record<string, unknown>>
  }> {
    const [countResult, sourceResult, dataResult] = await Promise.all([
      db.prepare(countSqlNoPps).bind(...binds).first<{ total: number }>(),
      db.prepare(sourceSqlNoPps).bind(...binds).all<{ run_source: string; n: number }>(),
      db.prepare(dataSqlNoPps).bind(...dataBinds).all<Record<string, unknown>>(),
    ])
    return { countResult: countResult ?? null, sourceResult, dataResult }
  }

  let countResult: { total: number } | null; let sourceResult: D1Result<{ run_source: string; n: number }>; let dataResult: D1Result<Record<string, unknown>>

  try {
    const out = await runWithPps()
    countResult = out.countResult
    sourceResult = out.sourceResult
    dataResult = out.dataResult
  } catch {
    const out = await runWithoutPps()
    countResult = out.countResult
    sourceResult = out.sourceResult
    dataResult = out.dataResult
  }

  const total = Number(countResult?.total ?? 0)
  const lastPage = Math.max(1, Math.ceil(total / size))
  let scheduled = 0
  let manual = 0
  for (const row of rows(sourceResult)) {
    if (String(row.run_source).toLowerCase() === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }

  const hydratedData = await hydrateCdrDetailJson(db, rows(dataResult))
  const data = hydratedData.map((row) => presentHomeLoanRow(row))

  return {
    last_page: lastPage,
    total,
    data,
    source_mix: { scheduled, manual },
  }
}

export async function queryRatesForExport(
  db: D1Database,
  filters: RatesExportFilters,
): Promise<{ data: Array<Record<string, unknown>>; total: number; source_mix: { scheduled: number; manual: number } }> {
  const where: string[] = []; const binds: Array<string | number> = []

  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', 'h.comparison_rate', filters)

  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("h.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("h.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }

  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  if (filters.securityPurpose) {
    where.push('h.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('h.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('h.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('h.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('h.feature_set = ?')
    binds.push(filters.featureSet)
  }
  if (filters.startDate) {
    where.push('h.collection_date >= ?')
    binds.push(filters.startDate)
  }
  if (filters.endDate) {
    where.push('h.collection_date <= ?')
    binds.push(filters.endDate)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(pps.is_removed, 0) = 0')
  }

  applyHomeLoanCompareEdgeExclusions(where, 'h.product_name', filters.excludeCompareEdgeCases)

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const whereNoPps = where.filter((w) => !w.includes('pps.'))
  const whereClauseNoPps = whereNoPps.length ? `WHERE ${whereNoPps.join(' AND ')}` : ''
  const sortCol = PAGINATED_SORT_COLUMNS[filters.sort ?? ''] ?? 'h.collection_date'
  const sortDir = filters.dir === 'desc' ? 'DESC' : 'ASC'
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`
  const chunkSize = Math.max(1, Math.floor(PUBLIC_EXPORT_FETCH_CHUNK_SIZE))

  const countSql = `
    SELECT COUNT(*) AS total
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
  `
  const countSqlNoPps = `SELECT COUNT(*) AS total FROM historical_loan_rates h ${whereClauseNoPps}`
  const sourceSql = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const sourceSqlNoPps = `
    SELECT COALESCE(h.run_source, 'scheduled') AS run_source, COUNT(*) AS n
    FROM historical_loan_rates h ${whereClauseNoPps}
    GROUP BY COALESCE(h.run_source, 'scheduled')
  `
  const dataSql = `
    SELECT
      h.bank_name,
      h.collection_date,
      h.product_id,
      h.product_name,
      h.security_purpose,
      h.repayment_type,
      h.rate_structure,
      h.lvr_tier,
      h.feature_set,
      h.has_offset_account,
      h.interest_rate,
      h.comparison_rate,
      h.annual_fee,
      h.source_url,
      h.product_url,
      h.published_at,
      h.cdr_product_detail_hash,
      h.data_quality_flag,
      h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.security_purpose,
          h.repayment_type,
          h.lvr_tier,
          h.rate_structure,
          h.interest_rate,
          h.comparison_rate,
          h.annual_fee
      ) AS rate_confirmed_at,
      h.run_id,
      h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= h.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      COALESCE(pps.is_removed, 0) AS is_removed,
      pps.removed_at
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `
  const dataSqlNoPps = `
    SELECT
      h.bank_name,
      h.collection_date,
      h.product_id,
      h.product_name,
      h.security_purpose,
      h.repayment_type,
      h.rate_structure,
      h.lvr_tier,
      h.feature_set,
      h.has_offset_account,
      h.interest_rate,
      h.comparison_rate,
      h.annual_fee,
      h.source_url,
      h.product_url,
      h.published_at,
      h.cdr_product_detail_hash,
      h.data_quality_flag,
      h.confidence_score,
      h.retrieval_type,
      h.parsed_at,
      MIN(h.parsed_at) OVER (
        PARTITION BY h.bank_name, h.product_id, h.security_purpose, h.repayment_type, h.lvr_tier, h.rate_structure
      ) AS first_retrieved_at,
      MAX(CASE WHEN h.data_quality_flag LIKE 'cdr_live%' THEN h.parsed_at END) OVER (
        PARTITION BY
          h.bank_name,
          h.product_id,
          h.security_purpose,
          h.repayment_type,
          h.lvr_tier,
          h.rate_structure,
          h.interest_rate,
          h.comparison_rate,
          h.annual_fee
      ) AS rate_confirmed_at,
      h.run_id,
      h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
      (
        SELECT r.cash_rate
        FROM rba_cash_rates r
        WHERE r.collection_date <= h.collection_date
        ORDER BY r.collection_date DESC
        LIMIT 1
      ) AS rba_cash_rate,
      0 AS is_removed,
      NULL AS removed_at
    FROM historical_loan_rates h
    ${whereClauseNoPps}
    ${orderClause}
    LIMIT ? OFFSET ?
  `

  let countResult: { total: number } | null
  let sourceResult: D1Result<{ run_source: string; n: number }>
  try {
    const [c, s] = await Promise.all([
      db.prepare(countSql).bind(...binds).first<{ total: number }>(),
      db.prepare(sourceSql).bind(...binds).all<{ run_source: string; n: number }>(),
    ])
    countResult = c ?? null
    sourceResult = s
  } catch {
    const [c, s] = await Promise.all([
      db.prepare(countSqlNoPps).bind(...binds).first<{ total: number }>(),
      db.prepare(sourceSqlNoPps).bind(...binds).all<{ run_source: string; n: number }>(),
    ])
    countResult = c ?? null
    sourceResult = s
  }

  const total = Number(countResult?.total ?? 0)
  let scheduled = 0
  let manual = 0
  for (const row of rows(sourceResult)) {
    if (String(row.run_source).toLowerCase() === 'manual') manual += Number(row.n)
    else scheduled += Number(row.n)
  }

  const cap =
    filters.limit != null && Number.isFinite(Number(filters.limit))
      ? Math.min(total, Math.max(0, Math.floor(Number(filters.limit))))
      : total
  const rawRows: Record<string, unknown>[] = []
  let dataQuery = dataSql
  let offset = 0
  while (offset < cap) {
    const take = Math.min(chunkSize, cap - offset)
    if (take <= 0) break
    let dataResult: D1Result<Record<string, unknown>>
    try {
      dataResult = await db.prepare(dataQuery).bind(...binds, take, offset).all<Record<string, unknown>>()
    } catch {
      dataQuery = dataSqlNoPps
      dataResult = await db.prepare(dataQuery).bind(...binds, take, offset).all<Record<string, unknown>>()
    }
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

const HL_JOIN = `
    FROM historical_loan_rates h
    LEFT JOIN product_presence_status pps
      ON pps.section = 'home_loans'
      AND pps.bank_name = h.bank_name
      AND pps.product_id = h.product_id`

function buildHomeLoanWhereNoDates(filters: RatesPaginatedFilters): { whereClause: string; binds: Array<string | number> } {
  const where: string[] = []
  const binds: Array<string | number> = []
  where.push('h.interest_rate BETWEEN ? AND ?')
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE)
  addRateBoundsWhere(where, binds, 'h.interest_rate', 'h.comparison_rate', filters)
  where.push(runSourceWhereClause('h.run_source', filters.sourceMode ?? 'all'))
  if (filters.mode === 'daily') {
    where.push("h.data_quality_flag NOT LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_DAILY)
  } else if (filters.mode === 'historical') {
    where.push("h.data_quality_flag LIKE 'parsed_from_wayback%'")
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_HISTORICAL)
  } else {
    where.push('h.confidence_score >= ?')
    binds.push(MIN_CONFIDENCE_ALL)
  }
  addBankWhere(where, binds, 'h.bank_name', filters.bank, filters.banks)
  if (filters.securityPurpose) {
    where.push('h.security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('h.repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('h.rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('h.lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('h.feature_set = ?')
    binds.push(filters.featureSet)
  }
  if (!filters.includeRemoved) {
    where.push('COALESCE(pps.is_removed, 0) = 0')
  }
  applyHomeLoanCompareEdgeExclusions(where, 'h.product_name', filters.excludeCompareEdgeCases)
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return { whereClause, binds }
}

/** Min and max collection_date in historical_loan_rates for the given filters (date filters omitted). */
export async function queryHomeLoanCollectionDateRange(
  db: D1Database,
  filters: Omit<RatesPaginatedFilters, 'startDate' | 'endDate'> & { startDate?: string; endDate?: string },
): Promise<{ startDate: string; endDate: string } | null> {
  const { whereClause, binds } = buildHomeLoanWhereNoDates(filters as RatesPaginatedFilters)
  const row = await db
    .prepare(
      `SELECT MIN(h.collection_date) AS min_date, MAX(h.collection_date) AS max_date ${HL_JOIN} ${whereClause}`,
    )
    .bind(...binds)
    .first<{ min_date: string | null; max_date: string | null }>()
  if (!row?.min_date || !row?.max_date) return null
  return { startDate: row.min_date, endDate: row.max_date }
}
