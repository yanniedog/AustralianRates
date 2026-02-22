import {
  normalizeBankName,
  normalizeFeatureSet,
  normalizeLvrTier,
  normalizeRateStructure,
  normalizeRepaymentType,
  normalizeSecurityPurpose,
  parseAnnualFee,
  parseComparisonRate,
  parseInterestRate,
  type NormalizedRateRow,
} from './normalize'
import type { LenderConfig } from '../types'
import { nowIso } from '../utils/time'

type JsonRecord = Record<string, unknown>

type FetchJsonResult = {
  ok: boolean
  status: number
  url: string
  data: unknown
  text: string
}

function isRecord(v: unknown): v is JsonRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function getText(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function pickText(obj: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const v = obj[key]
    const text = getText(v)
    if (text) return text
  }
  return ''
}

function safeUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

async function fetchTextWithRetries(url: string, retries = 2): Promise<{ ok: boolean; status: number; text: string }> {
  let lastStatus = 0
  let lastText = ''
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
      })
      const text = await res.text()
      lastStatus = res.status
      lastText = text
      if (res.ok) {
        return { ok: true, status: res.status, text }
      }
    } catch (error) {
      lastText = (error as Error)?.message || String(error)
    }
  }
  return { ok: false, status: lastStatus || 500, text: lastText }
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function fetchJson(url: string): Promise<FetchJsonResult> {
  const response = await fetchTextWithRetries(url, 2)
  const data = parseJsonSafe(response.text)
  return {
    ok: response.ok && data != null,
    status: response.status,
    url,
    data,
    text: response.text,
  }
}

type RegisterBrand = {
  brandName: string
  legalEntityName: string
  endpointUrl: string
}

function extractBrands(payload: unknown): RegisterBrand[] {
  const out: RegisterBrand[] = []
  const dataArray = isRecord(payload) ? asArray((payload as JsonRecord).data) : asArray(payload)
  for (const item of dataArray) {
    if (!isRecord(item)) continue
    const brandName = pickText(item, ['brandName', 'dataHolderBrandName'])
    const legalEntityName = isRecord(item.legalEntity) ? pickText(item.legalEntity as JsonRecord, ['legalEntityName']) : ''
    const endpointDetail = isRecord(item.endpointDetail) ? (item.endpointDetail as JsonRecord) : {}
    const endpointUrlRaw =
      pickText(endpointDetail, ['productReferenceDataApi']) ||
      pickText(endpointDetail, ['publicBaseUri']) ||
      pickText(endpointDetail, ['resourceBaseUri'])
    if (!endpointUrlRaw) continue
    const endpointUrl = endpointUrlRaw.includes('/cds-au/v1/banking/products')
      ? endpointUrlRaw
      : `${safeUrl(endpointUrlRaw)}/cds-au/v1/banking/products`
    out.push({
      brandName,
      legalEntityName,
      endpointUrl,
    })
  }
  return out
}

function lenderMatchesBrand(lender: LenderConfig, brand: RegisterBrand): boolean {
  const haystack = `${brand.brandName} ${brand.legalEntityName}`.toLowerCase()
  const needles = [lender.register_brand_name, lender.canonical_bank_name, lender.name]
  for (const needle of needles) {
    const n = getText(needle).toLowerCase()
    if (n && haystack.includes(n)) {
      return true
    }
  }
  return false
}

export async function discoverProductsEndpoint(
  lender: LenderConfig,
): Promise<{ endpointUrl: string; sourceUrl: string; status: number; notes: string } | null> {
  const registerUrls = [
    'https://api.cdr.gov.au/cdr-register/v1/banking/data-holders/brands',
    'https://api.cdr.gov.au/cdr-register/v1/banking/register',
  ]

  for (const registerUrl of registerUrls) {
    const fetched = await fetchJson(registerUrl)
    if (!fetched.ok) {
      continue
    }
    const brands = extractBrands(fetched.data)
    const hit = brands.find((brand) => lenderMatchesBrand(lender, brand))
    if (hit) {
      return {
        endpointUrl: hit.endpointUrl,
        sourceUrl: registerUrl,
        status: fetched.status,
        notes: `matched_brand:${hit.brandName || lender.name}`,
      }
    }
  }

  if (lender.products_endpoint) {
    return {
      endpointUrl: lender.products_endpoint,
      sourceUrl: 'lenders.json',
      status: 200,
      notes: 'configured_products_endpoint',
    }
  }

  return null
}

function extractProducts(payload: unknown): JsonRecord[] {
  if (!isRecord(payload)) return []
  const data = isRecord(payload.data) ? asArray((payload.data as JsonRecord).products) : asArray(payload.data)
  return data.filter(isRecord)
}

function nextLink(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const links = isRecord(payload.links) ? (payload.links as JsonRecord) : null
  const next = links ? getText(links.next) : ''
  return next || null
}

function isResidentialMortgage(product: JsonRecord): boolean {
  const category = pickText(product, ['productCategory', 'category', 'type']).toUpperCase()
  const name = pickText(product, ['name', 'productName']).toUpperCase()
  return category.includes('MORTGAGE') || name.includes('MORTGAGE') || name.includes('HOME LOAN')
}

function extractRatesArray(detail: JsonRecord): JsonRecord[] {
  const arrays = [detail.lendingRates, detail.rates, detail.rateTiers, detail.rate]
  for (const candidate of arrays) {
    const arr = asArray(candidate).filter(isRecord)
    if (arr.length > 0) return arr
  }
  return []
}

function collectConstraintText(rate: JsonRecord, detail: JsonRecord): string {
  const fromRate = [pickText(rate, ['additionalInfo', 'additionalValue', 'name', 'lendingRateType'])]
  const constraints = asArray(rate.constraints).filter(isRecord)
  for (const c of constraints) {
    fromRate.push(JSON.stringify(c))
  }
  const detailHints = [pickText(detail, ['description', 'name', 'productName'])]
  return [...fromRate, ...detailHints].filter(Boolean).join(' | ')
}

function parseLvrBounds(rate: JsonRecord): { min: number | null; max: number | null } {
  const constraints = asArray(rate.constraints).filter(isRecord)
  for (const c of constraints) {
    const t = pickText(c, ['constraintType']).toLowerCase()
    if (!t.includes('lvr')) {
      continue
    }
    const min = Number.isFinite(Number(c.minValue)) ? Number(c.minValue) : null
    const max = Number.isFinite(Number(c.maxValue)) ? Number(c.maxValue) : null
    return { min, max }
  }
  return { min: null, max: null }
}

function parseAnnualFeeFromDetail(detail: JsonRecord): number | null {
  const fees = asArray(detail.fees).filter(isRecord)
  for (const fee of fees) {
    const feeType = pickText(fee, ['feeType', 'name']).toLowerCase()
    if (!feeType.includes('annual') && !feeType.includes('package')) {
      continue
    }
    const amount = parseAnnualFee(fee.amount)
    if (amount != null) {
      return amount
    }
  }
  return null
}

function parseRatesFromDetail(input: {
  lender: LenderConfig
  detail: JsonRecord
  sourceUrl: string
  collectionDate: string
}): NormalizedRateRow[] {
  const detail = input.detail
  const productId = pickText(detail, ['productId', 'id']) || `product-${crypto.randomUUID()}`
  const productName = pickText(detail, ['name', 'productName']) || productId
  const rates = extractRatesArray(detail)
  const annualFee = parseAnnualFeeFromDetail(detail)
  const result: NormalizedRateRow[] = []

  for (const rate of rates) {
    const interestRate = parseInterestRate(rate.rate)
    if (interestRate == null) {
      continue
    }
    const comparisonRate = parseComparisonRate(rate.comparisonRate)
    const contextText = collectConstraintText(rate, detail)
    const lvr = parseLvrBounds(rate)
    const row: NormalizedRateRow = {
      bankName: normalizeBankName(input.lender.canonical_bank_name, input.lender.name),
      collectionDate: input.collectionDate,
      productId,
      productName,
      securityPurpose: normalizeSecurityPurpose(
        `${pickText(rate, ['loanPurpose'])} ${pickText(detail, ['loanPurpose'])} ${contextText}`,
      ),
      repaymentType: normalizeRepaymentType(
        `${pickText(rate, ['repaymentType'])} ${pickText(detail, ['repaymentType'])} ${contextText}`,
      ),
      rateStructure: normalizeRateStructure(
        `${pickText(rate, ['lendingRateType', 'name'])} ${pickText(detail, ['name'])} ${contextText}`,
      ),
      lvrTier: normalizeLvrTier(contextText, lvr.min, lvr.max),
      featureSet: normalizeFeatureSet(`${productName} ${contextText}`, annualFee),
      interestRate,
      comparisonRate,
      annualFee,
      sourceUrl: input.sourceUrl,
      dataQualityFlag: 'cdr_live',
      confidenceScore: 0.95,
    }
    result.push(row)
  }

  return result
}

type ProductListFetchResult = {
  productIds: string[]
  rawPayloads: Array<{ sourceUrl: string; status: number; body: string }>
}

export async function fetchResidentialMortgageProductIds(endpointUrl: string, pageLimit = 20): Promise<ProductListFetchResult> {
  const ids = new Set<string>()
  const payloads: Array<{ sourceUrl: string; status: number; body: string }> = []
  let url: string | null = endpointUrl
  let pages = 0

  while (url && pages < pageLimit) {
    pages += 1
    const response = await fetchJson(url)
    payloads.push({
      sourceUrl: url,
      status: response.status,
      body: response.text,
    })
    if (!response.ok || !response.data) {
      break
    }

    const products = extractProducts(response.data)
    for (const product of products) {
      if (!isResidentialMortgage(product)) continue
      const id = pickText(product, ['productId', 'id'])
      if (id) ids.add(id)
    }
    url = nextLink(response.data)
  }

  return {
    productIds: Array.from(ids),
    rawPayloads: payloads,
  }
}

export async function fetchProductDetailRows(input: {
  lender: LenderConfig
  endpointUrl: string
  productId: string
  collectionDate: string
}): Promise<{ rows: NormalizedRateRow[]; rawPayload: { sourceUrl: string; status: number; body: string } }> {
  const detailUrl = `${safeUrl(input.endpointUrl)}/${encodeURIComponent(input.productId)}`
  const fetched = await fetchJson(detailUrl)
  const rawPayload = {
    sourceUrl: detailUrl,
    status: fetched.status,
    body: fetched.text,
  }

  if (!fetched.ok || !isRecord(fetched.data)) {
    return { rows: [], rawPayload }
  }

  const detail = isRecord((fetched.data as JsonRecord).data)
    ? ((fetched.data as JsonRecord).data as JsonRecord)
    : (fetched.data as JsonRecord)

  return {
    rows: parseRatesFromDetail({
      lender: input.lender,
      detail,
      sourceUrl: detailUrl,
      collectionDate: input.collectionDate,
    }),
    rawPayload,
  }
}

export function backfillSeedProductRows(input: {
  lender: LenderConfig
  collectionDate: string
  sourceUrl: string
  productName: string
  rate: number
}): NormalizedRateRow {
  const productId = `${input.lender.code}-seed-${Math.abs(hashString(input.productName))}`
  return {
    bankName: normalizeBankName(input.lender.canonical_bank_name, input.lender.name),
    collectionDate: input.collectionDate,
    productId,
    productName: input.productName,
    securityPurpose: 'owner_occupied',
    repaymentType: 'principal_and_interest',
    rateStructure: 'variable',
    lvrTier: 'lvr_80-85%',
    featureSet: normalizeFeatureSet(input.productName, null),
    interestRate: input.rate,
    comparisonRate: null,
    annualFee: null,
    sourceUrl: input.sourceUrl,
    dataQualityFlag: 'parsed_from_wayback',
    confidenceScore: 0.6,
  }
}

function hashString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0
  }
  return h
}

export function buildBackfillCursorKey(lenderCode: string, monthCursor: string, seedUrl: string): string {
  return `${lenderCode}|${monthCursor}|${seedUrl}`
}

export function cdrCollectionNotes(productCount: number, rowCount: number): string {
  return `cdr_collection products=${productCount} rows=${rowCount} at=${nowIso()}`
}
