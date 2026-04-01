import { describe, expect, it } from 'vitest'
import {
  normalizeChartLegendOpacityForPut,
  resolveChartLegendOpacityFromDb,
  resolveChartLegendOpacitySetFromDb,
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
})
