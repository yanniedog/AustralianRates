export type ChartWindow = '30D' | '90D' | '180D' | '1Y' | 'ALL'

export const PRECOMPUTED_CHART_WINDOWS: ChartWindow[] = ['30D', '90D', '180D', '1Y', 'ALL']

export function parseChartWindow(value: string | undefined | null): ChartWindow | null {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
  if (normalized === '30D' || normalized === '90D' || normalized === '180D' || normalized === '1Y') {
    return normalized
  }
  if (normalized === 'ALL') return 'ALL'
  return null
}

function shiftUtcDate(ymd: string, adjuster: (date: Date) => void): string {
  const date = new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`)
  if (!Number.isFinite(date.getTime())) return String(ymd || '').slice(0, 10)
  adjuster(date)
  return date.toISOString().slice(0, 10)
}

function shiftDays(ymd: string, days: number): string {
  return shiftUtcDate(ymd, (date) => {
    date.setUTCDate(date.getUTCDate() + Number(days || 0))
  })
}

function shiftYears(ymd: string, years: number): string {
  return shiftUtcDate(ymd, (date) => {
    date.setUTCFullYear(date.getUTCFullYear() + Number(years || 0))
  })
}

function laterDate(left: string, right: string): string {
  if (!left) return String(right || '')
  if (!right) return String(left || '')
  return left > right ? left : right
}

export function resolveChartWindowStart(minDate: string, maxDate: string, window: ChartWindow): string {
  const floor = String(minDate || '').slice(0, 10)
  const ceiling = String(maxDate || '').slice(0, 10)
  if (!floor || !ceiling) return ceiling || floor || ''
  if (window === 'ALL') return floor
  if (window === '30D') return laterDate(floor, shiftDays(ceiling, -30))
  if (window === '90D') return laterDate(floor, shiftDays(ceiling, -90))
  if (window === '180D') return laterDate(floor, shiftDays(ceiling, -180))
  return laterDate(floor, shiftYears(ceiling, -1))
}

export function buildChartWindowScope(window: ChartWindow): `window:${ChartWindow}` {
  return `window:${window}`
}
