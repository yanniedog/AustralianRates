import { legacyProductKey } from '../../utils/series-identity'
import { ChartDataRequestError, OffsetFieldUnavailableError } from './errors'
import {
  assertChartDate,
  assertChartRate,
  formatRateChangeLabel,
  queryRbaChartEvents,
  sortChartEvents,
  type ChartEvent,
} from './common'

type HomeLoanChartInput = {
  lenders: string[]
  lvr: number
  repaymentType: 'P&I' | 'IO'
  occupancy: 'Owner' | 'Investor'
  offset: boolean
  startDate?: string
  endDate?: string
}

type HomeLoanChartRow = {
  id: string
  lender: string
  product_name: string
  product_id: string
  collection_date: string
  interest_rate: number
  security_purpose: string
  repayment_type: string
  rate_structure: string
  lvr_tier: string
  has_offset_account: number | null
}

type HomeLoanEventRow = {
  collection_date: string
  bank_name: string
  product_name: string
  change_json: string
  interest_rate: number
}

export type HomeLoanChartResponse = {
  series: {
    id: string
    lender: string
    productName: string
    lvr: number
    repaymentType: 'P&I' | 'IO'
    occupancy: 'Owner' | 'Investor'
    offset: boolean
    data: Array<{ date: string; rate: number }>
  }[]
  events: ChartEvent[]
}

function lvrTierFor(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 95) {
    throw new ChartDataRequestError(400, 'INVALID_LVR', 'lvr must be between 0 and 95.')
  }
  if (value <= 60) return 'lvr_=60%'
  if (value <= 70) return 'lvr_60-70%'
  if (value <= 80) return 'lvr_70-80%'
  if (value <= 85) return 'lvr_80-85%'
  if (value <= 90) return 'lvr_85-90%'
  return 'lvr_90-95%'
}

function occupancyToDb(value: HomeLoanChartInput['occupancy']): string {
  return value === 'Investor' ? 'investment' : 'owner_occupied'
}

function repaymentToDb(value: HomeLoanChartInput['repaymentType']): string {
  return value === 'IO' ? 'interest_only' : 'principal_and_interest'
}

function buildSeriesId(row: Pick<HomeLoanChartRow, 'lender' | 'product_id' | 'security_purpose' | 'repayment_type' | 'lvr_tier' | 'rate_structure'>): string {
  return legacyProductKey('home_loans', {
    bankName: row.lender,
    productId: row.product_id,
    securityPurpose: row.security_purpose,
    repaymentType: row.repayment_type,
    lvrTier: row.lvr_tier,
    rateStructure: row.rate_structure,
  })
}

async function assertOffsetReadiness(
  db: D1Database,
  input: HomeLoanChartInput,
  lvrTier: string,
  securityPurpose: string,
  repaymentType: string,
): Promise<void> {
  const where: string[] = ['lvr_tier = ?1', 'security_purpose = ?2', 'repayment_type = ?3', 'has_offset_account IS NULL']
  const binds: Array<string | number> = [lvrTier, securityPurpose, repaymentType]
  if (input.lenders.length > 0) {
    const placeholders = input.lenders.map((_value, index) => `?${binds.length + index + 1}`).join(', ')
    where.push(`bank_name IN (${placeholders})`)
    binds.push(...input.lenders)
  }
  if (input.startDate) {
    where.push(`collection_date >= ?${binds.length + 1}`)
    binds.push(input.startDate)
  }
  if (input.endDate) {
    where.push(`collection_date <= ?${binds.length + 1}`)
    binds.push(input.endDate)
  }
  const row = await db
    .prepare(`SELECT COUNT(*) AS total FROM historical_loan_rates WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ total: number }>()
  if (Number(row?.total ?? 0) > 0) {
    throw new OffsetFieldUnavailableError(
      'Offset filtering is unavailable until has_offset_account has been populated from real source payloads for the requested slice.',
    )
  }
}

async function queryLenderEvents(
  db: D1Database,
  seriesIds: string[],
  startDate?: string,
  endDate?: string,
): Promise<ChartEvent[]> {
  if (seriesIds.length === 0) return []
  const placeholders = seriesIds.map((_value, index) => `?${index + 1}`).join(', ')
  const binds: Array<string | number> = [...seriesIds]
  const where: string[] = [`series_key IN (${placeholders})`, `event_type = 'rate_change'`]
  if (startDate) {
    where.push(`collection_date >= ?${binds.length + 1}`)
    binds.push(startDate)
  }
  if (endDate) {
    where.push(`collection_date <= ?${binds.length + 1}`)
    binds.push(endDate)
  }
  const result = await db
    .prepare(
      `SELECT collection_date, bank_name, product_name, change_json, interest_rate
       FROM home_loan_rate_events
       WHERE ${where.join(' AND ')}
       ORDER BY collection_date ASC, parsed_at ASC`,
    )
    .bind(...binds)
    .all<HomeLoanEventRow>()

  return (result.results ?? []).map((row) => {
    const label = formatRateChangeLabel(row.bank_name, row.product_name, row.change_json, Number(row.interest_rate))
    return {
      date: assertChartDate(row.collection_date, 'home_loan_event_date'),
      type: 'LENDER',
      label: label.label,
      value: label.value,
    }
  })
}

export async function queryHomeLoanChartData(
  db: D1Database,
  input: HomeLoanChartInput,
): Promise<HomeLoanChartResponse> {
  const lvrTier = lvrTierFor(input.lvr)
  const securityPurpose = occupancyToDb(input.occupancy)
  const repaymentType = repaymentToDb(input.repaymentType)

  await assertOffsetReadiness(db, input, lvrTier, securityPurpose, repaymentType)

  const where: string[] = ['lvr_tier = ?1', 'security_purpose = ?2', 'repayment_type = ?3', 'has_offset_account = ?4']
  const binds: Array<string | number> = [lvrTier, securityPurpose, repaymentType, input.offset ? 1 : 0]
  if (input.lenders.length > 0) {
    const placeholders = input.lenders.map((_value, index) => `?${binds.length + index + 1}`).join(', ')
    where.push(`bank_name IN (${placeholders})`)
    binds.push(...input.lenders)
  }
  if (input.startDate) {
    where.push(`collection_date >= ?${binds.length + 1}`)
    binds.push(input.startDate)
  }
  if (input.endDate) {
    where.push(`collection_date <= ?${binds.length + 1}`)
    binds.push(input.endDate)
  }

  const result = await db
    .prepare(
      `SELECT
         bank_name AS lender,
         product_name,
         product_id,
         collection_date,
         interest_rate,
         security_purpose,
         repayment_type,
         rate_structure,
         lvr_tier,
         has_offset_account
       FROM historical_loan_rates
       WHERE ${where.join(' AND ')}
       ORDER BY bank_name ASC, product_name ASC, collection_date ASC, parsed_at ASC`,
    )
    .bind(...binds)
    .all<Omit<HomeLoanChartRow, 'id'>>()

  const seriesMap = new Map<HomeLoanChartResponse['series'][number]['id'], HomeLoanChartResponse['series'][number]>()
  for (const rawRow of result.results ?? []) {
    const row: HomeLoanChartRow = { ...rawRow, id: buildSeriesId(rawRow) }
    const date = assertChartDate(row.collection_date, 'home_loan_collection_date')
    const rate = assertChartRate(row.interest_rate, 'home_loan_interest_rate')
    if (row.has_offset_account == null) {
      throw new OffsetFieldUnavailableError('Offset value is unknown for at least one series in the requested slice.')
    }
    const rowOffset = Number(row.has_offset_account) === 1
    const existing = seriesMap.get(row.id)
    if (existing) {
      if (existing.offset !== rowOffset) {
        throw new OffsetFieldUnavailableError('Offset state changes over time for one or more series in the requested slice.')
      }
      existing.data.push({ date, rate })
      continue
    }
    seriesMap.set(row.id, {
      id: row.id,
      lender: row.lender,
      productName: row.product_name,
      lvr: input.lvr,
      repaymentType: input.repaymentType,
      occupancy: input.occupancy,
      offset: rowOffset,
      data: [{ date, rate }],
    })
  }

  const series = Array.from(seriesMap.values())
  const seriesIds = series.map((item) => item.id)
  const [rbaEvents, lenderEvents] = await Promise.all([
    queryRbaChartEvents(db, input.startDate, input.endDate),
    queryLenderEvents(db, seriesIds, input.startDate, input.endDate),
  ])

  return {
    series,
    events: sortChartEvents([...rbaEvents, ...lenderEvents]),
  }
}
