import type { ChartCacheSection } from './chart-cache'

export type ReportPlotSection = ChartCacheSection
export type ReportPlotMode = 'moves' | 'bands'

export type ReportPlotMeta = {
  section: ReportPlotSection
  mode: ReportPlotMode
  start_date: string
  end_date: string
  chart_window: string | null
  resolved_term_months: number | null
  band_source_version?: number
}

export type ReportMovesPoint = {
  date: string
  up_count: number
  flat_count: number
  down_count: number
}

export type ReportBandPoint = {
  date: string
  min_rate: number
  max_rate: number
  mean_rate: number
}

export type ReportBandSeries = {
  bank_name: string
  color_key: string
  points: ReportBandPoint[]
}

export type ReportMovesPayload = {
  mode: 'moves'
  meta: ReportPlotMeta
  points: ReportMovesPoint[]
}

export type ReportBandsPayload = {
  mode: 'bands'
  meta: ReportPlotMeta
  series: ReportBandSeries[]
}

export type ReportPlotPayload = ReportMovesPayload | ReportBandsPayload
