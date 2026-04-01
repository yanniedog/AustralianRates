import type { HistoricalQualityDailyRow } from './historical-quality-types'
import type { HistoricalQualityDailySummary } from './historical-quality-daily-summary'

type DailyMetricsJson = Record<string, unknown> & {
  previous_date?: string | null
  next_date?: string | null
  weighted_affected_series_v1?: number
  weighted_rate_flow_flags_v1?: number
  daily_summary?: HistoricalQualityDailySummary
}

function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw || '{}') as T
  } catch {
    return {} as T
  }
}

export function attachHistoricalQualityDailySummary(
  row: HistoricalQualityDailyRow,
  summary: HistoricalQualityDailySummary,
): HistoricalQualityDailyRow {
  const metrics = parseJson<DailyMetricsJson>(row.metrics_json)
  return {
    ...row,
    metrics_json: JSON.stringify({
      ...metrics,
      daily_summary: summary,
    }),
  }
}

export function readHistoricalQualityDailySummary(row: Pick<HistoricalQualityDailyRow, 'metrics_json'>): HistoricalQualityDailySummary | null {
  const metrics = parseJson<DailyMetricsJson>(row.metrics_json)
  const summary = metrics.daily_summary
  if (!summary || typeof summary !== 'object') return null
  return summary
}
