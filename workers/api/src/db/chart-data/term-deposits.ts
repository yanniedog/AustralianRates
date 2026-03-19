import { legacyProductKey } from '../../utils/series-identity'
import {
  assertChartDate,
  assertChartRate,
  formatRateChangeLabel,
  queryRbaChartEvents,
  sortChartEvents,
  type ChartEvent,
} from './common'

type TdChartInput = {
  lenders: string[]
  termMonths?: number
  interestPayment?: string
  depositTier?: string
  startDate?: string
  endDate?: string
}

type TdChartRow = {
  lender: string
  product_name: string
  product_id: string
  term_months: number
  interest_payment: string
  deposit_tier: string
  collection_date: string
  interest_rate: number
}

type TdEventRow = {
  collection_date: string
  bank_name: string
  product_name: string
  change_json: string
  interest_rate: number
}

export type TdChartResponse = {
  series: {
    id: string
    lender: string
    productName: string
    termMonths: number
    interestPayment: string
    depositTier: string
    data: Array<{ date: string; rate: number }>
  }[]
  events: ChartEvent[]
}

function buildSeriesId(row: Pick<TdChartRow, 'lender' | 'product_id' | 'term_months' | 'deposit_tier' | 'interest_payment'>): string {
  return legacyProductKey('term_deposits', {
    bankName: row.lender,
    productId: row.product_id,
    termMonths: row.term_months,
    depositTier: row.deposit_tier,
    interestPayment: row.interest_payment,
  })
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
       FROM td_rate_events
       WHERE ${where.join(' AND ')}
       ORDER BY collection_date ASC, parsed_at ASC`,
    )
    .bind(...binds)
    .all<TdEventRow>()

  return (result.results ?? []).map((row) => {
    const label = formatRateChangeLabel(row.bank_name, row.product_name, row.change_json, Number(row.interest_rate))
    return {
      date: assertChartDate(row.collection_date, 'td_event_date'),
      type: 'LENDER',
      label: label.label,
      value: label.value,
    }
  })
}

export async function queryTdChartData(
  db: D1Database,
  input: TdChartInput,
): Promise<TdChartResponse> {
  const where: string[] = []
  const binds: Array<string | number> = []
  if (input.lenders.length > 0) {
    const placeholders = input.lenders.map((_value, index) => `?${binds.length + index + 1}`).join(', ')
    where.push(`bank_name IN (${placeholders})`)
    binds.push(...input.lenders)
  }
  if (input.termMonths != null) {
    where.push(`term_months = ?${binds.length + 1}`)
    binds.push(input.termMonths)
  }
  if (input.interestPayment) {
    where.push(`interest_payment = ?${binds.length + 1}`)
    binds.push(input.interestPayment)
  }
  if (input.depositTier) {
    where.push(`deposit_tier = ?${binds.length + 1}`)
    binds.push(input.depositTier)
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
         term_months,
         interest_payment,
         deposit_tier,
         collection_date,
         interest_rate
       FROM historical_term_deposit_rates
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY bank_name ASC, product_name ASC, collection_date ASC, parsed_at ASC`,
    )
    .bind(...binds)
    .all<TdChartRow>()

  const seriesMap = new Map<TdChartResponse['series'][number]['id'], TdChartResponse['series'][number]>()
  for (const row of result.results ?? []) {
    const id = buildSeriesId(row)
    const date = assertChartDate(row.collection_date, 'td_collection_date')
    const rate = assertChartRate(row.interest_rate, 'td_interest_rate')
    const existing = seriesMap.get(id)
    if (existing) {
      existing.data.push({ date, rate })
      continue
    }
    seriesMap.set(id, {
      id,
      lender: row.lender,
      productName: row.product_name,
      termMonths: Number(row.term_months),
      interestPayment: row.interest_payment,
      depositTier: row.deposit_tier,
      data: [{ date, rate }],
    })
  }

  const series = Array.from(seriesMap.values())
  const [rbaEvents, lenderEvents] = await Promise.all([
    queryRbaChartEvents(db, input.startDate, input.endDate),
    queryLenderEvents(db, series.map((item) => item.id), input.startDate, input.endDate),
  ])

  return {
    series,
    events: sortChartEvents([...rbaEvents, ...lenderEvents]),
  }
}
