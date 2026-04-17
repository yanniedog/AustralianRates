/**
 * Ports `buildSurfaceModel` from `site/ar-chart-data.js`.
 *
 * Produces the flat ECharts-ready shape the compare-tab heatmap consumes:
 *   - `xLabels` = sorted unique dates across all series
 *   - `yLabels` = per-series axis labels
 *   - `cells`   = flat list of `{value: [xIndex, yIndex, metric], seriesKey, row, date}`
 *   - `min` / `max` = metric range across the visible grid.
 */

import type { ChartRow, SeriesEntry } from './series-collection'
import { compareDates } from './series-collection'

export type SurfaceCell = {
  value: [number, number, number]
  seriesKey: string
  row: ChartRow
  date: string
}

export type SurfaceModel = {
  xLabels: string[]
  yLabels: string[]
  cells: SurfaceCell[]
  min: number | null
  max: number | null
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function uniqueDates(seriesList: SeriesEntry[]): string[] {
  const seen = new Set<string>()
  for (const series of seriesList) {
    for (const point of series.points) {
      if (point.date) seen.add(point.date)
    }
  }
  return Array.from(seen).sort(compareDates)
}

export function buildSurfaceModel(seriesList: SeriesEntry[]): SurfaceModel {
  const xLabels = uniqueDates(seriesList)
  const resolvedLabels = xLabels.length ? xLabels : [todayYmd()]
  const indexByDate = new Map<string, number>()
  resolvedLabels.forEach((label, index) => indexByDate.set(label, index))

  const cells: SurfaceCell[] = []
  let min: number | null = null
  let max: number | null = null

  seriesList.forEach((series, rowIndex) => {
    const byDate = new Map<string, { value: number; row: ChartRow }>()
    for (const point of series.points) {
      byDate.set(point.date, { value: point.value, row: point.row })
    }
    for (const [dateKey, point] of byDate) {
      if (!Number.isFinite(point.value)) continue
      const xIndex = indexByDate.get(dateKey)
      if (xIndex == null) continue
      if (min == null || point.value < min) min = point.value
      if (max == null || point.value > max) max = point.value
      cells.push({
        value: [xIndex, rowIndex, point.value],
        seriesKey: series.key,
        row: point.row,
        date: dateKey,
      })
    }
  })

  if (min != null && max != null && min === max) max = min + 1

  return {
    xLabels: resolvedLabels,
    yLabels: seriesList.map((series) => series.axisLabel || series.name),
    cells,
    min,
    max,
  }
}
