import { normalizeBankName, normalizeProductName } from './normalize'
import {
  normalizeAccountType,
  normalizeDepositRateType,
  normalizeDepositTier,
  normalizeInterestPayment,
  parseSavingsInterestRate,
  parseTermMonths,
  type NormalizedSavingsRow,
  type NormalizedTdRow,
} from './normalize-savings'
import {
  asArray,
  extractProducts,
  fetchCdrJson,
  getText,
  isRecord,
  nextLink,
  pickText,
  type JsonRecord,
} from './cdr'
import type { LenderConfig } from '../types'

export function isSavingsAccount(product: JsonRecord): boolean {
  const category = pickText(product, ['productCategory', 'category', 'type']).toUpperCase()
  const name = pickText(product, ['name', 'productName']).toUpperCase()
  if (category.includes('TRANS_AND_SAVINGS') || category.includes('SAVINGS')) return true
  if (name.includes('SAVINGS') || name.includes('SAVER') || name.includes('AT CALL')) return true
  return false
}

export function isTermDeposit(product: JsonRecord): boolean {
  const category = pickText(product, ['productCategory', 'category', 'type']).toUpperCase()
  const name = pickText(product, ['name', 'productName']).toUpperCase()
  if (category.includes('TERM_DEPOSIT')) return true
  if (name.includes('TERM DEPOSIT') || name.includes('FIXED DEPOSIT')) return true
  return false
}

function extractDepositRatesArray(detail: JsonRecord): JsonRecord[] {
  const arrays = [detail.depositRates, detail.rates, detail.rateTiers, detail.rate]
  for (const candidate of arrays) {
    const arr = asArray(candidate).filter(isRecord)
    if (arr.length > 0) return arr
  }
  return []
}

function parseTierBounds(rate: JsonRecord): { min: number | null; max: number | null } {
  const tiers = asArray(rate.tiers).filter(isRecord)
  for (const tier of tiers) {
    const unitOfMeasure = getText(tier.unitOfMeasure).toUpperCase()
    if (unitOfMeasure && unitOfMeasure !== 'DOLLAR' && unitOfMeasure !== 'AMOUNT') continue
    const min = Number.isFinite(Number(tier.minimumValue)) ? Number(tier.minimumValue) : null
    const max = Number.isFinite(Number(tier.maximumValue)) ? Number(tier.maximumValue) : null
    if (min != null || max != null) return { min, max }
  }
  return { min: null, max: null }
}

function collectConditionsText(rate: JsonRecord, detail: JsonRecord): string {
  const parts: string[] = []
  const info = getText(rate.additionalInfo)
  if (info) parts.push(info)
  const value = getText(rate.additionalValue)
  if (value && !value.match(/^P\d+[DMYW]$/)) parts.push(value)
  const desc = getText(detail.description)
  if (desc && desc.length < 300) parts.push(desc)
  return parts.filter(Boolean).join(' | ')
}

function parseMonthlyFeeFromDetail(detail: JsonRecord): number | null {
  const fees = asArray(detail.fees).filter(isRecord)
  for (const fee of fees) {
    const feeType = pickText(fee, ['feeType', 'name']).toLowerCase()
    if (!feeType.includes('monthly') && !feeType.includes('service')) continue
    const amount = Number(fee.amount ?? fee.additionalValue)
    if (Number.isFinite(amount) && amount >= 0 && amount <= 50) return amount
  }
  return null
}

export function parseSavingsRatesFromDetail(input: {
  lender: LenderConfig
  detail: JsonRecord
  sourceUrl: string
  collectionDate: string
}): NormalizedSavingsRow[] {
  const { detail, lender, sourceUrl, collectionDate } = input
  const productId = pickText(detail, ['productId', 'id'])
  const productName = normalizeProductName(pickText(detail, ['name', 'productName']))
  if (!productId || !productName) return []

  const rates = extractDepositRatesArray(detail)
  if (rates.length === 0) return []

  const monthlyFee = parseMonthlyFeeFromDetail(detail)
  const result: NormalizedSavingsRow[] = []
  const accountType = normalizeAccountType(`${productName} ${pickText(detail, ['description', 'productCategory'])}`)

  for (const rate of rates) {
    const depositRateType = getText(rate.depositRateType || rate.rateType || rate.type)
    const rateType = normalizeDepositRateType(depositRateType)
    const interestRate = parseSavingsInterestRate(rate.rate ?? rate.interestRate ?? rate.value)
    if (interestRate == null) continue

    const bounds = parseTierBounds(rate)
    const depositTier = normalizeDepositTier(bounds.min, bounds.max)
    const conditions = collectConditionsText(rate, detail)

    let confidence = 0.93
    if (!conditions) confidence -= 0.03

    result.push({
      bankName: normalizeBankName(lender.canonical_bank_name, lender.name),
      collectionDate,
      productId,
      productName,
      accountType,
      rateType,
      interestRate,
      depositTier,
      minBalance: bounds.min,
      maxBalance: bounds.max,
      conditions: conditions || null,
      monthlyFee,
      sourceUrl,
      dataQualityFlag: 'cdr_live',
      confidenceScore: Number(Math.max(0.6, Math.min(0.99, confidence)).toFixed(3)),
    })
  }

  return result
}

export function parseTermDepositRatesFromDetail(input: {
  lender: LenderConfig
  detail: JsonRecord
  sourceUrl: string
  collectionDate: string
}): NormalizedTdRow[] {
  const { detail, lender, sourceUrl, collectionDate } = input
  const productId = pickText(detail, ['productId', 'id'])
  const productName = normalizeProductName(pickText(detail, ['name', 'productName']))
  if (!productId || !productName) return []

  const rates = extractDepositRatesArray(detail)
  if (rates.length === 0) return []

  const result: NormalizedTdRow[] = []

  for (const rate of rates) {
    const interestRate = parseSavingsInterestRate(rate.rate ?? rate.interestRate ?? rate.value)
    if (interestRate == null) continue

    const additionalValue = getText(rate.additionalValue)
    const termMonths = parseTermMonths(additionalValue) ?? parseTermMonths(getText(rate.name)) ?? parseTermMonths(productName)
    if (termMonths == null || termMonths < 1) continue

    const bounds = parseTierBounds(rate)
    const depositTier = normalizeDepositTier(bounds.min, bounds.max)
    const paymentText = `${getText(rate.applicationFrequency)} ${getText(rate.additionalInfo)}`
    const interestPayment = normalizeInterestPayment(paymentText)

    let confidence = 0.93
    if (!additionalValue) confidence -= 0.03

    result.push({
      bankName: normalizeBankName(lender.canonical_bank_name, lender.name),
      collectionDate,
      productId,
      productName,
      termMonths,
      interestRate,
      depositTier,
      minDeposit: bounds.min,
      maxDeposit: bounds.max,
      interestPayment,
      sourceUrl,
      dataQualityFlag: 'cdr_live',
      confidenceScore: Number(Math.max(0.6, Math.min(0.99, confidence)).toFixed(3)),
    })
  }

  return result
}

type ProductListFetchResult = {
  productIds: string[]
  rawPayloads: Array<{ sourceUrl: string; status: number; body: string }>
}

export async function fetchSavingsProductIds(
  endpointUrl: string,
  pageLimit = 20,
  options?: { cdrVersions?: number[] },
): Promise<ProductListFetchResult> {
  const ids = new Set<string>()
  const payloads: Array<{ sourceUrl: string; status: number; body: string }> = []
  let url: string | null = endpointUrl
  let pages = 0
  const versions = options?.cdrVersions?.length ? options.cdrVersions : [6, 5, 4, 3]

  while (url && pages < pageLimit) {
    pages += 1
    const response = await fetchCdrJson(url, versions)
    payloads.push({ sourceUrl: url, status: response.status, body: response.text })
    if (!response.ok || !response.data) break

    const products = extractProducts(response.data)
    for (const product of products) {
      if (!isSavingsAccount(product)) continue
      const id = pickText(product, ['productId', 'id'])
      if (id) ids.add(id)
    }
    url = nextLink(response.data)
  }

  return { productIds: Array.from(ids), rawPayloads: payloads }
}

export async function fetchTermDepositProductIds(
  endpointUrl: string,
  pageLimit = 20,
  options?: { cdrVersions?: number[] },
): Promise<ProductListFetchResult> {
  const ids = new Set<string>()
  const payloads: Array<{ sourceUrl: string; status: number; body: string }> = []
  let url: string | null = endpointUrl
  let pages = 0
  const versions = options?.cdrVersions?.length ? options.cdrVersions : [6, 5, 4, 3]

  while (url && pages < pageLimit) {
    pages += 1
    const response = await fetchCdrJson(url, versions)
    payloads.push({ sourceUrl: url, status: response.status, body: response.text })
    if (!response.ok || !response.data) break

    const products = extractProducts(response.data)
    for (const product of products) {
      if (!isTermDeposit(product)) continue
      const id = pickText(product, ['productId', 'id'])
      if (id) ids.add(id)
    }
    url = nextLink(response.data)
  }

  return { productIds: Array.from(ids), rawPayloads: payloads }
}

export async function fetchSavingsProductDetailRows(input: {
  lender: LenderConfig
  endpointUrl: string
  productId: string
  collectionDate: string
  cdrVersions?: number[]
}): Promise<{ savingsRows: NormalizedSavingsRow[]; rawPayload: { sourceUrl: string; status: number; body: string } }> {
  const detailUrl = `${input.endpointUrl.replace(/\/+$/, '')}/${encodeURIComponent(input.productId)}`
  const versions = input.cdrVersions?.length ? input.cdrVersions : [6, 5, 4, 3]
  const fetched = await fetchCdrJson(detailUrl, versions)
  const rawPayload = { sourceUrl: detailUrl, status: fetched.status, body: fetched.text }

  if (!fetched.ok || !isRecord(fetched.data)) return { savingsRows: [], rawPayload }

  const detail = isRecord((fetched.data as JsonRecord).data)
    ? ((fetched.data as JsonRecord).data as JsonRecord)
    : (fetched.data as JsonRecord)

  return {
    savingsRows: parseSavingsRatesFromDetail({
      lender: input.lender,
      detail,
      sourceUrl: detailUrl,
      collectionDate: input.collectionDate,
    }),
    rawPayload,
  }
}

export async function fetchTdProductDetailRows(input: {
  lender: LenderConfig
  endpointUrl: string
  productId: string
  collectionDate: string
  cdrVersions?: number[]
}): Promise<{ tdRows: NormalizedTdRow[]; rawPayload: { sourceUrl: string; status: number; body: string } }> {
  const detailUrl = `${input.endpointUrl.replace(/\/+$/, '')}/${encodeURIComponent(input.productId)}`
  const versions = input.cdrVersions?.length ? input.cdrVersions : [6, 5, 4, 3]
  const fetched = await fetchCdrJson(detailUrl, versions)
  const rawPayload = { sourceUrl: detailUrl, status: fetched.status, body: fetched.text }

  if (!fetched.ok || !isRecord(fetched.data)) return { tdRows: [], rawPayload }

  const detail = isRecord((fetched.data as JsonRecord).data)
    ? ((fetched.data as JsonRecord).data as JsonRecord)
    : (fetched.data as JsonRecord)

  return {
    tdRows: parseTermDepositRatesFromDetail({
      lender: input.lender,
      detail,
      sourceUrl: detailUrl,
      collectionDate: input.collectionDate,
    }),
    rawPayload,
  }
}
