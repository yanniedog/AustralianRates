import { describe, expect, it } from 'vitest'
import {
  buildChartWindowScope,
  parseChartWindow,
  resolveChartWindowStart,
} from '../src/utils/chart-window'

describe('chart-window', () => {
  it('parses supported window tokens', () => {
    expect(parseChartWindow(undefined)).toBeNull()
    expect(parseChartWindow('30d')).toBe('30D')
    expect(parseChartWindow('90D')).toBe('90D')
    expect(parseChartWindow('180d')).toBe('180D')
    expect(parseChartWindow('1y')).toBe('1Y')
    expect(parseChartWindow('all')).toBe('ALL')
    expect(parseChartWindow('weird')).toBeNull()
  })

  it('resolves a bounded start date for each window', () => {
    expect(resolveChartWindowStart('2026-01-01', '2026-04-03', '30D')).toBe('2026-03-04')
    expect(resolveChartWindowStart('2026-01-01', '2026-04-03', '90D')).toBe('2026-01-03')
    expect(resolveChartWindowStart('2026-01-01', '2026-04-03', '180D')).toBe('2026-01-01')
    expect(resolveChartWindowStart('2026-01-01', '2026-04-03', '1Y')).toBe('2026-01-01')
    expect(resolveChartWindowStart('2026-01-01', '2026-04-03', 'ALL')).toBe('2026-01-01')
  })

  it('builds stable cache scopes', () => {
    expect(buildChartWindowScope('30D')).toBe('window:30D')
    expect(buildChartWindowScope('ALL')).toBe('window:ALL')
  })
})
