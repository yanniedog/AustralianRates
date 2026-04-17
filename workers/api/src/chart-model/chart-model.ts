/**
 * Server-side port of the Worker-buildable subset of `buildChartModel`
 * (see `site/ar-chart-data.js`). Produces the stable sub-models the client's
 * compare-tab rendering needs so the browser can skip the heavy aggregation
 * when snapshot state matches the request.
 *
 * What is ported:
 *   - series-collection (grouped by product identity, finalised, sorted by metric)
 *   - surface (ECharts heatmap grid)
 *   - lenderRanking
 *   - distribution
 *
 * What is NOT ported here (kept on the client for now):
 *   - market-model (line / ribbon / box / TD-specific branches) - heavily
 *     section-specific, uses DOM-coupled helpers; best handled in a follow-up.
 *   - ribbon-tree (tier hierarchy for the report view's tooltip panel) -
 *     the primary rate-report already renders from server-computed
 *     `reportPlotBands`; the hierarchy is only needed for hover panels and
 *     can be lazily computed client-side.
 */

import { buildSeriesCollection, type ChartRow, type SeriesEntry } from './series-collection'
import { buildSurfaceModel, type SurfaceModel } from './surface'
import { buildLenderRanking, type LenderRankingModel, type LenderRankingEntry } from './lender-ranking'
import { buildDistributionModel, type DistributionModel } from './distribution'
import { parseDensity, type ChartSection, type DensityResolved, defaultFieldsFor } from './config'

export type ChartModelFields = {
  xField: string
  yField: string
  groupField?: string
  density?: string
  view?: string
}

export type ChartModelPayload = {
  meta: {
    section: ChartSection
    fields: ChartModelFields & { density: string; view: string }
    totalRows: number
    totalSeries: number
    visibleSeries: number
    visibleLenders: number
    totalLenders: number
    densityLabel: string
    renderedCells: number
  }
  lenderRanking: {
    direction: LenderRankingModel['direction']
    totalBanks: number
    entries: LenderRankingEntry[]
    min: number | null
    max: number | null
  }
  /** Visible series metadata only (no `points` array - that lives in analyticsSeries). */
  visibleSeriesMeta: Array<{
    key: string
    name: string
    axisLabel: string
    subtitle: string
    bankName: string
    productName: string
    latestDate: string
    latestValue: number | null
    delta: number | null
    pointCount: number
    colorIndex: number
  }>
  surface: SurfaceModel
  distribution: DistributionModel
}

/** Strip `points` / `latestRow` from a series entry so the snapshot payload only carries summary fields. */
function seriesMeta(series: SeriesEntry): ChartModelPayload['visibleSeriesMeta'][number] {
  return {
    key: series.key,
    name: series.name,
    axisLabel: series.axisLabel,
    subtitle: series.subtitle,
    bankName: series.bankName,
    productName: series.productName,
    latestDate: series.latestDate,
    latestValue: series.latestValue,
    delta: series.delta,
    pointCount: series.pointCount,
    colorIndex: series.colorIndex ?? 0,
  }
}

/** Strip the heavy row reference from cells so repeats don't bloat the payload. */
function compactCells(surface: SurfaceModel): SurfaceModel {
  return {
    xLabels: surface.xLabels,
    yLabels: surface.yLabels,
    cells: surface.cells.map((cell) => ({ value: cell.value, seriesKey: cell.seriesKey, row: {}, date: cell.date })),
    min: surface.min,
    max: surface.max,
  }
}

/** Strip heavy fields from lender-ranking entries. */
function compactEntries(entries: LenderRankingEntry[]): LenderRankingEntry[] {
  return entries.map((entry) => ({
    key: entry.key,
    bankName: entry.bankName,
    seriesKey: entry.seriesKey,
    productName: entry.productName,
    subtitle: entry.subtitle,
    latestDate: entry.latestDate,
    value: entry.value,
    delta: entry.delta,
    pointCount: entry.pointCount,
    rank: entry.rank,
  }))
}

/** Apply the default density's row limit + color-index assignment (no spotlight / selection on server). */
function defaultVisibleSeries(allSeries: SeriesEntry[], density: DensityResolved): SeriesEntry[] {
  const limited = allSeries.slice(0, density.rowLimit)
  return limited.map((series, index) => ({ ...series, colorIndex: index }))
}

export type BuildDefaultChartModelOptions = {
  section: ChartSection
  rows: ChartRow[]
  /** Optional override for fields. Defaults to `defaultFieldsFor(section)`. */
  fields?: Partial<ChartModelFields>
  /** Admin-configured hard cap; defaults to no cap. */
  chartMaxProducts?: number | null
  chartMaxProductsMode?: string | null
}

/** Produce the server-side chart model for the default (no-spotlight, no-selection) view. */
export function buildDefaultChartModel(options: BuildDefaultChartModelOptions): ChartModelPayload {
  const { section, rows } = options
  const defaults = defaultFieldsFor(section)
  const fields: ChartModelFields = {
    xField: options.fields?.xField || defaults.xField,
    yField: options.fields?.yField || defaults.yField,
    groupField: options.fields?.groupField || defaults.groupField,
    density: options.fields?.density || defaults.density,
    view: options.fields?.view || defaults.view,
  }
  const density = parseDensity(fields.density, options.chartMaxProducts ?? null, options.chartMaxProductsMode ?? null)

  const allSeries = buildSeriesCollection(rows, fields.yField, section)
  const visibleSeries = defaultVisibleSeries(allSeries, density)
  const lenderRanking = buildLenderRanking(allSeries, { yField: fields.yField }, density, section)
  const surface = compactCells(buildSurfaceModel(visibleSeries))
  const distribution = buildDistributionModel(rows, { yField: fields.yField, groupField: fields.groupField }, section)
  const renderedCells = visibleSeries.reduce((sum, series) => sum + series.pointCount, 0)

  return {
    meta: {
      section,
      fields: { ...fields, density: fields.density ?? 'standard', view: fields.view ?? defaults.view },
      totalRows: rows.length,
      totalSeries: allSeries.length,
      visibleSeries: visibleSeries.length,
      visibleLenders: lenderRanking.entries.length,
      totalLenders: lenderRanking.totalBanks,
      densityLabel: density.label,
      renderedCells,
    },
    lenderRanking: {
      direction: lenderRanking.direction,
      totalBanks: lenderRanking.totalBanks,
      entries: compactEntries(lenderRanking.entries),
      min: lenderRanking.min,
      max: lenderRanking.max,
    },
    visibleSeriesMeta: visibleSeries.map(seriesMeta),
    surface,
    distribution,
  }
}
