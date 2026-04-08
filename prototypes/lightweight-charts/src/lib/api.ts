import {
  apiBaseForDataset,
  buildReportPlotMovesQuery,
  rangeToRequest,
  readPrototypeConfig,
  serializeQuery,
  validateChartResponse,
  validateReportMovesPayload,
} from './chartHelpers'
import type {
  AnyChartResponse,
  AnyFilters,
  AnySelection,
  DatasetKey,
  HomeLoanFilters,
  HomeLoanSelection,
  RangeKey,
  ReportMovesPoint,
  SavingsFilters,
  SavingsSelection,
  TdFilters,
  TdSelection,
} from './types'

type ErrorPayload = {
  error?: {
    code?: string
    message?: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function requestJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { method: 'GET', signal })
  const json = (await response.json().catch(() => null)) as ErrorPayload | null
  if (!response.ok) {
    const message = json?.error?.message || 'Unable to load real chart data.'
    throw new Error(message)
  }
  return json
}

function validateFilters(dataset: DatasetKey, payload: unknown): AnyFilters {
  if (!isRecord(payload) || !payload.ok || !isRecord(payload.filters)) {
    throw new Error('Unable to load real filter data.')
  }
  const filters = payload.filters
  if (dataset === 'home-loans') {
    if (!Array.isArray(filters.banks) || !Array.isArray(filters.lvr_tiers)) throw new Error('Unable to load real filter data.')
    return filters as unknown as HomeLoanFilters
  }
  if (dataset === 'savings') {
    if (!Array.isArray(filters.banks) || !Array.isArray(filters.account_types)) throw new Error('Unable to load real filter data.')
    return filters as unknown as SavingsFilters
  }
  if (!Array.isArray(filters.banks) || !Array.isArray(filters.term_months)) throw new Error('Unable to load real filter data.')
  return filters as unknown as TdFilters
}

export async function fetchFilters(dataset: DatasetKey, signal: AbortSignal): Promise<AnyFilters> {
  const config = readPrototypeConfig()
  const apiBase = apiBaseForDataset(dataset, config)
  const payload = await requestJson(`${apiBase}/filters`, signal)
  return validateFilters(dataset, payload)
}

export async function fetchChartData(
  dataset: DatasetKey,
  selection: AnySelection,
  range: RangeKey,
  signal: AbortSignal,
): Promise<AnyChartResponse> {
  const config = readPrototypeConfig()
  const apiBase = apiBaseForDataset(dataset, config)
  const rangeParams = rangeToRequest(range)
  let query = ''

  if (dataset === 'home-loans') {
    const typed = selection as HomeLoanSelection
    query = serializeQuery({
      lenders: typed.lenders,
      lvr: typed.lvr,
      repaymentType: typed.repaymentType,
      occupancy: typed.occupancy,
      offset: typed.offset,
      ...rangeParams,
    })
  } else if (dataset === 'savings') {
    const typed = selection as SavingsSelection
    query = serializeQuery({
      lenders: typed.lenders,
      accountType: typed.accountType,
      rateType: typed.rateType,
      depositTier: typed.depositTier,
      ...rangeParams,
    })
  } else {
    const typed = selection as TdSelection
    query = serializeQuery({
      lenders: typed.lenders,
      termMonths: typed.termMonths,
      interestPayment: typed.interestPayment,
      depositTier: typed.depositTier,
      ...rangeParams,
    })
  }

  const payload = await requestJson(`${apiBase}/chart-data?${query}`, signal)
  return validateChartResponse(dataset, payload)
}

export async function fetchReportPlotMoves(
  dataset: DatasetKey,
  selection: AnySelection,
  range: RangeKey,
  signal: AbortSignal,
): Promise<ReportMovesPoint[]> {
  const config = readPrototypeConfig()
  const apiBase = apiBaseForDataset(dataset, config)
  const plotQuery = buildReportPlotMovesQuery(dataset, selection, range)
  const payload = await requestJson(`${apiBase}/analytics/report-plot?mode=moves&${plotQuery}`, signal)
  return validateReportMovesPayload(payload)
}
