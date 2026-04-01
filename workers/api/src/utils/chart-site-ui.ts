import {
  CHART_LEGEND_OPACITY_MAX,
  CHART_LEGEND_OPACITY_MIN,
  DEFAULT_CHART_LEGEND_OPACITY,
} from '../constants'

export type ChartLegendOpacitySet = {
  desktop: number
  mobile: number
}

function clampChartLegendOpacity(opacity: number): number {
  return Math.min(CHART_LEGEND_OPACITY_MAX, Math.max(CHART_LEGEND_OPACITY_MIN, opacity))
}

function labelText(label: string): string {
  return label.replace(/_/g, ' ')
}

export function resolveChartLegendOpacityFromDb(raw: string | null): number {
  if (raw == null || String(raw).trim() === '') return DEFAULT_CHART_LEGEND_OPACITY
  const parsed = Number(String(raw).trim())
  if (!Number.isFinite(parsed)) return DEFAULT_CHART_LEGEND_OPACITY
  if (parsed > 100) return DEFAULT_CHART_LEGEND_OPACITY
  return clampChartLegendOpacity(parsed > 1 ? parsed / 100 : parsed)
}

export function resolveChartLegendOpacitySetFromDb(input: {
  desktopRaw: string | null
  mobileRaw: string | null
  legacyRaw?: string | null
}): ChartLegendOpacitySet {
  const fallback = resolveChartLegendOpacityFromDb(input.legacyRaw ?? null)
  return {
    desktop:
      input.desktopRaw == null || String(input.desktopRaw).trim() === ''
        ? fallback
        : resolveChartLegendOpacityFromDb(input.desktopRaw),
    mobile:
      input.mobileRaw == null || String(input.mobileRaw).trim() === ''
        ? fallback
        : resolveChartLegendOpacityFromDb(input.mobileRaw),
  }
}

export function normalizeChartLegendOpacityForPut(
  raw: unknown,
  keyLabel = 'chart_legend_opacity',
): { ok: true; value: string } | { ok: false; error: string } {
  const text = String(raw ?? '')
    .trim()
    .replace(/%$/u, '')
  if (!text) {
    return {
      ok: false,
      error: `${keyLabel}: enter ${CHART_LEGEND_OPACITY_MIN * 100}%-100% (e.g. 75) or 0.05-1.`,
    }
  }
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `${labelText(keyLabel)} must be a number.` }
  }
  if (parsed > 100) {
    return { ok: false, error: `${labelText(keyLabel)} cannot exceed 100%.` }
  }
  const opacity = parsed > 1 ? parsed / 100 : parsed
  if (opacity < CHART_LEGEND_OPACITY_MIN || opacity > CHART_LEGEND_OPACITY_MAX) {
    return {
      ok: false,
      error: `${labelText(keyLabel)} must be between ${CHART_LEGEND_OPACITY_MIN * 100}% and 100%.`,
    }
  }
  return { ok: true, value: clampChartLegendOpacity(opacity).toFixed(2) }
}
