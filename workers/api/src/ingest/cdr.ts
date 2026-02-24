import {
  normalizeBankName,
  normalizeFeatureSet,
  normalizeLvrTier,
  normalizeProductName,
  normalizeRateStructure,
  normalizeRepaymentType,
  normalizeSecurityPurpose,
  parseAnnualFee,
  parseComparisonRate,
  parseInterestRate,
  isProductNameLikelyRateProduct,
  type NormalizedRateRow,
} from './normalize'
import { getLenderPlaybook } from './lender-playbooks'
import type { LenderConfig } from '../types'
import { nowIso } from '../utils/time'

export type JsonRecord = Record<string, unknown>

type FetchJsonResult = {
  ok: boolean
  status: number
  url: string
  data: unknown
  text: string
}

export function isRecord(v: unknown): v is JsonRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

export function getText(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

export function pickText(obj: JsonRecord, keys: string[]): string {
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

async function fetchTextWithRetries(
  url: string,
  retries = 2,
  headers: Record<string, string> = { accept: 'application/json' },
): Promise<{ ok: boolean; status: number; text: string }> {
  let lastStatus = 0
  let lastText = ''
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await fetch(url, {
        headers,
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
  const response = await fetchTextWithRetries(url, 2, { accept: 'application/json' })
  const data = parseJsonSafe(response.text)
  return {
    ok: response.ok && data != null,
    status: response.status,
    url,
    data,
    text: response.text,
  }
}

function parseSupportedVersions(body: string): number[] {
  const m = body.match(/Versions available:\s*([0-9,\s]+)/i)
  if (!m) return []
  return m[1]
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x))
}

export async function fetchCdrJson(url: string, versions: number[]): Promise<FetchJsonResult> {
  const tried = new Set<number>()
  const queue = [...versions]
  while (queue.length > 0) {
    const version = Number(queue.shift())
    if (!Number.isFinite(version) || tried.has(version)) continue
    tried.add(version)

    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          'x-v': String(version),
          'x-min-v': '1',
        },
      })
      const text = await res.text()
      const data = parseJsonSafe(text)
      if (res.ok && data != null) {
        return {
          ok: true,
          status: res.status,
          url,
          data,
          text,
        }
      }
      if (res.status === 406) {
        const advertised = parseSupportedVersions(text)
        for (const x of advertised) {
          if (!tried.has(x)) queue.push(x)
        }
      }
    } catch {
      // keep trying alternate versions
    }
  }

  for (const fallbackVersion of [1, 2, 3, 4, 5, 6]) {
    if (tried.has(fallbackVersion)) continue
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          'x-v': String(fallbackVersion),
          'x-min-v': '1',
        },
      })
      const text = await res.text()
      const data = parseJsonSafe(text)
      if (res.ok && data != null) {
        return {
          ok: true,
          status: res.status,
          url,
          data,
          text,
        }
      }
    } catch {
      // continue
    }
  }

  return fetchJson(url)
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
      pickText(endpointDetail, ['resourceBaseUri']) ||
      pickText(item, ['publicBaseUri']) ||
      pickText(item, ['resourceBaseUri'])
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
    'https://api.cdr.gov.au/cdr-register/v1/all/data-holders/brands/summary',
    'https://api.cdr.gov.au/cdr-register/v1/banking/data-holders/brands',
    'https://api.cdr.gov.au/cdr-register/v1/banking/register',
  ]

  for (const registerUrl of registerUrls) {
    const fetched = registerUrl.includes('/all/data-holders/brands/summary')
      ? await fetchCdrJson(registerUrl, [1, 2, 3, 4, 5, 6])
      : await fetchJson(registerUrl)
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

export function extractProducts(payload: unknown): JsonRecord[] {
  if (!isRecord(payload)) return []
  const data = isRecord(payload.data) ? asArray((payload.data as JsonRecord).products) : asArray(payload.data)
  return data.filter(isRecord)
}

export function nextLink(payload: unknown): string | null {
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

function parseLvrFromText(text: string): { min: number | null; max: number | null } | null {
  const t = text.toLowerCase()
  if (!t.includes('lvr') && !t.includes('loan to value') && !t.includes('ltv')) return null

  const range = t.match(/(\d{1,3}(?:\.\d+)?)\s*(?:%\s*)?(?:-|to)\s*(\d{1,3}(?:\.\d+)?)\s*%?/)
  if (range) {
    const lo = Number(range[1])
    const hi = Number(range[2])
    if (Number.isFinite(lo) && Number.isFinite(hi)) return { min: lo, max: hi }
  }

  const le = t.match(/(?:<=|≤|under|up to|maximum|max|below)\s*(\d{1,3}(?:\.\d+)?)\s*%?/)
  if (le) {
    const hi = Number(le[1])
    if (Number.isFinite(hi)) return { min: null, max: hi }
  }

  const ge = t.match(/(?:>=|≥|over|above|from|greater than)\s*(\d{1,3}(?:\.\d+)?)\s*%?/)
  if (ge) {
    const lo = Number(ge[1])
    if (Number.isFinite(lo)) return { min: lo, max: null }
  }

  const single = t.match(/(\d{1,3}(?:\.\d+)?)\s*%/)
  if (single) {
    const n = Number(single[1])
    if (Number.isFinite(n) && n <= 100) return { min: null, max: n }
  }

  return null
}

function parseLvrBounds(rate: JsonRecord): { min: number | null; max: number | null } {
  const constraints = asArray(rate.constraints).filter(isRecord)
  for (const c of constraints) {
    const t = pickText(c, ['constraintType']).toLowerCase()
    if (!t.includes('lvr')) continue
    const min = Number.isFinite(Number(c.minValue)) ? Number(c.minValue) : null
    const max = Number.isFinite(Number(c.maxValue)) ? Number(c.maxValue) : null
    if (min != null || max != null) return { min, max }
  }

  const tiers = asArray(rate.tiers).filter(isRecord)
  for (const tier of tiers) {
    const tierName = pickText(tier, ['name', 'unitOfMeasure', 'rateApplicationMethod']).toLowerCase()
    if (!tierName.includes('lvr') && !tierName.includes('loan to value')) continue
    const min = Number.isFinite(Number(tier.minimumValue)) ? Number(tier.minimumValue) : null
    const max = Number.isFinite(Number(tier.maximumValue)) ? Number(tier.maximumValue) : null
    if (min != null || max != null) return { min, max }
  }

  const additionalValue = getText(rate.additionalValue)
  if (additionalValue) {
    const fromAdditional = parseLvrFromText(additionalValue)
    if (fromAdditional) return fromAdditional
  }

  const additionalInfo = getText(rate.additionalInfo)
  if (additionalInfo) {
    const fromInfo = parseLvrFromText(additionalInfo)
    if (fromInfo) return fromInfo
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
    const fixedAmount = isRecord(fee.fixedAmount) ? fee.fixedAmount : null
    const amount =
      parseAnnualFee(fee.amount) ??
      parseAnnualFee(fee.additionalValue) ??
      parseAnnualFee(fixedAmount ? fixedAmount.amount : null)
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
  const productId = pickText(detail, ['productId', 'id'])
  const productName = normalizeProductName(pickText(detail, ['name', 'productName']))
  if (!productId || !productName || !isProductNameLikelyRateProduct(productName)) {
    return []
  }
  const rates = extractRatesArray(detail)
  const annualFee = parseAnnualFeeFromDetail(detail)
  const result: NormalizedRateRow[] = []
  const playbook = getLenderPlaybook(input.lender)

  for (const rate of rates) {
    const rawInterestValue = rate.rate ?? rate.interestRate ?? rate.value
    const interestRate = parseInterestRate(rawInterestValue)
    if (interestRate == null) {
      continue
    }
    if (interestRate < playbook.minRatePercent || interestRate > playbook.maxRatePercent) {
      continue
    }
    const comparisonRate = parseComparisonRate(rate.comparisonRate ?? rate.comparison ?? rate.comparison_value)
    const contextText = collectConstraintText(rate, detail)
    const lvr = parseLvrBounds(rate)
    const contextLower = contextText.toLowerCase()
    if (playbook.excludeKeywords.some((x) => contextLower.includes(x))) {
      continue
    }

    const lvrResult = normalizeLvrTier(contextText, lvr.min, lvr.max)

    let confidence = 0.95
    if (!comparisonRate) confidence -= 0.04
    if (lvrResult.wasDefault) confidence -= 0.05
    if (!contextLower.includes('loan')) confidence -= 0.02

    const lendingRateType = pickText(rate, ['lendingRateType'])
    const repaymentText = `${lendingRateType} ${pickText(rate, ['repaymentType'])} ${pickText(detail, ['repaymentType'])} ${contextText}`
    const rateStructureText = `${lendingRateType} ${pickText(rate, ['name'])} ${pickText(detail, ['name'])} ${contextText}`

    const rawPurpose = `${pickText(rate, ['loanPurpose'])} ${pickText(detail, ['loanPurpose'])}`.toLowerCase()
    const isBothPurpose = rawPurpose.includes('both')
    const purposes: Array<'owner_occupied' | 'investment'> = isBothPurpose
      ? ['owner_occupied', 'investment']
      : [normalizeSecurityPurpose(`${rawPurpose} ${contextText}`)]

    for (const securityPurpose of purposes) {
      const row: NormalizedRateRow = {
        bankName: normalizeBankName(input.lender.canonical_bank_name, input.lender.name),
        collectionDate: input.collectionDate,
        productId,
        productName,
        securityPurpose,
        repaymentType: normalizeRepaymentType(repaymentText),
        rateStructure: normalizeRateStructure(rateStructureText),
        lvrTier: lvrResult.tier,
        featureSet: normalizeFeatureSet(`${productName} ${contextText}`, annualFee),
        interestRate,
        comparisonRate,
        annualFee,
        sourceUrl: input.sourceUrl,
        dataQualityFlag: 'cdr_live',
        confidenceScore: Number(Math.max(0.6, Math.min(0.99, confidence)).toFixed(3)),
      }
      result.push(row)
    }
  }

  return result
}

type ProductListFetchResult = {
  productIds: string[]
  rawPayloads: Array<{ sourceUrl: string; status: number; body: string }>
}

export async function fetchResidentialMortgageProductIds(
  endpointUrl: string,
  pageLimit = 20,
  options?: { cdrVersions?: number[] },
): Promise<ProductListFetchResult> {
  const ids = new Set<string>()
  const payloads: Array<{ sourceUrl: string; status: number; body: string }> = []
  let url: string | null = endpointUrl
  let pages = 0
  const versions = options?.cdrVersions && options.cdrVersions.length > 0 ? options.cdrVersions : [6, 5, 4, 3]

  while (url && pages < pageLimit) {
    pages += 1
    const response = await fetchCdrJson(url, versions)
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
  cdrVersions?: number[]
}): Promise<{ rows: NormalizedRateRow[]; rawPayload: { sourceUrl: string; status: number; body: string } }> {
  const detailUrl = `${safeUrl(input.endpointUrl)}/${encodeURIComponent(input.productId)}`
  const versions = input.cdrVersions && input.cdrVersions.length > 0 ? input.cdrVersions : [6, 5, 4, 3]
  const fetched = await fetchCdrJson(detailUrl, versions)
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
