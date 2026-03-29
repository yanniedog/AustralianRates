import { legacyProductKey } from '../../utils/series-identity'
import { addBalanceBandOverlapWhere } from '../query-common'
import {
  assertChartDate,
  assertChartRate,
  formatRateChangeLabel,
  queryRbaChartEvents,
  sortChartEvents,
  type ChartEvent,
} from './common'

type SavingsChartInput = {
  lenders: string[]
  accountType?: string
  rateType?: string
  depositTier?: string
  balanceMin?: number
  balanceMax?: number
  startDate?: string
  endDate?: string
}

type SavingsChartRow = {
  lender: string
  product_name: string
  product_id: string
  account_type: string
  rate_type: string
  deposit_tier: string
  collection_date: string
  interest_rate: number
}

type SavingsEventRow = {
  collection_date: string
  bank_name: string
  product_name: string
  change_json: string
  interest_rate: number
}

export type SavingsChartResponse = {
  series: {
    id: string
    lender: string
    productName: string
    accountType: string
    rateType: string
    depositTier: string
    data: Array<{ date: string; rate: number }>
  }[]
  events: ChartEvent[]
}

function buildSeriesId(row: Pick<SavingsChartRow, 'lender' | 'product_id' | 'account_type' | 'rate_type' | 'deposit_tier'>): string {
  return legacyProductKey('savings', {
    bankName: row.lender,
    productId: row.product_id,
    accountType: row.account_type,
    rateType: row.rate_type,
    depositTier: row.deposit_tier,
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
       FROM savings_rate_events
       WHERE ${where.join(' AND ')}
       ORDER BY collection_date ASC, parsed_at ASC`,
    )
    .bind(...binds)
    .all<SavingsEventRow>()

  return (result.results ?? []).map((row) => {
    const label = formatRateChangeLabel(row.bank_name, row.product_name, row.change_json, Number(row.interest_rate))
    return {
      date: assertChartDate(row.collection_date, 'savings_event_date'),
      type: 'LENDER',
      label: label.label,
      value: label.value,
    }
  })
}

export async function querySavingsChartData(
  db: D1Database,
  input: SavingsChartInput,
): Promise<SavingsChartResponse> {
  const where: string[] = []
  const binds: Array<string | number> = []
  if (input.lenders.length > 0) {
    const placeholders = input.lenders.map((_value, index) => `?${binds.length + index + 1}`).join(', ')
    where.push(`bank_name IN (${placeholders})`)
    binds.push(...input.lenders)
  }
  if (input.accountType) {
    where.push(`account_type = ?${binds.length + 1}`)
    binds.push(input.accountType)
  }
  if (input.rateType) {
    where.push(`rate_type = ?${binds.length + 1}`)
    binds.push(input.rateType)
  }
  if (input.depositTier) {
    where.push(`deposit_tier = ?${binds.length + 1}`)
    binds.push(input.depositTier)
  }
  addBalanceBandOverlapWhere(where, binds, 'min_balance', 'max_balance', input.balanceMin, input.balanceMax)
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
         account_type,
         rate_type,
         deposit_tier,
         collection_date,
         interest_rate
       FROM historical_savings_rates
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY bank_name ASC, product_name ASC, collection_date ASC, parsed_at ASC`,
    )
    .bind(...binds)
    .all<SavingsChartRow>()

  const seriesMap = new Map<SavingsChartResponse['series'][number]['id'], SavingsChartResponse['series'][number]>()
  for (const row of result.results ?? []) {
    const id = buildSeriesId(row)
    const date = assertChartDate(row.collection_date, 'savings_collection_date')
    const rate = assertChartRate(row.interest_rate, 'savings_interest_rate')
    const existing = seriesMap.get(id)
    if (existing) {
      existing.data.push({ date, rate })
      continue
    }
    seriesMap.set(id, {
      id,
      lender: row.lender,
      productName: row.product_name,
      accountType: row.account_type,
      rateType: row.rate_type,
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
