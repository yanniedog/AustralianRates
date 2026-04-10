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

/** Public Rate Report ribbon (ECharts bands mode) appearance; exposed via GET /site-ui. */
export type ChartRibbonStyle = {
  edge_width: number
  edge_opacity: number
  edge_opacity_others: number
  fill_opacity_end: number
  fill_opacity_peak: number
  focus_fill_opacity_end: number
  focus_fill_opacity_peak: number
  selected_fill_opacity_end: number
  selected_fill_opacity_peak: number
  fill_opacity_others_scale: number
  mean_width: number
  mean_opacity: number
  mean_opacity_others: number
  product_line_opacity_hover: number
  product_line_opacity_selected: number
  product_line_width_hover: number
  product_line_width_selected: number
  others_grey_mix: number
  active_z: number
  inactive_z: number
}

export const DEFAULT_CHART_RIBBON_STYLE: ChartRibbonStyle = {
  edge_width: 2,
  edge_opacity: 1,
  edge_opacity_others: 0.14,
  fill_opacity_end: 0.22,
  fill_opacity_peak: 0.48,
  focus_fill_opacity_end: 0.34,
  focus_fill_opacity_peak: 0.70,
  selected_fill_opacity_end: 0.44,
  selected_fill_opacity_peak: 0.82,
  fill_opacity_others_scale: 0.22,
  mean_width: 1.25,
  mean_opacity: 1,
  mean_opacity_others: 0.18,
  product_line_opacity_hover: 0.5,
  product_line_opacity_selected: 0.85,
  product_line_width_hover: 1.2,
  product_line_width_selected: 2.5,
  others_grey_mix: 0.62,
  active_z: 48,
  inactive_z: 2,
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Accepts finite numbers and numeric strings (e.g. hand-edited JSON in app_config). */
function numLike(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    const n = Number(t)
    if (Number.isFinite(n)) return n
  }
  return null
}

function num01(v: unknown, fallback: number): number {
  const n = numLike(v)
  if (n === null) return fallback
  return clamp(n, 0, 1)
}

function numNonNeg(v: unknown, fallback: number, hi: number): number {
  const n = numLike(v)
  if (n === null) return fallback
  return clamp(n, 0, hi)
}

export function mergeChartRibbonStylePartial(raw: Record<string, unknown> | null | undefined): ChartRibbonStyle {
  const d = DEFAULT_CHART_RIBBON_STYLE
  if (!raw || typeof raw !== 'object') return { ...d }
  let active_z = numNonNeg(raw.active_z, d.active_z, 120)
  let inactive_z = numNonNeg(raw.inactive_z, d.inactive_z, 80)
  if (inactive_z >= active_z) {
    inactive_z = Math.max(0, active_z - 1)
  }
  return {
    edge_width: numNonNeg(raw.edge_width, d.edge_width, 12),
    edge_opacity: num01(raw.edge_opacity, d.edge_opacity),
    edge_opacity_others: num01(raw.edge_opacity_others, d.edge_opacity_others),
    fill_opacity_end: num01(raw.fill_opacity_end, d.fill_opacity_end),
    fill_opacity_peak: num01(raw.fill_opacity_peak, d.fill_opacity_peak),
    focus_fill_opacity_end: num01(raw.focus_fill_opacity_end, d.focus_fill_opacity_end),
    focus_fill_opacity_peak: num01(raw.focus_fill_opacity_peak, d.focus_fill_opacity_peak),
    selected_fill_opacity_end: num01(raw.selected_fill_opacity_end, d.selected_fill_opacity_end),
    selected_fill_opacity_peak: num01(raw.selected_fill_opacity_peak, d.selected_fill_opacity_peak),
    fill_opacity_others_scale: num01(raw.fill_opacity_others_scale, d.fill_opacity_others_scale),
    mean_width: numNonNeg(raw.mean_width, d.mean_width, 8),
    mean_opacity: num01(raw.mean_opacity, d.mean_opacity),
    mean_opacity_others: num01(raw.mean_opacity_others, d.mean_opacity_others),
    product_line_opacity_hover: num01(raw.product_line_opacity_hover, d.product_line_opacity_hover),
    product_line_opacity_selected: num01(raw.product_line_opacity_selected, d.product_line_opacity_selected),
    product_line_width_hover: numNonNeg(raw.product_line_width_hover, d.product_line_width_hover, 6),
    product_line_width_selected: numNonNeg(raw.product_line_width_selected, d.product_line_width_selected, 8),
    others_grey_mix: num01(raw.others_grey_mix, d.others_grey_mix),
    active_z,
    inactive_z,
  }
}

export function resolveChartRibbonStyleFromDb(raw: string | null): ChartRibbonStyle {
  if (raw == null || String(raw).trim() === '') return { ...DEFAULT_CHART_RIBBON_STYLE }
  try {
    const parsed = JSON.parse(String(raw)) as unknown
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CHART_RIBBON_STYLE }
    return mergeChartRibbonStylePartial(parsed as Record<string, unknown>)
  } catch {
    return { ...DEFAULT_CHART_RIBBON_STYLE }
  }
}

export function normalizeChartRibbonStyleForPut(
  raw: unknown,
  keyLabel = 'chart_ribbon_style',
): { ok: true; value: string } | { ok: false; error: string } {
  if (raw == null || (typeof raw === 'string' && String(raw).trim() === '')) {
    return { ok: false, error: `${keyLabel}: provide a JSON object (use Reset in admin for defaults).` }
  }
  let obj: unknown
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as unknown
    } catch {
      return { ok: false, error: `${labelText(keyLabel)} must be valid JSON.` }
    }
  } else {
    obj = raw
  }
  if (!obj || typeof obj !== 'object') {
    return { ok: false, error: `${labelText(keyLabel)} must be a JSON object.` }
  }
  const merged = mergeChartRibbonStylePartial(obj as Record<string, unknown>)
  return { ok: true, value: JSON.stringify(merged) }
}
