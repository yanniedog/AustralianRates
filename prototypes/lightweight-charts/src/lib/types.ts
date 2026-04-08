export type DatasetKey = 'home-loans' | 'savings' | 'term-deposits'
export type RangeKey = '1Y' | '3Y' | '5Y' | 'ALL'

export type ChartEvent = {
  date: string
  type: 'RBA' | 'LENDER'
  label: string
  value?: number
}

export type HomeLoanFilters = {
  banks: string[]
  security_purposes: string[]
  repayment_types: string[]
  rate_structures: string[]
  lvr_tiers: string[]
  feature_sets: string[]
  single_value_columns: string[]
}

export type SavingsFilters = {
  banks: string[]
  account_types: string[]
  rate_types: string[]
  deposit_tiers: string[]
  single_value_columns: string[]
}

export type TdFilters = {
  banks: string[]
  term_months: string[]
  deposit_tiers: string[]
  interest_payments: string[]
  single_value_columns: string[]
}

export type HomeLoanSelection = {
  lenders: string[]
  occupancy: 'Owner' | 'Investor'
  repaymentType: 'P&I' | 'IO'
  lvr: number
  offset: boolean
}

export type SavingsSelection = {
  lenders: string[]
  accountType?: string
  rateType?: string
  depositTier?: string
}

export type TdSelection = {
  lenders: string[]
  termMonths?: number
  interestPayment?: string
  depositTier?: string
}

export type AnyFilters = HomeLoanFilters | SavingsFilters | TdFilters
export type AnySelection = HomeLoanSelection | SavingsSelection | TdSelection

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

export type AnyChartResponse = HomeLoanChartResponse | SavingsChartResponse | TdChartResponse

export type RenderableSeries = {
  id: string
  lender: string
  productName: string
  color: string
  meta: Array<{ label: string; value: string }>
  data: Array<{ date: string; rate: number }>
}

export type LegendState = {
  hiddenSeriesIds: string[]
  highlightedSeriesId: string | null
}

/** Matches workers/api `ReportMovesPoint` (real report-plot payload). */
export type ReportMovesPoint = {
  date: string
  up_count: number
  flat_count: number
  down_count: number
}

export type DatasetRuntimeState = {
  filters: AnyFilters | null
  selection: AnySelection | null
  response: AnyChartResponse | null
  range: RangeKey
  loadingFilters: boolean
  loadingChart: boolean
  error: string | null
  hiddenSeriesIds: string[]
  highlightedSeriesId: string | null
  lastLoadedKey: string | null
  /** Daily moves from report-plot; null if not yet loaded or fetch failed. */
  movesPoints: ReportMovesPoint[] | null
  lastMovesKey: string | null
}

export type PrototypeConfig = {
  prototypeSlug: string
  homeLoansApiBase: string
  savingsApiBase: string
  termDepositsApiBase: string
}

declare global {
  interface Window {
    AR_LIGHTWEIGHT_CHARTS_CONFIG?: PrototypeConfig
    AR?: {
      AdminPortal?: {
        guard: () => boolean
        logout: () => void
      }
    }
  }
}
