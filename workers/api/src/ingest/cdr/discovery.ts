import type { LenderConfig } from '../../types'
import { safeUrl } from './detail-metadata'
import { fetchCdrJson, fetchJson } from './http'
import type { FetchRequestContext } from './http'
import { asArray, getText, isRecord, pickText, type JsonRecord } from './primitives'

export type RegisterBrand = {
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

function tokenizeText(value: string): string[] {
  return getText(value)
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? []
}

function hostFromEndpoint(endpointUrl: string): string {
  try {
    return new URL(endpointUrl).host.toLowerCase()
  } catch {
    return ''
  }
}

function registrableHost(host: string): string {
  const parts = host.split('.').filter(Boolean)
  if (parts.length < 2) return host
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`
}

function hostAffinityScore(candidateEndpoint: string, configuredEndpoint?: string): number {
  if (!configuredEndpoint) return 0
  const candidateHost = hostFromEndpoint(candidateEndpoint)
  const configuredHost = hostFromEndpoint(configuredEndpoint)
  if (!candidateHost || !configuredHost) return 0
  if (candidateHost === configuredHost) return 1000
  if (candidateHost.endsWith(`.${configuredHost}`) || configuredHost.endsWith(`.${candidateHost}`)) return 400
  if (registrableHost(candidateHost) === registrableHost(configuredHost)) return 200
  return 0
}

export function brandMatchScore(lender: LenderConfig, brand: RegisterBrand): number {
  const haystackTokens = tokenizeText(`${brand.brandName} ${brand.legalEntityName}`)
  if (haystackTokens.length === 0) return 0
  const haystackTokenSet = new Set(haystackTokens)
  const haystackPhrase = ` ${haystackTokens.join(' ')} `
  const needles = [lender.register_brand_name, lender.canonical_bank_name]
  const lenderNameTokens = tokenizeText(lender.name)
  if (lenderNameTokens.length > 1 || lenderNameTokens.some((token) => token.length >= 4)) {
    needles.push(lender.name)
  }

  let best = 0
  for (const needle of needles) {
    const needleTokens = tokenizeText(needle)
    if (needleTokens.length === 0) continue

    const needlePhrase = ` ${needleTokens.join(' ')} `
    const phraseExact = haystackPhrase.includes(needlePhrase)
    const allTokensPresent = needleTokens.every((token) => haystackTokenSet.has(token))
    const singleTokenExact = needleTokens.length === 1 && haystackTokenSet.has(needleTokens[0])

    if (phraseExact) {
      best = Math.max(best, 100 + needleTokens.length * 5)
      continue
    }
    if (singleTokenExact) {
      best = Math.max(best, 60)
      continue
    }
    if (allTokensPresent && needleTokens.length > 1) {
      best = Math.max(best, 40 + needleTokens.length * 3)
    }
  }

  return best
}

export function selectBestMatchingBrand(lender: LenderConfig, brands: RegisterBrand[]): RegisterBrand | null {
  let best: { brand: RegisterBrand; score: number } | null = null
  for (const brand of brands) {
    const matchScore = brandMatchScore(lender, brand)
    if (matchScore <= 0) continue
    const score = matchScore + hostAffinityScore(brand.endpointUrl, lender.products_endpoint)
    if (!best || score > best.score) {
      best = { brand, score }
    }
  }
  return best?.brand ?? null
}

export async function discoverProductsEndpoint(
  lender: LenderConfig,
  context?: FetchRequestContext,
): Promise<{ endpointUrl: string; sourceUrl: string; status: number; notes: string } | null> {
  const registerUrls = [
    'https://api.cdr.gov.au/cdr-register/v1/all/data-holders/brands/summary',
    'https://api.cdr.gov.au/cdr-register/v1/banking/data-holders/brands',
    'https://api.cdr.gov.au/cdr-register/v1/banking/register',
  ]

  for (const registerUrl of registerUrls) {
    const fetched = registerUrl.includes('/all/data-holders/brands/summary')
      ? await fetchCdrJson(registerUrl, [1, 2, 3, 4, 5, 6], {
          ...context,
          sourceName: 'cdr_discovery',
        })
      : await fetchJson(registerUrl, {
          ...context,
          sourceName: 'cdr_discovery',
        })
    if (!fetched.ok) {
      continue
    }
    const brands = extractBrands(fetched.data)
    const hit = selectBestMatchingBrand(lender, brands)
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
