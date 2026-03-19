import type { Context } from 'hono'
import { ChartDataRequestError } from '../../db/chart-data/errors'
import { parseCsvList } from '../public-query'

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function parseStringListQuery(c: Context, names: string[]): string[] {
  const values = new Set<string>()
  for (const name of names) {
    const single = c.req.query(name)
    for (const item of parseCsvList(single)) values.add(item)
    const multiple = c.req.queries(name) ?? []
    for (const item of multiple.flatMap((value) => parseCsvList(value))) values.add(item)
  }
  return Array.from(values)
}

export function parseOptionalDateQuery(value: string | undefined, field: string): string | undefined {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  if (!isIsoDate(text)) throw new ChartDataRequestError(400, 'INVALID_DATE', `${field} must be YYYY-MM-DD.`)
  return text
}

export function assertDateRange(startDate?: string, endDate?: string): void {
  if (startDate && endDate && startDate > endDate) {
    throw new ChartDataRequestError(400, 'INVALID_DATE_RANGE', 'startDate must be before or equal to endDate.')
  }
}

export function parseBooleanQuery(value: string | undefined, field: string): boolean | undefined {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return undefined
  if (text === 'true' || text === '1' || text === 'yes') return true
  if (text === 'false' || text === '0' || text === 'no') return false
  throw new ChartDataRequestError(400, 'INVALID_BOOLEAN', `${field} must be true or false.`)
}

export function parseNumberQuery(value: string | undefined, field: string): number | undefined {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) throw new ChartDataRequestError(400, 'INVALID_NUMBER', `${field} must be numeric.`)
  return parsed
}
