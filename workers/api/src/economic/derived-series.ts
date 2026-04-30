import { expandEconomicObservationsDaily, getEconomicObservationsForSeries, type EconomicObservationRow } from '../db/economic-series'
import { getRbaHistory, type RbaHistoryEntry } from '../db/rba-cash-rate'
import { dateRangeInclusive } from './parser-utils'
import type { EconomicSeriesDefinition } from './registry'

type Point = {
  date: string
  raw_value: number | null
  normalized_value: number | null
  observation_date: string | null
  release_date: string | null
}

type ExpandedComponent = {
  id: string
  points: Point[]
}

const INFLATION_TARGET_MIDPOINT = 2.5

function round(value: number, places = 3): number {
  return Number(value.toFixed(places))
}

function pointAt(component: ExpandedComponent | undefined, date: string): Point | null {
  return component?.points.find((point) => point.date === date) ?? null
}

function cashRateAt(history: RbaHistoryEntry[], date: string): number | null {
  let active: RbaHistoryEntry | null = null
  for (const row of history) {
    if (row.effective_date > date) break
    active = row
  }
  return active ? active.cash_rate : null
}

function scoreFromThresholds(value: number | null, low: number, mid: number, high: number, inverse = false): number | null {
  if (value == null || !Number.isFinite(value)) return null
  let score = value >= high ? 2 : value >= mid ? 1 : value <= low ? -1 : 0
  if (inverse) score *= -1
  return score
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!finite.length) return null
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length, 2)
}

async function loadComponents(
  db: D1Database,
  ids: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, ExpandedComponent>> {
  const entries = await Promise.all(
    Array.from(new Set(ids)).map(async (id) => {
      const rows = await getEconomicObservationsForSeries(db, id, startDate, endDate)
      return [id, { id, points: expandEconomicObservationsDaily(rows, startDate, endDate).points }] as const
    }),
  )
  return new Map(entries)
}

function valueForDerived(
  definition: EconomicSeriesDefinition,
  date: string,
  components: Map<string, ExpandedComponent>,
  rbaHistory: RbaHistoryEntry[],
): number | null {
  const id = definition.id
  const unemployment = pointAt(components.get('unemployment_rate'), date)?.raw_value ?? null
  const underutilisation = pointAt(components.get('underutilisation_rate'), date)?.raw_value ?? null
  const employmentPop = pointAt(components.get('employment_to_population'), date)?.raw_value ?? null
  const bill90 = pointAt(components.get('bank_bill_90d'), date)?.raw_value ?? null
  const cashRate = cashRateAt(rbaHistory, date)
  const monthlyTrimmed = pointAt(components.get('monthly_trimmed_mean_cpi'), date)?.raw_value ?? null
  const monthlyCpi = pointAt(components.get('monthly_cpi_indicator'), date)?.raw_value ?? null
  const trimmed = pointAt(components.get('trimmed_mean_cpi'), date)?.raw_value ?? null

  if (id === 'market_implied_cash_rate_gap') {
    if (bill90 == null || cashRate == null) return null
    return round((bill90 - cashRate) * 100, 1)
  }
  if (id === 'inflation_gap') {
    const inflation = monthlyTrimmed ?? monthlyCpi ?? trimmed
    return inflation == null ? null : round(inflation - INFLATION_TARGET_MIDPOINT, 2)
  }
  if (id === 'labour_slack') {
    return average([
      scoreFromThresholds(unemployment, 3.8, 4.3, 4.8, true),
      scoreFromThresholds(underutilisation, 9.0, 10.5, 12.0, true),
      scoreFromThresholds(employmentPop, 62.0, 64.0, 65.0),
    ])
  }
  if (id === 'vacancies_to_unemployed_ratio') {
    const vacancies = pointAt(components.get('job_vacancies'), date)?.raw_value ?? null
    if (vacancies == null || unemployment == null || unemployment === 0) return null
    return round(vacancies / unemployment, 3)
  }
  if (id === 'rba_signal_index') {
    const inflationGap = valueForDerived({ ...definition, id: 'inflation_gap' }, date, components, rbaHistory)
    const marketGap = valueForDerived({ ...definition, id: 'market_implied_cash_rate_gap' }, date, components, rbaHistory)
    const labour = valueForDerived({ ...definition, id: 'labour_slack' }, date, components, rbaHistory)
    const wage = pointAt(components.get('wage_growth'), date)?.raw_value ?? null
    const housing = pointAt(components.get('housing_credit_growth'), date)?.raw_value ?? null
    return average([
      scoreFromThresholds(inflationGap, -0.25, 0.25, 0.75),
      scoreFromThresholds(marketGap, -15, 10, 35),
      labour,
      scoreFromThresholds(wage, 2.8, 3.4, 4.0),
      scoreFromThresholds(housing, 3.5, 5.5, 7.0),
    ])
  }
  return null
}

export async function buildDerivedEconomicSeries(
  db: D1Database,
  definition: EconomicSeriesDefinition,
  startDate: string,
  endDate: string,
): Promise<{ baselineDate: string | null; baselineValue: number | null; points: Point[] }> {
  const componentIds = definition.collector.kind === 'derived' ? definition.collector.componentIds : []
  const components = await loadComponents(db, componentIds, startDate, endDate)
  const rbaHistory = await getRbaHistory(db)
  const observationRows: EconomicObservationRow[] = []
  for (const date of dateRangeInclusive(startDate, endDate)) {
    const value = valueForDerived(definition, date, components, rbaHistory)
    if (value == null) continue
    observationRows.push({
      series_id: definition.id,
      observation_date: date,
      value,
      source_url: definition.sourceUrl,
      release_date: date,
      frequency: definition.frequency,
      proxy_flag: definition.proxy ? 1 : 0,
      fetched_at: date,
      notes_json: null,
    })
  }
  return expandEconomicObservationsDaily(observationRows, startDate, endDate)
}
