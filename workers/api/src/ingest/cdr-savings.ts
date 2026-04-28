import { normalizeBankName, normalizeProductName } from './normalize.js'
import {
  normalizeAccountType,
  normalizeDepositRateType,
  normalizeDepositTier,
  normalizeInterestPayment,
  parseSavingsInterestRate,
  parseTermMonths,
  type NormalizedSavingsRow,
  type NormalizedTdRow,
} from './normalize-savings.js'
import {
  asArray,
  extractProducts,
  fetchCdrJson,
  getText,
  isRecord,
  nextLink,
  pickText,
  productUrlFromDetail,
  publishedAtFromDetail,
  type JsonRecord,
} from './cdr.js'
import { isCdrSavingsProduct, isCdrTermDepositProduct } from './cdr/product-classification.js'
import type { FetchJsonResult } from './cdr/http.js'
import type { EnvBindings, LenderConfig } from '../types.js'

type FetchEnvBindings = Pick<
  EnvBindings,
  'FETCH_TIMEOUT_MS' | 'FETCH_MAX_RETRIES' | 'FETCH_RETRY_BASE_MS' | 'FETCH_RETRY_CAP_MS'
>

export function isSavingsAccount(product: JsonRecord): boolean {
  return isCdrSavingsProduct(product, { allowNameFallback: true })
}

export function isTermDeposit(product: JsonRecord): boolean {
  return isCdrTermDepositProduct(product, { allowNameFallback: true })
}

/**
 * Macquarie exposes a business TD (BB001…) in the product list, but the CDR detail payload has no
 * depositRates / rates, so ingestion yields zero rows. Exclude at index so expected_detail_count matches
 * the retail TD (TD001…) that carries rate tiers.
 */
export function includeTermDepositIndexProduct(product: JsonRecord, lenderCode?: string): boolean {
  if (!isTermDeposit(product)) return false
  const code = String(lenderCode || '').trim().toLowerCase()
  if (code === 'macquarie') {
    const productId = pickText(product, ['productId', 'id'])
    if (excludeMacquarieBusinessTermDepositProductId(productId)) return false
    const name = pickText(product, ['name', 'productName']).toUpperCase()
    if (name.includes('BUSINESS BANKING')) return false
  }
  return true
}

/** Aligns with {@link includeTermDepositIndexProduct}: catalog supplements must not re-add excluded business TD IDs. */
export function excludeMacquarieBusinessTermDepositProductId(productId: string): boolean {
  const id = String(productId || '').trim().toUpperCase()
  return id.startsWith('BB') && id.includes('MBLTDA')
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

function isBonusOnlyTermDepositRate(rate: JsonRecord, interestRate: number): boolean {
  const additionalInfo = getText(rate.additionalInfo).toLowerCase()
  const additionalValue = getText(rate.additionalValue).toLowerCase()
  const depositRateType = getText(rate.depositRateType || rate.rateType || rate.type).toLowerCase()
  const applicabilityText = `${getText(rate.rateApplicabilityType)} ${getText(rate.applicationType)}`.toLowerCase()
  const bonusHint =
    depositRateType.includes('bonus') ||
    additionalInfo.includes('online bonus') ||
    (additionalInfo.includes('bonus') && additionalInfo.includes('additional')) ||
    (additionalValue.includes('bonus') && additionalValue.includes('additional'))
  const onlineHint = applicabilityText.includes('online') || additionalInfo.includes('online')
  const maturityHint = applicabilityText.includes('maturity')
  return bonusHint && onlineHint && maturityHint && interestRate <= 0.5
}

function parseMonthlyFeeFromDetail(detail: JsonRecord): number | null {
  const fees = asArray(detail.fees).filter(isRecord)
  for (const fee of fees) {
    const feeText = `${pickText(fee, ['feeType'])} ${pickText(fee, ['name'])} ${pickText(fee, ['additionalInfo'])}`.toLowerCase()
    if (!feeText.includes('monthly') && !feeText.includes('service')) continue
    const fixedAmount = isRecord(fee.fixedAmount) ? fee.fixedAmount : null
    const additionalValue = getText(fee.additionalValue)
    const rawAmount =
      fee.amount ??
      fixedAmount?.amount ??
      (/^p\d/i.test(additionalValue) ? null : additionalValue)
    const amount = Number(rawAmount)
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
  if (!productId || !productName || !isCdrSavingsProduct(detail, { allowNameFallback: true })) return []

  const rates = extractDepositRatesArray(detail)
  if (rates.length === 0) return []

  const monthlyFee = parseMonthlyFeeFromDetail(detail)
  const productUrl = productUrlFromDetail(detail, sourceUrl)
  const publishedAt = publishedAtFromDetail(detail)
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
      productUrl,
      publishedAt,
      dataQualityFlag: 'cdr_live',
      confidenceScore: Number(Math.max(0.6, Math.min(0.99, confidence)).toFixed(3)),
      retrievalType: 'present_scrape_same_date',
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
  if (!productId || !productName || !isCdrTermDepositProduct(detail, { allowNameFallback: true })) return []

  const rates = extractDepositRatesArray(detail)
  if (rates.length === 0) return []

  const productUrl = productUrlFromDetail(detail, sourceUrl)
  const publishedAt = publishedAtFromDetail(detail)
  const result: NormalizedTdRow[] = []

  for (const rate of rates) {
    const interestRate = parseSavingsInterestRate(rate.rate ?? rate.interestRate ?? rate.value)
    if (interestRate == null) continue
    if (isBonusOnlyTermDepositRate(rate, interestRate)) continue

    const additionalValue = getText(rate.additionalValue)
    const termMonths = parseTermMonths(additionalValue) ?? parseTermMonths(getText(rate.name)) ?? parseTermMonths(productName)
    if (termMonths == null || termMonths < 1) continue

    const bounds = parseTierBounds(rate)
    const depositTier = normalizeDepositTier(bounds.min, bounds.max)
    const paymentText = `${getText(rate.applicationFrequency)} ${getText(rate.additionalInfo)}`
    const interestPayment = normalizeInterestPayment({
      text: paymentText,
      applicationType: getText(rate.applicationType),
      applicationFrequency: getText(rate.applicationFrequency),
      termMonths,
    })

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
      productUrl,
      publishedAt,
      dataQualityFlag: 'cdr_live',
      confidenceScore: Number(Math.max(0.6, Math.min(0.99, confidence)).toFixed(3)),
      retrievalType: 'present_scrape_same_date',
    })
  }

  return result
}

type ProductListFetchResult = {
  productIds: string[]
  rawPayloads: Array<{ sourceUrl: string; status: number; body: string }>
  pagesFetched: number
  pageLimitHit: boolean
  nextUrl: string | null
}

export async function fetchSavingsProductIds(
  endpointUrl: string,
  pageLimit = 20,
  options?: { cdrVersions?: number[]; env?: FetchEnvBindings; runId?: string; lenderCode?: string },
): Promise<ProductListFetchResult> {
  const ids = new Set<string>()
  const payloads: Array<{ sourceUrl: string; status: number; body: string }> = []
  let url: string | null = endpointUrl
  let pages = 0
  const visitedUrls = new Set<string>()
  const versions = options?.cdrVersions?.length ? options.cdrVersions : [6, 5, 4, 3]

  while (url && pages < pageLimit) {
    if (visitedUrls.has(url)) break
    visitedUrls.add(url)
    pages += 1
    const response: FetchJsonResult = await fetchCdrJson(url, versions, {
      env: options?.env,
      runId: options?.runId,
      lenderCode: options?.lenderCode,
      sourceName: 'cdr_savings_index',
    })
    payloads.push({ sourceUrl: url, status: response.status, body: response.text })
    if (!response.ok || !response.data) break

    const products = extractProducts(response.data)
    for (const product of products) {
      if (!isSavingsAccount(product)) continue
      const id = pickText(product, ['productId', 'id'])
      if (id) ids.add(id)
    }
    const next: string | null = nextLink(response.data)
    if (next && visitedUrls.has(next)) {
      url = null
      break
    }
    url = next
  }

  return {
    productIds: Array.from(ids),
    rawPayloads: payloads,
    pagesFetched: pages,
    pageLimitHit: Boolean(url && pages >= pageLimit),
    nextUrl: url,
  }
}

export async function fetchTermDepositProductIds(
  endpointUrl: string,
  pageLimit = 20,
  options?: { cdrVersions?: number[]; env?: FetchEnvBindings; runId?: string; lenderCode?: string },
): Promise<ProductListFetchResult> {
  const ids = new Set<string>()
  const payloads: Array<{ sourceUrl: string; status: number; body: string }> = []
  let url: string | null = endpointUrl
  let pages = 0
  const visitedUrls = new Set<string>()
  const versions = options?.cdrVersions?.length ? options.cdrVersions : [6, 5, 4, 3]

  while (url && pages < pageLimit) {
    if (visitedUrls.has(url)) break
    visitedUrls.add(url)
    pages += 1
    const response: FetchJsonResult = await fetchCdrJson(url, versions, {
      env: options?.env,
      runId: options?.runId,
      lenderCode: options?.lenderCode,
      sourceName: 'cdr_td_index',
    })
    payloads.push({ sourceUrl: url, status: response.status, body: response.text })
    if (!response.ok || !response.data) break

    const products = extractProducts(response.data)
    for (const product of products) {
      if (!includeTermDepositIndexProduct(product, options?.lenderCode)) continue
      const id = pickText(product, ['productId', 'id'])
      if (id) ids.add(id)
    }
    const next = nextLink(response.data)
    if (next && visitedUrls.has(next)) {
      url = null
      break
    }
    url = next
  }

  return {
    productIds: Array.from(ids),
    rawPayloads: payloads,
    pagesFetched: pages,
    pageLimitHit: Boolean(url && pages >= pageLimit),
    nextUrl: url,
  }
}

export async function fetchSavingsProductDetailRows(input: {
  lender: LenderConfig
  endpointUrl: string
  productId: string
  collectionDate: string
  cdrVersions?: number[]
  env?: FetchEnvBindings
  runId?: string
  lenderCode?: string
}): Promise<{ ok: boolean; savingsRows: NormalizedSavingsRow[]; rawPayload: { sourceUrl: string; status: number; body: string } }> {
  const detailUrl = `${input.endpointUrl.replace(/\/+$/, '')}/${encodeURIComponent(input.productId)}`
  const versions = input.cdrVersions?.length ? input.cdrVersions : [6, 5, 4, 3]
  const fetched = await fetchCdrJson(detailUrl, versions, {
    env: input.env,
    runId: input.runId,
    lenderCode: input.lenderCode,
    sourceName: 'cdr_savings_detail',
  })
  const rawPayload = { sourceUrl: detailUrl, status: fetched.status, body: fetched.text }

  if (!fetched.ok || !isRecord(fetched.data)) return { ok: false, savingsRows: [], rawPayload }

  const detail = isRecord((fetched.data as JsonRecord).data)
    ? ((fetched.data as JsonRecord).data as JsonRecord)
    : (fetched.data as JsonRecord)

  return {
    ok: true,
    savingsRows: parseSavingsRatesFromDetail({
      lender: input.lender,
      detail,
      sourceUrl: detailUrl,
      collectionDate: input.collectionDate,
    }).map((row) => ({
      ...row,
      cdrProductDetailJson: fetched.text || null,
    })),
    rawPayload,
  }
}

export async function fetchTdProductDetailRows(input: {
  lender: LenderConfig
  endpointUrl: string
  productId: string
  collectionDate: string
  cdrVersions?: number[]
  env?: FetchEnvBindings
  runId?: string
  lenderCode?: string
}): Promise<{ ok: boolean; tdRows: NormalizedTdRow[]; rawPayload: { sourceUrl: string; status: number; body: string } }> {
  const detailUrl = `${input.endpointUrl.replace(/\/+$/, '')}/${encodeURIComponent(input.productId)}`
  const versions = input.cdrVersions?.length ? input.cdrVersions : [6, 5, 4, 3]
  const fetched = await fetchCdrJson(detailUrl, versions, {
    env: input.env,
    runId: input.runId,
    lenderCode: input.lenderCode,
    sourceName: 'cdr_td_detail',
  })
  const rawPayload = { sourceUrl: detailUrl, status: fetched.status, body: fetched.text }

  if (!fetched.ok || !isRecord(fetched.data)) return { ok: false, tdRows: [], rawPayload }

  const detail = isRecord((fetched.data as JsonRecord).data)
    ? ((fetched.data as JsonRecord).data as JsonRecord)
    : (fetched.data as JsonRecord)

  return {
    ok: true,
    tdRows: parseTermDepositRatesFromDetail({
      lender: input.lender,
      detail,
      sourceUrl: detailUrl,
      collectionDate: input.collectionDate,
    }).map((row) => ({
      ...row,
      cdrProductDetailJson: fetched.text || null,
    })),
    rawPayload,
  }
}
