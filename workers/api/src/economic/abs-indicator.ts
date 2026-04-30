import { parseDelimitedText, parseFlexibleDate, parseNumber } from './parser-utils'
import type { EconomicObservationInput } from './rba-table'

export type AbsIndicatorCsvSpec = {
  seriesId: string
  sourceUrl: string
  frequency: string
  proxy: boolean
  filters: Record<string, string>
}

function normalizeKey(value: string): string {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}

function normalizeValue(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalizeKey)
  for (const candidate of candidates.map(normalizeKey)) {
    const index = normalized.indexOf(candidate)
    if (index >= 0) return index
  }
  return -1
}

function matchesFilters(row: string[], headers: string[], filters: Record<string, string>): boolean {
  return Object.entries(filters).every(([key, wanted]) => {
    const index = findColumn(headers, [key])
    if (index < 0) return true
    const actual = row[index] ?? ''
    return normalizeValue(actual) === normalizeValue(wanted)
  })
}

export function parseAbsIndicatorCsv(csv: string, spec: AbsIndicatorCsvSpec): EconomicObservationInput[] {
  const rows = parseDelimitedText(csv).filter((row) => row.some((cell) => String(cell || '').trim()))
  if (rows.length < 2) return []
  const headers = rows[0].map((header) => String(header || '').trim())
  const timeIndex = findColumn(headers, ['TIME_PERIOD', 'Time period', 'TIME'])
  const valueIndex = findColumn(headers, ['OBS_VALUE', 'Observation value', 'Value'])
  if (timeIndex < 0 || valueIndex < 0) return []

  const observations: EconomicObservationInput[] = []
  for (const row of rows.slice(1)) {
    if (!matchesFilters(row, headers, spec.filters)) continue
    const observationDate = parseFlexibleDate(row[timeIndex] || '')
    const value = parseNumber(row[valueIndex])
    if (!observationDate || value == null) continue
    observations.push({
      seriesId: spec.seriesId,
      observationDate,
      value,
      sourceUrl: spec.sourceUrl,
      releaseDate: observationDate,
      frequency: spec.frequency,
      proxy: spec.proxy,
      notesJson: JSON.stringify({
        source: 'abs_indicator_api',
        filters: spec.filters,
      }),
    })
  }

  return observations.sort((left, right) => left.observationDate.localeCompare(right.observationDate))
}
