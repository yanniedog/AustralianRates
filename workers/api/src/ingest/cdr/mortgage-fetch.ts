import type { EnvBindings, LenderConfig } from '../../types'
import { safeUrl } from './detail-metadata'
import { extractProducts, nextLink } from './discovery'
import { fetchCdrJson } from './http'
import { isRecord, pickText, type JsonRecord } from './primitives'
import { isResidentialMortgage, parseRatesFromDetail } from './mortgage-parse'
import type { NormalizedRateRow } from '../normalize'

type FetchEnvBindings = Pick<
  EnvBindings,
  'FETCH_TIMEOUT_MS' | 'FETCH_MAX_RETRIES' | 'FETCH_RETRY_BASE_MS' | 'FETCH_RETRY_CAP_MS'
>

type ProductListFetchResult = {
  productIds: string[]
  rawPayloads: Array<{ sourceUrl: string; status: number; body: string }>
  pagesFetched: number
  pageLimitHit: boolean
  nextUrl: string | null
}

export async function fetchResidentialMortgageProductIds(
  endpointUrl: string,
  pageLimit = 20,
  options?: { cdrVersions?: number[]; env?: FetchEnvBindings; runId?: string; lenderCode?: string },
): Promise<ProductListFetchResult> {
  const ids = new Set<string>()
  const payloads: Array<{ sourceUrl: string; status: number; body: string }> = []
  let url: string | null = endpointUrl
  let pages = 0
  const visitedUrls = new Set<string>()
  const versions = options?.cdrVersions && options.cdrVersions.length > 0 ? options.cdrVersions : [6, 5, 4, 3]

  while (url && pages < pageLimit) {
    if (visitedUrls.has(url)) break
    visitedUrls.add(url)
    pages += 1
    const response = await fetchCdrJson(url, versions, {
      env: options?.env,
      runId: options?.runId,
      lenderCode: options?.lenderCode,
      sourceName: 'cdr_products_index',
    })
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

export async function fetchProductDetailRows(input: {
  lender: LenderConfig
  endpointUrl: string
  productId: string
  collectionDate: string
  cdrVersions?: number[]
  env?: FetchEnvBindings
  runId?: string
  lenderCode?: string
}): Promise<{ rows: NormalizedRateRow[]; rawPayload: { sourceUrl: string; status: number; body: string } }> {
  const detailUrl = `${safeUrl(input.endpointUrl)}/${encodeURIComponent(input.productId)}`
  const versions = input.cdrVersions && input.cdrVersions.length > 0 ? input.cdrVersions : [6, 5, 4, 3]
  const fetched = await fetchCdrJson(detailUrl, versions, {
    env: input.env,
    runId: input.runId,
    lenderCode: input.lenderCode,
    sourceName: 'cdr_product_detail',
  })
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
    }).map((row) => ({
      ...row,
      cdrProductDetailJson: fetched.text || null,
    })),
    rawPayload,
  }
}
