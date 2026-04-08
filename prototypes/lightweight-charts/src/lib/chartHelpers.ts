import type {
  AnyChartResponse,
  AnyFilters,
  AnySelection,
  ChartEvent,
  DatasetKey,
  HomeLoanChartResponse,
  HomeLoanFilters,
  HomeLoanSelection,
  PrototypeConfig,
  RangeKey,
  RenderableSeries,
  ReportMovesPoint,
  SavingsChartResponse,
  SavingsFilters,
  SavingsSelection,
  TdChartResponse,
  TdFilters,
  TdSelection,
} from './types'

const LENDER_PALETTE = ['#0f766e', '#1d4ed8', '#b45309', '#047857', '#b91c1c', '#4338ca', '#be185d', '#166534', '#0f172a', '#7c2d12', '#0369a1', '#1f2937']

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function clampLenders(values: string[], available: string[]): string[] {
  const allowed = new Set(available)
  const selected = unique(values).filter((value) => allowed.has(value))
  if (selected.length > 0) return selected
  return available.slice(0, 3)
}

function parseBoolean(value: string | null): boolean | null {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return null
  if (text === 'true' || text === '1' || text === 'yes') return true
  if (text === 'false' || text === '0' || text === 'no') return false
  return null
}

function subtractYears(rangeKey: Exclude<RangeKey, 'ALL'>): string {
  const years = rangeKey === '1Y' ? 1 : rangeKey === '3Y' ? 3 : 5
  const date = new Date()
  date.setUTCFullYear(date.getUTCFullYear() - years)
  return date.toISOString().slice(0, 10)
}

export function readPrototypeConfig(): PrototypeConfig {
  const config = window.AR_LIGHTWEIGHT_CHARTS_CONFIG
  if (!config) {
    throw new Error('Prototype config is missing.')
  }
  return config
}

export function datasetLabel(dataset: DatasetKey): string {
  if (dataset === 'home-loans') return 'Home Loans'
  if (dataset === 'savings') return 'Savings'
  return 'Term Deposits'
}

export function apiBaseForDataset(dataset: DatasetKey, config: PrototypeConfig): string {
  if (dataset === 'home-loans') return config.homeLoansApiBase
  if (dataset === 'savings') return config.savingsApiBase
  return config.termDepositsApiBase
}

export function serializeQuery(params: Record<string, string | number | boolean | Array<string | number> | undefined>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '') return
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(`${key}[]`, String(item)))
      return
    }
    search.set(key, String(value))
  })
  return search.toString()
}

export function rangeToRequest(range: RangeKey): { startDate?: string; endDate?: string } {
  if (range === 'ALL') return {}
  return {
    startDate: subtractYears(range),
    endDate: new Date().toISOString().slice(0, 10),
  }
}

export function lenderColor(lender: string): string {
  let hash = 0
  for (const char of lender) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return LENDER_PALETTE[Math.abs(hash) % LENDER_PALETTE.length]
}

export function insertWhitespaceGaps(data: Array<{ date: string; rate: number }>): Array<{ time: string; value?: number }> {
  const output: Array<{ time: string; value?: number }> = []
  for (let index = 0; index < data.length; index += 1) {
    const point = data[index]
    output.push({ time: point.date, value: point.rate })
    const next = data[index + 1]
    if (!next) continue
    const currentDate = new Date(`${point.date}T00:00:00Z`)
    const nextDate = new Date(`${next.date}T00:00:00Z`)
    const diffDays = Math.round((nextDate.getTime() - currentDate.getTime()) / 86400000)
    if (diffDays > 1) {
      const gapDate = new Date(currentDate)
      gapDate.setUTCDate(gapDate.getUTCDate() + 1)
      output.push({ time: gapDate.toISOString().slice(0, 10) })
    }
  }
  return output
}

export function formatRate(rate: number): string {
  return `${rate.toFixed(2)}%`
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

export function legendStorageKey(prototypeSlug: string, dataset: DatasetKey): string {
  return `ar.prototype.${prototypeSlug}.${dataset}.legendHidden`
}

export function loadHiddenSeries(prototypeSlug: string, dataset: DatasetKey): string[] {
  try {
    const raw = window.localStorage.getItem(legendStorageKey(prototypeSlug, dataset))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? unique(parsed.map((value) => String(value || ''))) : []
  } catch {
    return []
  }
}

export function saveHiddenSeries(prototypeSlug: string, dataset: DatasetKey, hiddenSeriesIds: string[]): void {
  try {
    window.localStorage.setItem(legendStorageKey(prototypeSlug, dataset), JSON.stringify(unique(hiddenSeriesIds)))
  } catch {}
}

export function lvrOptions(filters: HomeLoanFilters): number[] {
  return filters.lvr_tiers
    .map((tier) => {
      if (tier === 'lvr_=60%') return 60
      const match = tier.match(/(\d+)-(\d+)%$/)
      return match ? Number(match[2]) : null
    })
    .filter((value): value is number => value != null)
}

export function defaultSelection(dataset: DatasetKey, filters: AnyFilters, params: URLSearchParams): AnySelection {
  const requestedLenders = unique((params.get('lenders') || '').split(','))
  if (dataset === 'home-loans') {
    const typedFilters = filters as HomeLoanFilters
    const availableLvr = lvrOptions(typedFilters)
    const requestedLvr = Number(params.get('lvr') || '')
    return {
      lenders: clampLenders(requestedLenders, typedFilters.banks),
      occupancy: params.get('occupancy') === 'Investor' ? 'Investor' : 'Owner',
      repaymentType: params.get('repaymentType') === 'IO' ? 'IO' : 'P&I',
      lvr: availableLvr.includes(requestedLvr) ? requestedLvr : (availableLvr.includes(80) ? 80 : availableLvr[0] ?? 80),
      offset: parseBoolean(params.get('offset')) ?? false,
    } satisfies HomeLoanSelection
  }
  if (dataset === 'savings') {
    const typedFilters = filters as SavingsFilters
    const accountType = params.get('accountType') || undefined
    const rateType = params.get('rateType') || undefined
    const depositTier = params.get('depositTier') || undefined
    return {
      lenders: clampLenders(requestedLenders, typedFilters.banks),
      accountType: typedFilters.account_types.includes(String(accountType || '')) ? accountType : undefined,
      rateType: typedFilters.rate_types.includes(String(rateType || '')) ? rateType : undefined,
      depositTier: typedFilters.deposit_tiers.includes(String(depositTier || '')) ? depositTier : undefined,
    } satisfies SavingsSelection
  }
  const typedFilters = filters as TdFilters
  const requestedTermMonths = Number(params.get('termMonths') || '')
  const availableTermMonths = typedFilters.term_months.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  const requestedInterestPayment = params.get('interestPayment') || undefined
  const defaultTermMonths = availableTermMonths.includes(12) ? 12 : availableTermMonths[0]
  return {
    lenders: clampLenders(requestedLenders, typedFilters.banks),
    termMonths: availableTermMonths.includes(requestedTermMonths) ? requestedTermMonths : defaultTermMonths,
    interestPayment: typedFilters.interest_payments.includes(String(requestedInterestPayment || ''))
      ? requestedInterestPayment
      : (typedFilters.interest_payments.includes('at_maturity') ? 'at_maturity' : typedFilters.interest_payments[0]),
    depositTier: typedFilters.deposit_tiers.includes(String(params.get('depositTier') || '')) ? params.get('depositTier') || undefined : undefined,
  } satisfies TdSelection
}

export function validateChartResponse(dataset: DatasetKey, payload: unknown): AnyChartResponse {
  if (!isRecord(payload) || !Array.isArray(payload.series) || !Array.isArray(payload.events)) {
    throw new Error('Chart data response is invalid.')
  }
  payload.events.forEach((event) => {
    if (!isRecord(event) || !isDateString(event.date) || (event.type !== 'RBA' && event.type !== 'LENDER') || typeof event.label !== 'string') {
      throw new Error('Chart data response is invalid.')
    }
    if (event.value != null && !Number.isFinite(Number(event.value))) throw new Error('Chart data response is invalid.')
  })
  if (dataset === 'home-loans') {
    const typed = payload as HomeLoanChartResponse
    typed.series.forEach((series) => {
      if (typeof series.id !== 'string' || typeof series.lender !== 'string' || typeof series.productName !== 'string') throw new Error('Chart data response is invalid.')
      if ((series.repaymentType !== 'P&I' && series.repaymentType !== 'IO') || (series.occupancy !== 'Owner' && series.occupancy !== 'Investor')) throw new Error('Chart data response is invalid.')
      if (typeof series.offset !== 'boolean' || !Number.isFinite(series.lvr)) throw new Error('Chart data response is invalid.')
      series.data.forEach((point) => {
        if (!isDateString(point.date) || !Number.isFinite(point.rate)) throw new Error('Chart data response is invalid.')
      })
    })
    return typed
  }
  if (dataset === 'savings') {
    const typed = payload as SavingsChartResponse
    typed.series.forEach((series) => {
      if (!series.id || !series.lender || !series.productName || !series.accountType || !series.rateType) throw new Error('Chart data response is invalid.')
      series.data.forEach((point) => {
        if (!isDateString(point.date) || !Number.isFinite(point.rate)) throw new Error('Chart data response is invalid.')
      })
    })
    return typed
  }
  const typed = payload as TdChartResponse
  typed.series.forEach((series) => {
    if (!series.id || !series.lender || !series.productName || !series.interestPayment || !Number.isFinite(series.termMonths)) {
      throw new Error('Chart data response is invalid.')
    }
    series.data.forEach((point) => {
      if (!isDateString(point.date) || !Number.isFinite(point.rate)) throw new Error('Chart data response is invalid.')
    })
  })
  return typed
}

export function toRenderableSeries(dataset: DatasetKey, response: AnyChartResponse): RenderableSeries[] {
  if (dataset === 'home-loans') {
    return (response as HomeLoanChartResponse).series.map((series) => ({
      id: series.id,
      lender: series.lender,
      productName: series.productName,
      color: lenderColor(series.lender),
      data: series.data,
      meta: [
        { label: 'LVR', value: `${series.lvr}%` },
        { label: 'Repayment', value: series.repaymentType },
        { label: 'Occupancy', value: series.occupancy },
        { label: 'Offset', value: series.offset ? 'Yes' : 'No' },
      ],
    }))
  }
  if (dataset === 'savings') {
    return (response as SavingsChartResponse).series.map((series) => ({
      id: series.id,
      lender: series.lender,
      productName: series.productName,
      color: lenderColor(series.lender),
      data: series.data,
      meta: [
        { label: 'Account', value: series.accountType },
        { label: 'Rate Type', value: series.rateType },
        { label: 'Deposit Tier', value: series.depositTier || 'All' },
      ],
    }))
  }
  return (response as TdChartResponse).series.map((series) => ({
    id: series.id,
    lender: series.lender,
    productName: series.productName,
    color: lenderColor(series.lender),
    data: series.data,
    meta: [
      { label: 'Term', value: `${series.termMonths} months` },
      { label: 'Interest', value: series.interestPayment },
      { label: 'Deposit Tier', value: series.depositTier || 'All' },
    ],
  }))
}

export function eventsByDate(events: ChartEvent[]): Map<string, ChartEvent[]> {
  const grouped = new Map<string, ChartEvent[]>()
  events.forEach((event) => {
    const existing = grouped.get(event.date) ?? []
    existing.push(event)
    grouped.set(event.date, existing)
  })
  return grouped
}

export function buildChartRequestKey(dataset: DatasetKey, selection: AnySelection, range: RangeKey): string {
  return `${dataset}:${range}:${serializeQuery(selection as Record<string, string | number | boolean | Array<string | number> | undefined>)}`
}

export function buildMovesRequestKey(dataset: DatasetKey, selection: AnySelection, range: RangeKey): string {
  return `moves:${buildChartRequestKey(dataset, selection, range)}`
}

/** Aligns with `workers/api` chart-data `lvrTierFor` mapping. */
export function lvrTierFromNumber(lvr: number): string {
  if (!Number.isFinite(lvr) || lvr < 0 || lvr > 95) return 'lvr_80-85%'
  if (lvr <= 60) return 'lvr_=60%'
  if (lvr <= 70) return 'lvr_60-70%'
  if (lvr <= 80) return 'lvr_70-80%'
  if (lvr <= 85) return 'lvr_80-85%'
  if (lvr <= 90) return 'lvr_85-90%'
  return 'lvr_90-95%'
}

function serializeSnakeQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') return
    search.set(key, String(value))
  })
  return search.toString()
}

/** Query string for `GET .../analytics/report-plot` (mode=moves added in fetch). */
export function buildReportPlotMovesQuery(dataset: DatasetKey, selection: AnySelection, range: RangeKey): string {
  const rangeParams = rangeToRequest(range)
  const base: Record<string, string | number | undefined> = {
    min_rate: 0.01,
    start_date: rangeParams.startDate,
    end_date: rangeParams.endDate,
  }

  if (dataset === 'home-loans') {
    const s = selection as HomeLoanSelection
    return serializeSnakeQuery({
      ...base,
      security_purpose: s.occupancy === 'Investor' ? 'investment' : 'owner_occupied',
      repayment_type: s.repaymentType === 'IO' ? 'interest_only' : 'principal_and_interest',
      lvr_tier: lvrTierFromNumber(s.lvr),
      rate_structure: 'variable',
      banks: s.lenders.length ? s.lenders.join(',') : undefined,
    })
  }

  if (dataset === 'savings') {
    const s = selection as SavingsSelection
    return serializeSnakeQuery({
      ...base,
      banks: s.lenders.length ? s.lenders.join(',') : undefined,
      account_type: s.accountType,
      rate_type: s.rateType,
      deposit_tier: s.depositTier,
    })
  }

  const s = selection as TdSelection
  return serializeSnakeQuery({
    ...base,
    banks: s.lenders.length ? s.lenders.join(',') : undefined,
    term_months: s.termMonths != null ? String(s.termMonths) : undefined,
    interest_payment: s.interestPayment,
    deposit_tier: s.depositTier,
  })
}

export function validateReportMovesPayload(payload: unknown): ReportMovesPoint[] {
  if (!isRecord(payload) || payload.mode !== 'moves' || !Array.isArray(payload.points)) {
    throw new Error('Report plot moves response is invalid.')
  }
  return payload.points.map((row) => {
    if (!isRecord(row) || !isDateString(row.date)) throw new Error('Report plot moves response is invalid.')
    return {
      date: row.date,
      up_count: Number(row.up_count || 0),
      flat_count: Number(row.flat_count || 0),
      down_count: Number(row.down_count || 0),
    }
  })
}
