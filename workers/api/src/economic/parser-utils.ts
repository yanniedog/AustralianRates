const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

function isoDateFromParts(year: number, monthIndex: number, day: number): string {
  const value = new Date(Date.UTC(year, monthIndex, day))
  return value.toISOString().slice(0, 10)
}

function endOfMonth(year: number, monthIndex: number): string {
  return isoDateFromParts(year, monthIndex + 1, 0)
}

export function parseCsvRow(line: string): string[] {
  const row: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === ',') {
      row.push(current)
      current = ''
      continue
    }
    current += char
  }

  row.push(current)
  return row
}

export function parseDelimitedText(text: string): string[][] {
  return text
    .replace(/\uFEFF/g, '')
    .split(/\r?\n/)
    .map((line) => parseCsvRow(line))
}

export function parseNumber(value: string | null | undefined): number | null {
  if (value == null) return null
  const normalized = String(value).trim().replace(/,/g, '')
  if (!normalized || normalized === '..' || normalized === 'n.a.' || normalized === '\u2014') return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseFlexibleDate(value: string): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  let match = raw.match(/^(\d{4})-(\d{2})$/)
  if (match) {
    return endOfMonth(Number(match[1]), Number(match[2]) - 1)
  }

  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match) {
    return isoDateFromParts(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
  }

  match = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/)
  if (match) {
    const monthIndex = MONTH_INDEX[match[2].toLowerCase()]
    if (monthIndex == null) return null
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
    return isoDateFromParts(year, monthIndex, Number(match[1]))
  }

  match = raw.match(/^([A-Za-z]{3})-(\d{4})$/)
  if (match) {
    const monthIndex = MONTH_INDEX[match[1].toLowerCase()]
    if (monthIndex == null) return null
    return endOfMonth(Number(match[2]), monthIndex)
  }

  match = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  if (match) {
    const monthIndex = MONTH_INDEX[match[2].slice(0, 3).toLowerCase()]
    if (monthIndex == null) return null
    return isoDateFromParts(Number(match[3]), monthIndex, Number(match[1]))
  }

  match = raw.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/)
  if (match) {
    const monthIndex = MONTH_INDEX[match[1].slice(0, 3).toLowerCase()]
    if (monthIndex == null) return null
    return isoDateFromParts(Number(match[3]), monthIndex, Number(match[2]))
  }

  return null
}

export function midpointFromRange(value: string): number | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const range = raw.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/)
  if (range) {
    const low = Number(range[1])
    const high = Number(range[2])
    if (!Number.isFinite(low) || !Number.isFinite(high)) return null
    return Number(((low + high) / 2).toFixed(3))
  }
  return parseNumber(raw)
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function* dateRangeInclusive(startDate: string, endDate: string): Generator<string> {
  let current = startDate
  while (current <= endDate) {
    yield current
    current = addDays(current, 1)
  }
}

export function htmlishTextToLines(raw: string): string[] {
  const normalized = String(raw || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&ndash;|&mdash;/g, '-')

  return normalized
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}
