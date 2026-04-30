import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHART_RIBBON_STYLE,
  mergeChartRibbonStylePartial,
  normalizeChartLegendOpacityForPut,
  normalizeChartMaxProductsForPut,
  normalizeChartRibbonStyleForPut,
  resolveChartLegendOpacityFromDb,
  resolveChartLegendOpacitySetFromDb,
  resolveChartMaxProductsFromDb,
  resolveChartMaxProductsModeFromDb,
  resolveChartRibbonStyleFromDb,
} from '../src/utils/chart-site-ui'

describe('chart-site-ui', () => {
  it('resolveChartLegendOpacityFromDb defaults and clamps', () => {
    expect(resolveChartLegendOpacityFromDb(null)).toBe(0.75)
    expect(resolveChartLegendOpacityFromDb('')).toBe(0.75)
    expect(resolveChartLegendOpacityFromDb('0.75')).toBe(0.75)
    expect(resolveChartLegendOpacityFromDb('75')).toBe(0.75)
    expect(resolveChartLegendOpacityFromDb('50')).toBe(0.5)
    expect(resolveChartLegendOpacityFromDb('5')).toBe(0.05)
    expect(resolveChartLegendOpacityFromDb('not')).toBe(0.75)
    expect(resolveChartLegendOpacityFromDb('101')).toBe(0.75)
  })

  it('normalizeChartLegendOpacityForPut accepts percent and decimal', () => {
    expect(normalizeChartLegendOpacityForPut('80')).toEqual({ ok: true, value: '0.80' })
    expect(normalizeChartLegendOpacityForPut('80%')).toEqual({ ok: true, value: '0.80' })
    expect(normalizeChartLegendOpacityForPut('0.8')).toEqual({ ok: true, value: '0.80' })
    expect(normalizeChartLegendOpacityForPut('5')).toEqual({ ok: true, value: '0.05' })
    expect(normalizeChartLegendOpacityForPut('1')).toEqual({ ok: true, value: '1.00' })
    expect(normalizeChartLegendOpacityForPut('5')).toEqual({ ok: true, value: '0.05' })
    expect(normalizeChartLegendOpacityForPut('101').ok).toBe(false)
    expect(normalizeChartLegendOpacityForPut('0.04').ok).toBe(false)
  })

  it('resolveChartLegendOpacitySetFromDb uses desktop and mobile overrides with legacy fallback', () => {
    expect(
      resolveChartLegendOpacitySetFromDb({
        desktopRaw: '0.85',
        mobileRaw: '0.55',
        legacyRaw: '0.70',
      }),
    ).toEqual({
      desktop: 0.85,
      mobile: 0.55,
    })

    expect(
      resolveChartLegendOpacitySetFromDb({
        desktopRaw: '',
        mobileRaw: null,
        legacyRaw: '0.68',
      }),
    ).toEqual({
      desktop: 0.68,
      mobile: 0.68,
    })
  })

  it('resolves and normalizes chart max products', () => {
    expect(resolveChartMaxProductsFromDb(null)).toBeNull()
    expect(resolveChartMaxProductsFromDb('')).toBeNull()
    expect(resolveChartMaxProductsFromDb('unlimited')).toBeNull()
    expect(resolveChartMaxProductsFromDb('24')).toBe(24)
    expect(resolveChartMaxProductsFromDb('1001')).toBe(1000)
    expect(resolveChartMaxProductsModeFromDb(null)).toBe('default')
    expect(resolveChartMaxProductsModeFromDb('')).toBe('default')
    expect(resolveChartMaxProductsModeFromDb('unlimited')).toBe('unlimited')
    expect(resolveChartMaxProductsModeFromDb('24')).toBe('capped')

    expect(normalizeChartMaxProductsForPut('unlimited')).toEqual({ ok: true, value: 'unlimited' })
    expect(normalizeChartMaxProductsForPut('48')).toEqual({ ok: true, value: '48' })
    expect(normalizeChartMaxProductsForPut('0').ok).toBe(false)
    expect(normalizeChartMaxProductsForPut('1001').ok).toBe(false)
    expect(normalizeChartMaxProductsForPut('abc').ok).toBe(false)
  })

  it('resolves and normalizes chart ribbon style JSON', () => {
    expect(resolveChartRibbonStyleFromDb(null)).toEqual(DEFAULT_CHART_RIBBON_STYLE)
    expect(resolveChartRibbonStyleFromDb('not json')).toEqual(DEFAULT_CHART_RIBBON_STYLE)
    const partial = { edge_width: 0, fill_opacity_peak: 0.99, selected_fill_opacity_peak: 0.88 }
    const merged = mergeChartRibbonStylePartial(partial)
    expect(merged.edge_width).toBe(0)
    expect(merged.fill_opacity_peak).toBe(0.99)
    expect(merged.selected_fill_opacity_peak).toBe(0.88)
    expect(merged.focus_fill_opacity_peak).toBe(DEFAULT_CHART_RIBBON_STYLE.focus_fill_opacity_peak)
    expect(merged.mean_width).toBe(DEFAULT_CHART_RIBBON_STYLE.mean_width)

    const put = normalizeChartRibbonStyleForPut(JSON.stringify(partial))
    expect(put.ok).toBe(true)
    if (put.ok) {
      expect(JSON.parse(put.value).edge_width).toBe(0)
      expect(JSON.parse(put.value).selected_fill_opacity_peak).toBe(0.88)
    }
    expect(normalizeChartRibbonStyleForPut('').ok).toBe(false)
    expect(normalizeChartRibbonStyleForPut('{').ok).toBe(false)
  })

  it('mergeChartRibbonStylePartial coerces numeric strings and fixes inactive_z >= active_z', () => {
    const merged = mergeChartRibbonStylePartial({
      edge_opacity: '0.5',
      active_z: 20,
      inactive_z: 25,
    } as Record<string, unknown>)
    expect(merged.edge_opacity).toBe(0.5)
    expect(merged.active_z).toBe(20)
    expect(merged.inactive_z).toBe(19)
  })

  it('mergeChartRibbonStylePartial accepts known presets and falls back to glass', () => {
    expect(mergeChartRibbonStylePartial({}).preset).toBe('glass')
    expect(mergeChartRibbonStylePartial({ preset: 'classic' } as Record<string, unknown>).preset).toBe('classic')
    expect(mergeChartRibbonStylePartial({ preset: 'GLASS' } as Record<string, unknown>).preset).toBe('glass')
    expect(mergeChartRibbonStylePartial({ preset: 'nope' } as Record<string, unknown>).preset).toBe('glass')
    expect(mergeChartRibbonStylePartial({ preset: 42 } as Record<string, unknown>).preset).toBe('glass')
  })

  it('gap_fill_enabled defaults true, only false disables it', () => {
    expect(DEFAULT_CHART_RIBBON_STYLE.gap_fill_enabled).toBe(true)
    expect(mergeChartRibbonStylePartial({}).gap_fill_enabled).toBe(true)
    expect(mergeChartRibbonStylePartial({ gap_fill_enabled: true } as Record<string, unknown>).gap_fill_enabled).toBe(true)
    expect(mergeChartRibbonStylePartial({ gap_fill_enabled: false } as Record<string, unknown>).gap_fill_enabled).toBe(false)
    // truthy non-false values still enable it
    expect(mergeChartRibbonStylePartial({ gap_fill_enabled: 1 } as Record<string, unknown>).gap_fill_enabled).toBe(true)
    expect(mergeChartRibbonStylePartial({ gap_fill_enabled: null } as Record<string, unknown>).gap_fill_enabled).toBe(true)

    const roundTripped = normalizeChartRibbonStyleForPut(JSON.stringify({ gap_fill_enabled: false }))
    expect(roundTripped.ok).toBe(true)
    if (roundTripped.ok) {
      expect(JSON.parse(roundTripped.value).gap_fill_enabled).toBe(false)
    }
  })

  it('mergeChartRibbonStylePartial enables slice pair table only when true', () => {
    expect(DEFAULT_CHART_RIBBON_STYLE.slice_pair_table_enabled).toBe(false)
    expect(mergeChartRibbonStylePartial({ slice_pair_table_enabled: true } as Record<string, unknown>).slice_pair_table_enabled).toBe(
      true,
    )
    expect(mergeChartRibbonStylePartial({ slice_pair_table_enabled: false } as Record<string, unknown>).slice_pair_table_enabled).toBe(
      false,
    )
    expect(mergeChartRibbonStylePartial({ slice_pair_table_enabled: 1 } as Record<string, unknown>).slice_pair_table_enabled).toBe(false)
    const m = mergeChartRibbonStylePartial({
      slice_pair_font_px: 99,
      slice_pair_text_color: '#nothex',
      slice_pair_table_bg_color: '#aabbcc',
      slice_pair_grid_width_px: 9,
    } as Record<string, unknown>)
    expect(m.slice_pair_font_px).toBe(18)
    expect(m.slice_pair_text_color).toBe('')
    expect(m.slice_pair_table_bg_color).toBe('#aabbcc')
    expect(m.slice_pair_grid_width_px).toBe(4)
  })
})
