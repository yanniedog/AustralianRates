import { getEconomicStatusMap } from '../db/economic-series'
import { getRbaHistory } from '../db/rba-cash-rate'
import { ECONOMIC_SERIES_DEFINITIONS, getEconomicSeriesDefinition } from './registry'

type LatestRow = {
  series_id: string
  observation_date: string
  value: number
  source_url: string
}

export type RbaSignalComponent = {
  key: string
  label: string
  value: number | null
  prior_value: number | null
  change: number | null
  score: number | null
  source_series_ids: string[]
  freshness: Array<{
    series_id: string
    status: string | null
    last_observation_date: string | null
    message: string | null
  }>
}

export type RbaSignalPayload = {
  ok: true
  generated_at: string
  cash_rate: number | null
  cash_rate_date: string | null
  market_expected_change_bps: number | null
  inflation_gap_pp: number | null
  inflation_momentum: number | null
  labour_slack: number | null
  wage_pressure: number | null
  demand_pressure: number | null
  housing_credit_pressure: number | null
  global_pressure: number | null
  overall_score: number | null
  overall_bias: 'hike' | 'hold' | 'cut'
  components: RbaSignalComponent[]
}

const INFLATION_TARGET_MIDPOINT = 2.5

function round(value: number | null, places = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Number(value.toFixed(places))
}

function score(value: number | null, low: number, mid: number, high: number, inverse = false): number | null {
  if (value == null || !Number.isFinite(value)) return null
  let next = value >= high ? 2 : value >= mid ? 1 : value <= low ? -1 : 0
  if (inverse) next *= -1
  return next
}

function avg(values: Array<number | null>, places = 2): number | null {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!finite.length) return null
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length, places)
}

async function latestRows(db: D1Database, seriesId: string, limit = 2): Promise<LatestRow[]> {
  const rows = await db
    .prepare(
      `SELECT series_id, observation_date, value, source_url
       FROM economic_series_observations
       WHERE series_id = ?1
       ORDER BY observation_date DESC
       LIMIT ?2`,
    )
    .bind(seriesId, limit)
    .all<LatestRow>()
  return rows.results ?? []
}

function firstValue(rows: LatestRow[]): number | null {
  const value = rows[0]?.value
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function secondValue(rows: LatestRow[]): number | null {
  const value = rows[1]?.value
  return Number.isFinite(Number(value)) ? Number(value) : null
}

async function firstAvailable(db: D1Database, ids: string[]): Promise<{ id: string; rows: LatestRow[] } | null> {
  for (const id of ids) {
    const rows = await latestRows(db, id)
    if (rows.length) return { id, rows }
  }
  return null
}

function freshness(statusMap: Awaited<ReturnType<typeof getEconomicStatusMap>>, ids: string[]) {
  return ids.map((id) => {
    const row = statusMap.get(id)
    return {
      series_id: id,
      status: row?.status ?? (getEconomicSeriesDefinition(id)?.collector.kind === 'derived' ? 'derived' : null),
      last_observation_date: row?.last_observation_date ?? null,
      message: row?.message ?? null,
    }
  })
}

function component(input: Omit<RbaSignalComponent, 'change'>): RbaSignalComponent {
  return {
    ...input,
    change: input.value == null || input.prior_value == null ? null : round(input.value - input.prior_value),
  }
}

function biasFromScore(value: number | null): 'hike' | 'hold' | 'cut' {
  if (value == null) return 'hold'
  if (value >= 0.65) return 'hike'
  if (value <= -0.65) return 'cut'
  return 'hold'
}

export async function buildRbaSignals(db: D1Database): Promise<RbaSignalPayload> {
  const statusMap = await getEconomicStatusMap(db)
  const rbaHistory = await getRbaHistory(db)
  const cash = rbaHistory[rbaHistory.length - 1] ?? null
  const cashRate = cash?.cash_rate ?? null
  const bill90Rows = await latestRows(db, 'bank_bill_90d')
  const bill90 = firstValue(bill90Rows)
  const marketGap = bill90 == null || cashRate == null ? null : round((bill90 - cashRate) * 100, 1)
  const inflation = await firstAvailable(db, ['monthly_trimmed_mean_cpi', 'monthly_cpi_indicator', 'trimmed_mean_cpi'])
  const inflationValue = firstValue(inflation?.rows ?? [])
  const inflationPrior = secondValue(inflation?.rows ?? [])
  const inflationGap = inflationValue == null ? null : round(inflationValue - INFLATION_TARGET_MIDPOINT)
  const unemploymentRows = await latestRows(db, 'unemployment_rate')
  const underutilisationRows = await latestRows(db, 'underutilisation_rate')
  const employmentPopRows = await latestRows(db, 'employment_to_population')
  const wageRows = await firstAvailable(db, ['abs_wage_price_index', 'wage_growth'])
  const businessRows = await latestRows(db, 'business_conditions')
  const sentimentRows = await latestRows(db, 'consumer_sentiment')
  const spendingRows = await latestRows(db, 'household_spending_indicator')
  const housingRows = await latestRows(db, 'housing_credit_growth')
  const fedRows = await latestRows(db, 'fed_funds_proxy')
  const rbnzRows = await latestRows(db, 'rbnz_ocr')
  const commodityRows = await latestRows(db, 'commodity_prices')

  const labourScore = avg([
    score(firstValue(unemploymentRows), 3.8, 4.3, 4.8, true),
    score(firstValue(underutilisationRows), 9.0, 10.5, 12.0, true),
    score(firstValue(employmentPopRows), 62.0, 64.0, 65.0),
  ])
  const demandScore = avg([
    score(firstValue(businessRows), -4, 4, 10),
    score(firstValue(sentimentRows), 85, 100, 110),
    score(firstValue(spendingRows), 1.5, 3.5, 5.0),
  ])
  const globalScore = avg([
    cashRate == null ? null : score(firstValue(fedRows) == null ? null : (firstValue(fedRows) as number) - cashRate, -0.75, 0.25, 1.0),
    cashRate == null ? null : score(firstValue(rbnzRows) == null ? null : (firstValue(rbnzRows) as number) - cashRate, -1.25, -0.25, 0.5),
    score(firstValue(commodityRows), 85, 100, 115),
  ])

  const components = [
    component({
      key: 'market',
      label: 'Market pricing',
      value: marketGap,
      prior_value: secondValue(bill90Rows) == null || cashRate == null ? null : round(((secondValue(bill90Rows) as number) - cashRate) * 100, 1),
      score: score(marketGap, -15, 10, 35),
      source_series_ids: ['bank_bill_90d'],
      freshness: freshness(statusMap, ['bank_bill_90d']),
    }),
    component({
      key: 'inflation',
      label: 'Inflation',
      value: inflationGap,
      prior_value: inflationPrior == null ? null : round(inflationPrior - INFLATION_TARGET_MIDPOINT),
      score: score(inflationGap, -0.25, 0.25, 0.75),
      source_series_ids: inflation ? [inflation.id] : ['monthly_trimmed_mean_cpi', 'monthly_cpi_indicator', 'trimmed_mean_cpi'],
      freshness: freshness(statusMap, inflation ? [inflation.id] : ['monthly_trimmed_mean_cpi', 'monthly_cpi_indicator', 'trimmed_mean_cpi']),
    }),
    component({
      key: 'labour',
      label: 'Labour',
      value: labourScore,
      prior_value: null,
      score: labourScore,
      source_series_ids: ['unemployment_rate', 'underutilisation_rate', 'employment_to_population'],
      freshness: freshness(statusMap, ['unemployment_rate', 'underutilisation_rate', 'employment_to_population']),
    }),
    component({
      key: 'wages',
      label: 'Wages',
      value: firstValue(wageRows?.rows ?? []),
      prior_value: secondValue(wageRows?.rows ?? []),
      score: score(firstValue(wageRows?.rows ?? []), 2.8, 3.4, 4.0),
      source_series_ids: wageRows ? [wageRows.id] : ['abs_wage_price_index', 'wage_growth'],
      freshness: freshness(statusMap, wageRows ? [wageRows.id] : ['abs_wage_price_index', 'wage_growth']),
    }),
    component({
      key: 'demand',
      label: 'Demand',
      value: demandScore,
      prior_value: null,
      score: demandScore,
      source_series_ids: ['business_conditions', 'consumer_sentiment', 'household_spending_indicator'],
      freshness: freshness(statusMap, ['business_conditions', 'consumer_sentiment', 'household_spending_indicator']),
    }),
    component({
      key: 'housing',
      label: 'Housing credit',
      value: firstValue(housingRows),
      prior_value: secondValue(housingRows),
      score: score(firstValue(housingRows), 3.5, 5.5, 7.0),
      source_series_ids: ['housing_credit_growth'],
      freshness: freshness(statusMap, ['housing_credit_growth']),
    }),
    component({
      key: 'global',
      label: 'Global',
      value: globalScore,
      prior_value: null,
      score: globalScore,
      source_series_ids: ['fed_funds_proxy', 'rbnz_ocr', 'commodity_prices'],
      freshness: freshness(statusMap, ['fed_funds_proxy', 'rbnz_ocr', 'commodity_prices']),
    }),
  ]
  const overallScore = avg(components.map((row) => row.score))

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    cash_rate: cashRate,
    cash_rate_date: cash?.effective_date ?? null,
    market_expected_change_bps: marketGap,
    inflation_gap_pp: inflationGap,
    inflation_momentum: inflationValue == null || inflationPrior == null ? null : round(inflationValue - inflationPrior),
    labour_slack: labourScore,
    wage_pressure: components.find((row) => row.key === 'wages')?.score ?? null,
    demand_pressure: demandScore,
    housing_credit_pressure: components.find((row) => row.key === 'housing')?.score ?? null,
    global_pressure: globalScore,
    overall_score: overallScore,
    overall_bias: biasFromScore(overallScore),
    components,
  }
}

export const RBA_SIGNAL_SOURCE_SERIES_IDS = ECONOMIC_SERIES_DEFINITIONS
  .filter((definition) => definition.presets.includes('rba_signal_dashboard'))
  .map((definition) => definition.id)
