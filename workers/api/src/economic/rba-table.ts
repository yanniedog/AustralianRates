import { parseDelimitedText, parseFlexibleDate, parseNumber } from './parser-utils'

export type EconomicObservationInput = {
  seriesId: string
  observationDate: string
  value: number
  sourceUrl: string
  releaseDate: string | null
  frequency: string
  proxy: boolean
  notesJson?: string | null
}

export type ParsedRbaTable = {
  sourceUrl: string
  titleRow: string[]
  frequencyRow: string[]
  unitsRow: string[]
  sourceRow: string[]
  publicationRow: string[]
  seriesIdRow: string[]
  dataRows: string[][]
}

function rowOrEmpty(rows: string[][], index: number): string[] {
  return rows[index] ?? []
}

export function parseRbaTableCsv(csv: string, sourceUrl: string): ParsedRbaTable {
  const rows = parseDelimitedText(csv)
  return {
    sourceUrl,
    titleRow: rowOrEmpty(rows, 1),
    frequencyRow: rowOrEmpty(rows, 3),
    unitsRow: rowOrEmpty(rows, 5),
    sourceRow: rowOrEmpty(rows, 8),
    publicationRow: rowOrEmpty(rows, 9),
    seriesIdRow: rowOrEmpty(rows, 10),
    dataRows: rows.slice(11).filter((row) => row.length > 0 && String(row[0] || '').trim().length > 0),
  }
}

export function extractRbaSeriesObservations(
  table: ParsedRbaTable,
  publicSeriesId: string,
  wantedSeriesId: string,
  proxy: boolean,
  extraNotes?: Record<string, unknown>,
): EconomicObservationInput[] {
  const columnIndex = table.seriesIdRow.findIndex((value) => String(value || '').trim() === wantedSeriesId)
  if (columnIndex < 1) return []

  const releaseDate = parseFlexibleDate(table.publicationRow[columnIndex] || '')
  const frequency = String(table.frequencyRow[columnIndex] || '').trim().toLowerCase() || 'unknown'
  const units = String(table.unitsRow[columnIndex] || '').trim()
  const title = String(table.titleRow[columnIndex] || '').trim()
  const source = String(table.sourceRow[columnIndex] || '').trim()

  const rows: EconomicObservationInput[] = []
  for (const row of table.dataRows) {
    const observationDate = parseFlexibleDate(row[0] || '')
    const value = parseNumber(row[columnIndex])
    if (!observationDate || value == null) continue
    rows.push({
      seriesId: publicSeriesId,
      observationDate,
      value,
      sourceUrl: table.sourceUrl,
      releaseDate,
      frequency,
      proxy,
      notesJson: JSON.stringify({
        title,
        source,
        units,
        ...(extraNotes || {}),
      }),
    })
  }

  return rows
}
