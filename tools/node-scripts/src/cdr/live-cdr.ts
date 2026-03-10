import fs from 'node:fs'
import path from 'node:path'
import lendersConfig from '../../../../workers/api/config/lenders.json'
import { fetchProductDetailRows, fetchResidentialMortgageProductIds } from '../../../../workers/api/src/ingest/cdr/mortgage-fetch'
import { fetchSavingsProductDetailRows, fetchSavingsProductIds, fetchTdProductDetailRows, fetchTermDepositProductIds } from '../../../../workers/api/src/ingest/cdr-savings'
import { configuredProductEndpoints } from '../../../../workers/api/src/ingest/product-endpoints'
import { validateNormalizedRow, type NormalizedRateRow } from '../../../../workers/api/src/ingest/normalize'
import { validateNormalizedSavingsRow, validateNormalizedTdRow, type NormalizedSavingsRow, type NormalizedTdRow } from '../../../../workers/api/src/ingest/normalize-savings'
import { homeLoanSeriesKey, savingsSeriesKey, tdSeriesKey } from '../../../../workers/api/src/utils/series-identity'
import type { LenderConfig } from '../../../../workers/api/src/types'

export type DatasetKind = 'home_loans' | 'savings' | 'term_deposits'

export type LiveCdrRows = {
  home_loans: NormalizedRateRow[]
  savings: NormalizedSavingsRow[]
  term_deposits: NormalizedTdRow[]
}

export type LiveCdrSummary = {
  lender: LenderConfig
  collectionDate: string
  rows: LiveCdrRows
  product_counts: Record<DatasetKind, number>
}

type DetailResult<T> = {
  rows: T[]
  productIds: string[]
}

function repoRoot(): string {
  return path.resolve(__dirname, '../../../../')
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function dedupeByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const out = new Map<string, T>()
  for (const row of rows) {
    const key = keyOf(row)
    if (!key) continue
    out.set(key, row)
  }
  return Array.from(out.values())
}

async function mapLimit<T, R>(values: T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let index = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, values.length || 1)) }, async () => {
    while (true) {
      const current = index
      index += 1
      if (current >= values.length) return
      out[current] = await fn(values[current])
    }
  })
  await Promise.all(workers)
  return out
}

function lenderByCode(lenderCode: string): LenderConfig {
  const lender = lendersConfig.lenders.find((item) => item.code === lenderCode)
  if (!lender) throw new Error(`unknown_lender_code:${lenderCode}`)
  return lender as LenderConfig
}

async function fetchHomeRows(lender: LenderConfig, collectionDate: string): Promise<DetailResult<NormalizedRateRow>> {
  const productMap = new Map<string, string>()
  for (const endpointUrl of configuredProductEndpoints({ products_endpoint: lender.products_endpoint, additional_products_endpoints: lender.additional_products_endpoints })) {
    const discovered = await fetchResidentialMortgageProductIds(endpointUrl)
    for (const productId of discovered.productIds) {
      if (!productMap.has(productId)) productMap.set(productId, endpointUrl)
    }
  }
  const productIds = Array.from(productMap.keys())
  const results = await mapLimit(productIds, 5, async (productId) => {
    const endpointUrl = productMap.get(productId)
    if (!endpointUrl) return [] as NormalizedRateRow[]
    const detail = await fetchProductDetailRows({
      lender,
      endpointUrl,
      productId,
      collectionDate,
    })
    return detail.rows
  })
  const rows = dedupeByKey(results.flat(), (row) => homeLoanSeriesKey(row))
  for (const row of rows) {
    const verdict = validateNormalizedRow(row)
    if (!verdict.ok) throw new Error(`invalid_home_row:${row.productId}:${verdict.reason}`)
  }
  return { rows, productIds }
}

async function fetchSavingsRows(lender: LenderConfig, collectionDate: string): Promise<DetailResult<NormalizedSavingsRow>> {
  const productMap = new Map<string, string>()
  for (const endpointUrl of configuredProductEndpoints({ products_endpoint: lender.products_endpoint, additional_products_endpoints: lender.additional_products_endpoints })) {
    const discovered = await fetchSavingsProductIds(endpointUrl)
    for (const productId of discovered.productIds) {
      if (!productMap.has(productId)) productMap.set(productId, endpointUrl)
    }
  }
  const productIds = Array.from(productMap.keys())
  const results = await mapLimit(productIds, 5, async (productId) => {
    const endpointUrl = productMap.get(productId)
    if (!endpointUrl) return [] as NormalizedSavingsRow[]
    const detail = await fetchSavingsProductDetailRows({
      lender,
      endpointUrl,
      productId,
      collectionDate,
    })
    return detail.savingsRows
  })
  const rows = dedupeByKey(results.flat(), (row) => savingsSeriesKey(row))
  for (const row of rows) {
    const verdict = validateNormalizedSavingsRow(row)
    if (!verdict.ok) throw new Error(`invalid_savings_row:${row.productId}:${verdict.reason}`)
  }
  return { rows, productIds }
}

async function fetchTdRows(lender: LenderConfig, collectionDate: string): Promise<DetailResult<NormalizedTdRow>> {
  const productMap = new Map<string, string>()
  for (const endpointUrl of configuredProductEndpoints({ products_endpoint: lender.products_endpoint, additional_products_endpoints: lender.additional_products_endpoints })) {
    const discovered = await fetchTermDepositProductIds(endpointUrl)
    for (const productId of discovered.productIds) {
      if (!productMap.has(productId)) productMap.set(productId, endpointUrl)
    }
  }
  const productIds = Array.from(productMap.keys())
  const results = await mapLimit(productIds, 5, async (productId) => {
    const endpointUrl = productMap.get(productId)
    if (!endpointUrl) return [] as NormalizedTdRow[]
    const detail = await fetchTdProductDetailRows({
      lender,
      endpointUrl,
      productId,
      collectionDate,
    })
    return detail.tdRows
  })
  const rows = dedupeByKey(results.flat(), (row) => tdSeriesKey(row))
  for (const row of rows) {
    const verdict = validateNormalizedTdRow(row)
    if (!verdict.ok) throw new Error(`invalid_td_row:${row.productId}:${verdict.reason}`)
  }
  return { rows, productIds }
}

function readEnvToken(keys: string[]): string {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim()
    if (value) return value
  }

  const envPath = path.join(repoRoot(), '.env')
  if (!fs.existsSync(envPath)) return ''
  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/)
    if (!match) continue
    if (!keys.includes(match[1])) continue
    return match[2].replace(/^["']|["']$/g, '').trim()
  }
  return ''
}

export async function fetchLiveCdrSummary(input: {
  lenderCode: string
  collectionDate: string
  datasets?: DatasetKind[]
}): Promise<LiveCdrSummary> {
  const lender = lenderByCode(input.lenderCode)
  const enabled = new Set(input.datasets && input.datasets.length > 0 ? input.datasets : ['home_loans', 'savings', 'term_deposits'])
  const [home, savings, td] = await Promise.all([
    enabled.has('home_loans') ? fetchHomeRows(lender, input.collectionDate) : Promise.resolve({ rows: [], productIds: [] }),
    enabled.has('savings') ? fetchSavingsRows(lender, input.collectionDate) : Promise.resolve({ rows: [], productIds: [] }),
    enabled.has('term_deposits') ? fetchTdRows(lender, input.collectionDate) : Promise.resolve({ rows: [], productIds: [] }),
  ])

  return {
    lender,
    collectionDate: input.collectionDate,
    rows: {
      home_loans: home.rows,
      savings: savings.rows,
      term_deposits: td.rows,
    },
    product_counts: {
      home_loans: home.productIds.length,
      savings: savings.productIds.length,
      term_deposits: td.productIds.length,
    },
  }
}

export function readAdminToken(): string {
  return readEnvToken(['ADMIN_API_TOKEN', 'ADMIN_TEST_TOKEN'])
}

export function configuredLenderCodes(): string[] {
  return uniqueStrings(lendersConfig.lenders.map((item) => item.code))
}
