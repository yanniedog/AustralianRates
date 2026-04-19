import type { ChartCacheSection } from '../db/chart-cache'

type RawProductHistoryPoint = [number, number]
type ProductHistoryPoint = RawProductHistoryPoint | [number, number, number]

type ProductHistoryProduct = {
  key: string
  bank_name: string
  product_name: string
  security_purpose?: string
  repayment_type?: string
  rate_structure?: string
  lvr_tier?: string
  feature_set?: string
  account_type?: string
  rate_type?: string
  deposit_tier?: string
  term_months?: number
  interest_payment?: string
  min_balance?: number
  max_balance?: number
  min_deposit?: number
  max_deposit?: number
  points: ProductHistoryPoint[]
}

type MutableProductHistoryProduct = Omit<ProductHistoryProduct, 'points'> & {
  points: RawProductHistoryPoint[]
}

export type ReportProductHistoryPayload = {
  ok: true
  version: 2
  section: ChartCacheSection
  dates: string[]
  products: ProductHistoryProduct[]
}

const META_FIELDS_BY_SECTION: Record<ChartCacheSection, readonly string[]> = {
  home_loans: ['security_purpose', 'repayment_type', 'rate_structure', 'lvr_tier', 'feature_set'],
  savings: ['account_type', 'rate_type', 'deposit_tier', 'min_balance', 'max_balance'],
  term_deposits: ['term_months', 'deposit_tier', 'interest_payment', 'min_deposit', 'max_deposit'],
}

function productHistoryKey(row: Record<string, unknown>): string {
  const raw =
    row.product_key ??
    row.series_key ??
    row.product_id ??
    `${String(row.bank_name ?? '').trim()}|${String(row.product_name ?? '').trim()}`
  return String(raw || '').trim()
}

function productSortValue(product: ProductHistoryProduct): string {
  return [
    String(product.bank_name || '').trim().toLowerCase(),
    String(product.product_name || '').trim().toLowerCase(),
    String(product.key || '').trim().toLowerCase(),
  ].join('|')
}

function copyMetaField(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  field: string,
): void {
  if (hasMeaningfulValue(target[field])) return
  if (!hasMeaningfulValue(source[field])) return
  target[field] = source[field]
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

function encodePoints(points: RawProductHistoryPoint[]): ProductHistoryPoint[] {
  if (!points.length) return []
  const encoded: ProductHistoryPoint[] = []
  let runStart = points[0][0]
  let runEnd = points[0][0]
  let runValue = points[0][1]

  const pushRun = () => {
    encoded.push(runStart === runEnd ? [runStart, runValue] : [runStart, runEnd, runValue])
  }

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]
    if (point[0] === runEnd + 1 && point[1] === runValue) {
      runEnd = point[0]
      continue
    }
    pushRun()
    runStart = point[0]
    runEnd = point[0]
    runValue = point[1]
  }
  pushRun()
  return encoded
}

export function buildReportProductHistoryPayload(
  section: ChartCacheSection,
  rows: Array<Record<string, unknown>>,
): ReportProductHistoryPayload {
  const dateSet = new Set<string>()
  for (const row of rows) {
    const date = String(row.collection_date || '').slice(0, 10)
    if (date) dateSet.add(date)
  }
  const dates = Array.from(dateSet).sort((left, right) => left.localeCompare(right))
  const dateIndex = new Map<string, number>()
  dates.forEach((date, index) => dateIndex.set(date, index))

  const metaFields = META_FIELDS_BY_SECTION[section] || []
  const products = new Map<string, MutableProductHistoryProduct>()

  for (const row of rows) {
    const date = String(row.collection_date || '').slice(0, 10)
    const idx = dateIndex.get(date)
    const rate = Number(row.interest_rate)
    if (idx == null || !Number.isFinite(rate)) continue

    const key = productHistoryKey(row)
    if (!key) continue

    let product = products.get(key)
    if (!product) {
      product = {
        key,
        bank_name: String(row.bank_name || '').trim(),
        product_name: String(row.product_name || '').trim(),
        points: [],
      }
      for (const field of metaFields) {
        if (hasMeaningfulValue(row[field])) {
          ;(product as Record<string, unknown>)[field] = row[field]
        }
      }
      products.set(key, product)
    } else {
      copyMetaField(product as Record<string, unknown>, row, 'bank_name')
      copyMetaField(product as Record<string, unknown>, row, 'product_name')
      for (const field of metaFields) {
        copyMetaField(product as Record<string, unknown>, row, field)
      }
    }

    product.points.push([idx, rate])
  }

  return {
    ok: true,
    version: 2,
    section,
    dates,
    products: Array.from(products.values())
      .map((product) => ({
        ...product,
        points: encodePoints(product.points.slice().sort((left, right) => left[0] - right[0])),
      }))
      .filter((product) => product.points.length > 0)
      .sort((left, right) => productSortValue(left).localeCompare(productSortValue(right))),
  }
}
