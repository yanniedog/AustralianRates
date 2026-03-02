import type { LenderConfig } from '../../types'
import { safeUrl } from './detail-metadata'
import { fetchCdrJson, fetchJson } from './http'
import { asArray, getText, isRecord, pickText, type JsonRecord } from './primitives'

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
