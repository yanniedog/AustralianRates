import {
  CHART_LEGEND_OPACITY_MAX,
  CHART_LEGEND_OPACITY_MIN,
  CHART_LEGEND_TEXT_BRIGHTNESS_MAX,
  CHART_LEGEND_TEXT_BRIGHTNESS_MIN,
  CHART_MAX_PRODUCTS_KEY,
  CHART_MAX_PRODUCTS_MAX,
  CHART_MAX_PRODUCTS_MIN,
  CHART_MAX_PRODUCTS_UNLIMITED,
  DEFAULT_CHART_LEGEND_OPACITY,
  DEFAULT_CHART_LEGEND_TEXT_BRIGHTNESS,
} from '../constants'

export type ChartLegendOpacitySet = {
  desktop: number
  mobile: number
}

export type ChartLegendTextBrightnessSet = {
  desktop: number
  mobile: number
}

export type ChartProductLimit = number | null
export type ChartProductLimitMode = 'default' | 'capped' | 'unlimited'

function clampChartLegendOpacity(opacity: number): number {
  return Math.min(CHART_LEGEND_OPACITY_MAX, Math.max(CHART_LEGEND_OPACITY_MIN, opacity))
}

function clampChartLegendTextBrightness(brightness: number): number {
  return Math.min(CHART_LEGEND_TEXT_BRIGHTNESS_MAX, Math.max(CHART_LEGEND_TEXT_BRIGHTNESS_MIN, brightness))
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

export function resolveChartLegendTextBrightnessFromDb(raw: string | null): number {
  if (raw == null || String(raw).trim() === '') return DEFAULT_CHART_LEGEND_TEXT_BRIGHTNESS
  const parsed = Number(String(raw).trim())
  if (!Number.isFinite(parsed)) return DEFAULT_CHART_LEGEND_TEXT_BRIGHTNESS
  if (parsed > 100) return DEFAULT_CHART_LEGEND_TEXT_BRIGHTNESS
  return clampChartLegendTextBrightness(parsed > 2 ? parsed / 100 : parsed)
}

export function resolveChartLegendTextBrightnessSetFromDb(input: {
  desktopRaw: string | null
  mobileRaw: string | null
  legacyRaw?: string | null
}): ChartLegendTextBrightnessSet {
  const fallback = resolveChartLegendTextBrightnessFromDb(input.legacyRaw ?? null)
  return {
    desktop:
      input.desktopRaw == null || String(input.desktopRaw).trim() === ''
        ? fallback
        : resolveChartLegendTextBrightnessFromDb(input.desktopRaw),
    mobile:
      input.mobileRaw == null || String(input.mobileRaw).trim() === ''
        ? fallback
        : resolveChartLegendTextBrightnessFromDb(input.mobileRaw),
  }
}

export function normalizeChartLegendTextBrightnessForPut(
  raw: unknown,
  keyLabel = 'chart_legend_text_brightness',
): { ok: true; value: string } | { ok: false; error: string } {
  const text = String(raw ?? '')
    .trim()
    .replace(/%$/u, '')
  if (!text) {
    return {
      ok: false,
      error:
        `${keyLabel}: enter ${CHART_LEGEND_TEXT_BRIGHTNESS_MIN * 100}%-${CHART_LEGEND_TEXT_BRIGHTNESS_MAX * 100}%` +
        ` or ${CHART_LEGEND_TEXT_BRIGHTNESS_MIN}-${CHART_LEGEND_TEXT_BRIGHTNESS_MAX}.`,
    }
  }
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `${labelText(keyLabel)} must be a number.` }
  }
  if (parsed > 1000) {
    return { ok: false, error: `${labelText(keyLabel)} cannot exceed 1000%.` }
  }
  const brightness = parsed > 2 ? parsed / 100 : parsed
  if (brightness < CHART_LEGEND_TEXT_BRIGHTNESS_MIN || brightness > CHART_LEGEND_TEXT_BRIGHTNESS_MAX) {
    return {
      ok: false,
      error:
        `${labelText(keyLabel)} must be between ${CHART_LEGEND_TEXT_BRIGHTNESS_MIN * 100}%` +
        ` and ${CHART_LEGEND_TEXT_BRIGHTNESS_MAX * 100}%.`,
    }
  }
  return { ok: true, value: clampChartLegendTextBrightness(brightness).toFixed(2) }
}

export function resolveChartMaxProductsFromDb(raw: string | null): ChartProductLimit {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text || text === CHART_MAX_PRODUCTS_UNLIMITED) return null
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || parsed < CHART_MAX_PRODUCTS_MIN) return null
  return Math.min(CHART_MAX_PRODUCTS_MAX, Math.floor(parsed))
}

export function resolveChartMaxProductsModeFromDb(raw: string | null): ChartProductLimitMode {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return 'default'
  if (text === CHART_MAX_PRODUCTS_UNLIMITED) return 'unlimited'
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || parsed < CHART_MAX_PRODUCTS_MIN) return 'default'
  return 'capped'
}

export function normalizeChartMaxProductsForPut(
  raw: unknown,
  keyLabel = CHART_MAX_PRODUCTS_KEY,
): { ok: true; value: string } | { ok: false; error: string } {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) {
    return {
      ok: false,
      error: `${labelText(keyLabel)} must be ${CHART_MAX_PRODUCTS_MIN}-${CHART_MAX_PRODUCTS_MAX} or "${CHART_MAX_PRODUCTS_UNLIMITED}".`,
    }
  }
  if (text === CHART_MAX_PRODUCTS_UNLIMITED) {
    return { ok: true, value: CHART_MAX_PRODUCTS_UNLIMITED }
  }
  if (!/^\d+$/.test(text)) {
    return { ok: false, error: `${labelText(keyLabel)} must be a whole number or "${CHART_MAX_PRODUCTS_UNLIMITED}".` }
  }
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || parsed < CHART_MAX_PRODUCTS_MIN || parsed > CHART_MAX_PRODUCTS_MAX) {
    return {
      ok: false,
      error: `${labelText(keyLabel)} must be between ${CHART_MAX_PRODUCTS_MIN} and ${CHART_MAX_PRODUCTS_MAX}, or "${CHART_MAX_PRODUCTS_UNLIMITED}".`,
    }
  }
  return { ok: true, value: String(Math.floor(parsed)) }
}
