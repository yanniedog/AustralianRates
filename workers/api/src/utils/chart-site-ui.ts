import {
  CHART_LEGEND_OPACITY_MAX,
  CHART_LEGEND_OPACITY_MIN,
  DEFAULT_CHART_LEGEND_OPACITY,
} from '../constants'

export function resolveChartLegendOpacityFromDb(raw: string | null): number {
  if (raw == null || String(raw).trim() === '') return DEFAULT_CHART_LEGEND_OPACITY
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n)) return DEFAULT_CHART_LEGEND_OPACITY
  if (n > 100) return DEFAULT_CHART_LEGEND_OPACITY
  const o = n > 1 ? n / 100 : n
  return clampChartLegendOpacity(o)
}

export function normalizeChartLegendOpacityForPut(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  const text = String(raw ?? '')
    .trim()
    .replace(/%$/u, '')
  if (!text) {
    return {
      ok: false,
      error: `chart_legend_opacity: enter ${CHART_LEGEND_OPACITY_MIN * 100}%–100% (e.g. 75) or 0.05–1.`,
    }
  }
  const n = Number(text)
  if (!Number.isFinite(n)) {
    return { ok: false, error: 'chart_legend_opacity must be a number.' }
  }
  if (n > 100) {
    return { ok: false, error: 'chart_legend_opacity cannot exceed 100%.' }
  }
  const o = n > 1 ? n / 100 : n
  if (o < CHART_LEGEND_OPACITY_MIN || o > CHART_LEGEND_OPACITY_MAX) {
    return {
      ok: false,
      error: `chart_legend_opacity must be between ${CHART_LEGEND_OPACITY_MIN * 100}% and 100%.`,
    }
  }
  return { ok: true, value: clampChartLegendOpacity(o).toFixed(2) }
}

function clampChartLegendOpacity(o: number): number {
  return Math.min(CHART_LEGEND_OPACITY_MAX, Math.max(CHART_LEGEND_OPACITY_MIN, o))
}
