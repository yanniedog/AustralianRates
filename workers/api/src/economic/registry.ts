export type EconomicFrequency = 'daily' | 'monthly' | 'quarterly' | 'annual' | 'policy'
export type EconomicCategory =
  | 'labour'
  | 'inflation'
  | 'demand'
  | 'housing'
  | 'markets'
  | 'global'
export type EconomicPresetId = 'rba_watchlist' | 'housing_transmission' | 'global_pulse'

type RbaCsvCollector = {
  kind: 'rba_csv'
  url: string
  seriesId: string
}

type CompositeLendingCollector = {
  kind: 'rba_lending_proxy'
  housingUrl: string
  housingSeriesId: string
  businessUrl: string
  businessSeriesId: string
}

type RbnzCollector = {
  kind: 'rbnz_ocr_history'
  url: string
  transportUrl: string
}

type FedCollector = {
  kind: 'fed_target_history'
  url: string
  transportUrl: string
}

type FredCollector = {
  kind: 'fred_csv'
  url: string
  transportUrl?: string
  valueMode: 'identity' | 'china_yoy_from_level'
}

export type EconomicCollectorSpec =
  | RbaCsvCollector
  | CompositeLendingCollector
  | RbnzCollector
  | FedCollector
  | FredCollector

export type EconomicSeriesDefinition = {
  id: string
  label: string
  shortLabel: string
  category: EconomicCategory
  unit: string
  frequency: EconomicFrequency
  proxy: boolean
  sourceLabel: string
  sourceUrl: string
  staleAfterDays: number
  description: string
  presets: EconomicPresetId[]
  collector: EconomicCollectorSpec
}

const RBA = 'https://www.rba.gov.au/statistics/tables/index.html'
const RBA_H5 = 'https://www.rba.gov.au/statistics/tables/csv/h5-data.csv'
const RBA_G1 = 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv'
const RBA_G3 = 'https://www.rba.gov.au/statistics/tables/csv/g3-data.csv'
const RBA_H2 = 'https://www.rba.gov.au/statistics/tables/csv/h2-data.csv'
const RBA_H3 = 'https://www.rba.gov.au/statistics/tables/csv/h3-data.csv'
const RBA_H4 = 'https://www.rba.gov.au/statistics/tables/csv/h4-data.csv'
const RBA_D1 = 'https://www.rba.gov.au/statistics/tables/csv/d1-data.csv'
const RBA_F1 = 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv'
const RBA_F1_1 = 'https://www.rba.gov.au/statistics/tables/csv/f1.1-data.csv'
const RBA_F5 = 'https://www.rba.gov.au/statistics/tables/csv/f5-data.csv'
const RBA_F7 = 'https://www.rba.gov.au/statistics/tables/csv/f7-data.csv'
const RBA_F11 = 'https://www.rba.gov.au/statistics/tables/csv/f11-data.csv'
const RBA_I2 = 'https://www.rba.gov.au/statistics/tables/csv/i2-data.csv'
const RBA_J1 = 'https://www.rba.gov.au/statistics/tables/csv/j1-star-variables.csv'
const RBNZ_DECISIONS = 'https://www.rbnz.govt.nz/monetary-policy/monetary-policy-decisions'
const RBNZ_DECISIONS_TRANSPORT = 'https://r.jina.ai/http://www.rbnz.govt.nz/monetary-policy/monetary-policy-decisions'
const FED_OPEN_MARKET = 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm?os=shmmfp'
const FED_OPEN_MARKET_TRANSPORT = 'https://r.jina.ai/http://www.federalreserve.gov/monetarypolicy/openmarket.htm?os=shmmfp'
const FRED_CHINA_GDP = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CHNGDPRAPSMEI'

export const ECONOMIC_PRESETS: Array<{
  id: EconomicPresetId
  label: string
  description: string
  seriesIds: string[]
}> = [
  {
    id: 'rba_watchlist',
    label: 'RBA Watchlist',
    description: 'Core labour, inflation, expectations, neutral-rate, and money-market indicators.',
    seriesIds: [
      'unemployment_rate',
      'trimmed_mean_cpi',
      'inflation_expectations',
      'neutral_rate',
      'bank_bill_90d',
    ],
  },
  {
    id: 'housing_transmission',
    label: 'Housing Transmission',
    description: 'Housing finance, credit, household demand, and wage channels most exposed to policy changes.',
    seriesIds: [
      'major_bank_lending_rates',
      'housing_credit_growth',
      'household_consumption',
      'consumer_sentiment',
      'wage_growth',
    ],
  },
  {
    id: 'global_pulse',
    label: 'Global Pulse',
    description: 'External policy, FX, commodity, and China-growth signals that can move the RBA reaction function.',
    seriesIds: [
      'rbnz_ocr',
      'fed_funds_proxy',
      'aud_twi',
      'commodity_prices',
      'major_trading_partner_growth_proxy',
    ],
  },
]

export const ECONOMIC_SERIES_DEFINITIONS: EconomicSeriesDefinition[] = [
  {
    id: 'unemployment_rate',
    label: 'Unemployment rate',
    shortLabel: 'Unemployment',
    category: 'labour',
    unit: 'Per cent',
    frequency: 'monthly',
    proxy: false,
    sourceLabel: 'RBA H5',
    sourceUrl: RBA_H5,
    staleAfterDays: 62,
    description: 'Seasonally adjusted unemployment rate from the RBA H5 labour-force table.',
    presets: ['rba_watchlist'],
    collector: { kind: 'rba_csv', url: RBA_H5, seriesId: 'GLFSURSA' },
  },
  {
    id: 'participation_rate',
    label: 'Participation rate',
    shortLabel: 'Participation',
    category: 'labour',
    unit: 'Per cent',
    frequency: 'monthly',
    proxy: false,
    sourceLabel: 'RBA H5',
    sourceUrl: RBA_H5,
    staleAfterDays: 62,
    description: 'Seasonally adjusted labour-force participation rate from the RBA H5 table.',
    presets: [],
    collector: { kind: 'rba_csv', url: RBA_H5, seriesId: 'GLFSPRSA' },
  },
  {
    id: 'trimmed_mean_cpi',
    label: 'Trimmed mean CPI',
    shortLabel: 'Trimmed mean CPI',
    category: 'inflation',
    unit: 'Per cent',
    frequency: 'quarterly',
    proxy: false,
    sourceLabel: 'RBA G1',
    sourceUrl: RBA_G1,
    staleAfterDays: 140,
    description: "Year-ended trimmed mean inflation, the RBA's preferred core CPI measure.",
    presets: ['rba_watchlist'],
    collector: { kind: 'rba_csv', url: RBA_G1, seriesId: 'GCPIOCPMTMYP' },
  },
  {
    id: 'inflation_expectations',
    label: 'Inflation expectations',
    shortLabel: 'Inflation expectations',
    category: 'inflation',
    unit: 'Per cent',
    frequency: 'quarterly',
    proxy: false,
    sourceLabel: 'RBA G3',
    sourceUrl: RBA_G3,
    staleAfterDays: 140,
    description: 'Consumer inflation expectations one year ahead from the RBA G3 survey table.',
    presets: ['rba_watchlist'],
    collector: { kind: 'rba_csv', url: RBA_G3, seriesId: 'GCONEXP' },
  },
  {
    id: 'neutral_rate',
    label: 'Neutral interest rate (R*)',
    shortLabel: 'Neutral rate',
    category: 'inflation',
    unit: 'Per cent',
    frequency: 'quarterly',
    proxy: false,
    sourceLabel: 'RBA J1',
    sourceUrl: RBA_J1,
    staleAfterDays: 180,
    description: 'Median nominal neutral interest rate estimate from the RBA J1 market-economist survey.',
    presets: ['rba_watchlist'],
    collector: { kind: 'rba_csv', url: RBA_J1, seriesId: 'JSVNNIREMED' },
  },
  {
    id: 'bank_bill_90d',
    label: '90-day bank bill yield',
    shortLabel: '90-day bank bill',
    category: 'markets',
    unit: 'Per cent',
    frequency: 'monthly',
    proxy: false,
    sourceLabel: 'RBA F1.1',
    sourceUrl: RBA_F1_1,
    staleAfterDays: 62,
    description: 'RBA F1.1 monthly-average three-month BAB/NCD yield, a maintained money-market proxy for expected policy moves.',
    presets: ['rba_watchlist'],
    collector: { kind: 'rba_csv', url: RBA_F1_1, seriesId: 'FIRMMBAB90' },
  },
  {
    id: 'household_consumption',
    label: 'Household consumption',
    shortLabel: 'Household consumption',
    category: 'demand',
    unit: '$ million',
    frequency: 'quarterly',
    proxy: false,
    sourceLabel: 'RBA H2',
    sourceUrl: RBA_H2,
    staleAfterDays: 140,
    description: 'Quarterly household final consumption expenditure from the RBA H2 demand table.',
    presets: ['housing_transmission'],
    collector: { kind: 'rba_csv', url: RBA_H2, seriesId: 'GGDPECCVPSH' },
  },
  {
    id: 'wage_growth',
    label: 'Wage price index growth',
    shortLabel: 'WPI growth',
    category: 'labour',
    unit: 'Per cent',
    frequency: 'quarterly',
    proxy: false,
    sourceLabel: 'RBA H4',
    sourceUrl: RBA_H4,
    staleAfterDays: 140,
    description: 'Year-ended wage growth from the RBA H4 labour-costs table.',
    presets: ['housing_transmission'],
    collector: { kind: 'rba_csv', url: RBA_H4, seriesId: 'GWPIYP' },
  },
  {
    id: 'housing_credit_growth',
    label: 'Housing credit growth',
    shortLabel: 'Housing credit',
    category: 'housing',
    unit: 'Per cent',
    frequency: 'monthly',
    proxy: false,
    sourceLabel: 'RBA D1',
    sourceUrl: RBA_D1,
    staleAfterDays: 62,
    description: 'Twelve-month housing-credit growth from the RBA D1 financial-aggregates table.',
    presets: ['housing_transmission'],
    collector: { kind: 'rba_csv', url: RBA_D1, seriesId: 'DGFACH12' },
  },
  {
    id: 'dwelling_approvals',
    label: 'Dwelling approvals',
    shortLabel: 'Dwelling approvals',
    category: 'housing',
    unit: "'000",
    frequency: 'monthly',
    proxy: false,
    sourceLabel: 'RBA H3',
    sourceUrl: RBA_H3,
    staleAfterDays: 62,
    description: 'Private dwelling approvals from the RBA H3 monthly-activity table.',
    presets: [],
    collector: { kind: 'rba_csv', url: RBA_H3, seriesId: 'GISPSDA' },
  },
  {
    id: 'rbnz_ocr',
    label: 'RBNZ official cash rate',
    shortLabel: 'RBNZ OCR',
    category: 'global',
    unit: 'Per cent',
    frequency: 'policy',
    proxy: false,
    sourceLabel: 'RBNZ decisions',
    sourceUrl: RBNZ_DECISIONS,
    staleAfterDays: 180,
    description: 'Official Cash Rate decisions from the Reserve Bank of New Zealand policy-decision history.',
    presets: ['global_pulse'],
    collector: { kind: 'rbnz_ocr_history', url: RBNZ_DECISIONS, transportUrl: RBNZ_DECISIONS_TRANSPORT },
  },
  {
    id: 'major_bank_lending_rates',
    label: 'Major bank lending rates proxy',
    shortLabel: 'Lending rates proxy',
    category: 'housing',
    unit: 'Per cent per annum',
    frequency: 'monthly',
    proxy: true,
    sourceLabel: 'RBA F5 + F7',
    sourceUrl: RBA,
    staleAfterDays: 62,
    description: 'Composite proxy averaging major-bank housing and small-business lending rates from RBA F5 and F7.',
    presets: ['housing_transmission'],
    collector: {
      kind: 'rba_lending_proxy',
      housingUrl: RBA_F5,
      housingSeriesId: 'FILRHLBVD',
      businessUrl: RBA_F7,
      businessSeriesId: 'FLRBFOSBT',
    },
  },
  {
    id: 'major_trading_partner_growth_proxy',
    label: 'China GDP growth proxy',
    shortLabel: 'China GDP proxy',
    category: 'global',
    unit: 'Per cent',
    frequency: 'annual',
    proxy: true,
    sourceLabel: 'OECD via FRED',
    sourceUrl: FRED_CHINA_GDP,
    staleAfterDays: 420,
    description: 'Annual China GDP growth proxy from the OECD MEI feed delivered via FRED.',
    presets: ['global_pulse'],
    collector: {
      kind: 'fred_csv',
      url: FRED_CHINA_GDP,
      valueMode: 'identity',
    },
  },
  {
    id: 'capacity_utilisation_proxy',
    label: 'Capacity utilisation proxy',
    shortLabel: 'Capacity proxy',
    category: 'labour',
    unit: 'Per cent',
    frequency: 'quarterly',
    proxy: true,
    sourceLabel: 'RBA J1',
    sourceUrl: RBA_J1,
    staleAfterDays: 180,
    description: 'Output-gap median from the RBA J1 survey, used as a public capacity-pressure proxy.',
    presets: [],
    collector: { kind: 'rba_csv', url: RBA_J1, seriesId: 'JSVOGMED' },
  },
  {
    id: 'aud_twi',
    label: 'AUD trade-weighted index',
    shortLabel: 'AUD TWI',
    category: 'markets',
    unit: 'Index',
    frequency: 'monthly',
    proxy: false,
    sourceLabel: 'RBA F11',
    sourceUrl: RBA_F11,
    staleAfterDays: 62,
    description: 'Australian dollar trade-weighted index from the RBA F11 exchange-rate table.',
    presets: ['global_pulse'],
    collector: { kind: 'rba_csv', url: RBA_F11, seriesId: 'FXRTWI' },
  },
  {
    id: 'business_conditions',
    label: 'Business conditions',
    shortLabel: 'Business conditions',
    category: 'demand',
    unit: 'Percentage points',
    frequency: 'monthly',
    proxy: false,
    sourceLabel: 'RBA H3',
    sourceUrl: RBA_H3,
    staleAfterDays: 62,
    description: 'NAB business-conditions index as carried in the RBA H3 activity table.',
    presets: [],
    collector: { kind: 'rba_csv', url: RBA_H3, seriesId: 'GICNBC' },
  },
  {
    id: 'consumer_sentiment',
    label: 'Consumer sentiment',
    shortLabel: 'Consumer sentiment',
    category: 'demand',
    unit: 'Index',
    frequency: 'monthly',
    proxy: false,
    sourceLabel: 'RBA H3',
    sourceUrl: RBA_H3,
    staleAfterDays: 62,
    description: 'Westpac-Melbourne Institute consumer-sentiment index from the RBA H3 table.',
    presets: ['housing_transmission'],
    collector: { kind: 'rba_csv', url: RBA_H3, seriesId: 'GICWMICS' },
  },
  {
    id: 'public_demand',
    label: 'Public demand',
    shortLabel: 'Public demand',
    category: 'demand',
    unit: '$ million',
    frequency: 'quarterly',
    proxy: false,
    sourceLabel: 'RBA H2',
    sourceUrl: RBA_H2,
    staleAfterDays: 140,
    description: 'Quarterly public demand from the RBA H2 demand-and-income table.',
    presets: [],
    collector: { kind: 'rba_csv', url: RBA_H2, seriesId: 'GGDPECCVPD' },
  },
  {
    id: 'commodity_prices',
    label: 'Bulk commodity prices',
    shortLabel: 'Commodity prices',
    category: 'global',
    unit: 'Index',
    frequency: 'monthly',
    proxy: false,
    sourceLabel: 'RBA I2',
    sourceUrl: RBA_I2,
    staleAfterDays: 62,
    description: 'RBA I2 bulk-commodity price index in SDR terms.',
    presets: ['global_pulse'],
    collector: { kind: 'rba_csv', url: RBA_I2, seriesId: 'GRCPBCSDR' },
  },
  {
    id: 'fed_funds_proxy',
    label: 'Fed funds target proxy',
    shortLabel: 'Fed funds proxy',
    category: 'global',
    unit: 'Per cent',
    frequency: 'policy',
    proxy: true,
    sourceLabel: 'Federal Reserve open market',
    sourceUrl: FED_OPEN_MARKET,
    staleAfterDays: 180,
    description: 'Midpoint of the FOMC federal-funds target range, parsed from the Federal Reserve open-market history page.',
    presets: ['global_pulse'],
    collector: { kind: 'fed_target_history', url: FED_OPEN_MARKET, transportUrl: FED_OPEN_MARKET_TRANSPORT },
  },
]

export type EconomicSeriesId = (typeof ECONOMIC_SERIES_DEFINITIONS)[number]['id']

const DEFINITIONS_BY_ID = new Map<string, EconomicSeriesDefinition>(
  ECONOMIC_SERIES_DEFINITIONS.map((definition) => [definition.id, definition]),
)

export function getEconomicSeriesDefinition(id: string): EconomicSeriesDefinition | undefined {
  return DEFINITIONS_BY_ID.get(id)
}

export function getEconomicPreset(id: string) {
  return ECONOMIC_PRESETS.find((preset) => preset.id === id)
}

export function economicCategoryLabel(category: EconomicCategory): string {
  switch (category) {
    case 'labour':
      return 'Labour market'
    case 'inflation':
      return 'Inflation and expectations'
    case 'demand':
      return 'Demand and confidence'
    case 'housing':
      return 'Housing and credit'
    case 'markets':
      return 'Market rates and FX'
    case 'global':
      return 'Global context'
  }
}

export function groupEconomicSeriesByCategory() {
  return ['labour', 'inflation', 'demand', 'housing', 'markets', 'global'].map((category) => ({
    id: category,
    label: economicCategoryLabel(category as EconomicCategory),
    series: ECONOMIC_SERIES_DEFINITIONS.filter((definition) => definition.category === category),
  }))
}
