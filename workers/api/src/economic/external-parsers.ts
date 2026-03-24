import { parseDelimitedText, parseFlexibleDate, parseNumber } from './parser-utils'
import type { EconomicObservationInput } from './rba-table'

export function parseRbnzOcrText(
  raw: string,
  seriesId: string,
  sourceUrl: string,
  proxy: boolean,
): EconomicObservationInput[] {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const rows: EconomicObservationInput[] = []
  for (const line of lines) {
    const match = line.match(/^(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+([0-9.]+)(?:\s|\[|$)/)
    if (!match) continue
    const observationDate = parseFlexibleDate(match[1])
    const value = parseNumber(match[2])
    if (!observationDate || value == null) continue
    rows.push({
      seriesId,
      observationDate,
      value,
      sourceUrl,
      releaseDate: observationDate,
      frequency: 'policy',
      proxy,
      notesJson: JSON.stringify({
        transport: 'readable-mirror',
      }),
    })
  }

  return rows
}

export function parseFedTargetHistoryHtml(
  html: string,
  seriesId: string,
  sourceUrl: string,
  proxy: boolean,
): EconomicObservationInput[] {
  const rows: EconomicObservationInput[] = []
  const sectionRegex = /<h4>(\d{4})<\/h4>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/g
  let sectionMatch: RegExpExecArray | null

  while ((sectionMatch = sectionRegex.exec(html)) !== null) {
    const year = sectionMatch[1]
    const tbody = sectionMatch[2]
    const rowRegex =
      /<tr>[\s\S]*?<td[^>]*scope="row"[^>]*>([^<]+)<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<\/tr>/g
    let rowMatch: RegExpExecArray | null

    while ((rowMatch = rowRegex.exec(tbody)) !== null) {
      const observationDate = parseFlexibleDate(`${rowMatch[1]} ${year}`)
      const level = String(rowMatch[4] || '').trim()
      const rangeMatch = level.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/)
      if (!observationDate || !rangeMatch) continue
      const low = Number(rangeMatch[1])
      const high = Number(rangeMatch[2])
      if (!Number.isFinite(low) || !Number.isFinite(high)) continue
      rows.push({
        seriesId,
        observationDate,
        value: Number(((low + high) / 2).toFixed(3)),
        sourceUrl,
        releaseDate: observationDate,
        frequency: 'policy',
        proxy,
        notesJson: JSON.stringify({
          increase_bps: parseNumber(rowMatch[2]),
          decrease_bps: parseNumber(rowMatch[3]),
          target_range: level,
        }),
      })
    }
  }

  return rows
}

export function parseFredChinaGdpProxyCsv(
  csv: string,
  seriesId: string,
  sourceUrl: string,
  proxy: boolean,
): EconomicObservationInput[] {
  const rows = parseDelimitedText(csv)
  const points = rows
    .slice(1)
    .map((row) => ({
      observationDate: String(row[0] || '').trim(),
      value: parseNumber(row[1]),
    }))
    .filter((row) => row.observationDate && row.value != null)

  const byDate = new Map<string, number>(points.map((row) => [row.observationDate, row.value as number]))
  const observations: EconomicObservationInput[] = []

  for (const point of points) {
    const priorYearDate = point.observationDate.replace(/^(\d{4})/, (_, year) => String(Number(year) - 1))
    const priorValue = byDate.get(priorYearDate)
    if (!Number.isFinite(point.value as number) || !Number.isFinite(priorValue as number) || !priorValue) continue
    const yoy = (((point.value as number) / priorValue) - 1) * 100
    observations.push({
      seriesId,
      observationDate: point.observationDate,
      value: Number(yoy.toFixed(3)),
      sourceUrl,
      releaseDate: point.observationDate,
      frequency: 'quarterly',
      proxy,
      notesJson: JSON.stringify({
        basis: 'year_over_year_from_quarterly_level',
      }),
    })
  }

  return observations
}
