import { extractProducts, isRecord, type JsonRecord } from './cdr'
import {
  isSavingsAccount,
  isTermDeposit,
  parseSavingsRatesFromDetail,
  parseTermDepositRatesFromDetail,
} from './cdr-savings'
import { extractLenderRatesFromHtml } from './html-rate-parser'
import type { NormalizedRateRow } from './normalize'
import type { NormalizedSavingsRow, NormalizedTdRow } from './normalize-savings'
import type { LenderConfig } from '../types'

type CdxRow = { timestamp: string; original: string }

export type HistoricalCollectPayload = {
  sourceUrl: string
  status: number
  payload: string
  notes: string
}

export type HistoricalCollectCounters = {
  cdx_requests: number
  snapshot_requests: number
  mortgage_rows: number
  savings_rows: number
  td_rows: number
}

export type HistoricalCollectResult = {
  mortgageRows: NormalizedRateRow[]
  savingsRows: NormalizedSavingsRow[]
  tdRows: NormalizedTdRow[]
  hadSignals: boolean
  payloads: HistoricalCollectPayload[]
  counters: HistoricalCollectCounters
}

function parseCdxRows(cdxBody: string): CdxRow[] {
  const out: CdxRow[] = []
  try {
    const parsed = JSON.parse(cdxBody)
    if (!Array.isArray(parsed)) return out
    for (let i = 1; i < parsed.length; i += 1) {
      const row = parsed[i]
      if (!Array.isArray(row) || row.length < 2) continue
      const timestamp = String(row[0] || '')
      const original = String(row[1] || '')
      if (!timestamp || !original) continue
      out.push({ timestamp, original })
    }
  } catch {
    return out
  }
  return out
}

function dayCursor(date: string): string {
  return String(date || '').replace(/-/g, '')
}

function parseJsonSafe(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function toDetailRecord(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null
  if (isRecord(payload.data)) return payload.data as Record<string, unknown>
  return payload as Record<string, unknown>
}

async function fetchWaybackCdxDay(
  fetchImpl: typeof fetch,
  url: string,
  collectionDate: string,
  limit = 8,
): Promise<{ cdxUrl: string; cdxBody: string; rows: CdxRow[]; status: number }> {
  const day = dayCursor(collectionDate)
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
    url,
  )}&from=${day}&to=${day}&output=json&fl=timestamp,original,statuscode,mimetype,digest&filter=statuscode:200&collapse=digest&limit=${Math.max(1, Math.floor(limit))}`
  const response = await fetchImpl(cdxUrl)
  const cdxBody = await response.text()
  return {
    cdxUrl,
    cdxBody,
    rows: parseCdxRows(cdxBody),
    status: response.status,
  }
}

async function fetchWaybackSnapshot(
  fetchImpl: typeof fetch,
  timestamp: string,
  original: string,
): Promise<{ snapshotUrl: string; status: number; body: string }> {
  const snapshotUrl = `https://web.archive.org/web/${timestamp}id_/${original}`
  const response = await fetchImpl(snapshotUrl)
  const body = await response.text()
  return { snapshotUrl, status: response.status, body }
}

export async function collectHistoricalDayFromWayback(input: {
  lender: LenderConfig
  collectionDate: string
  endpointCandidates?: string[]
  productCap?: number
  maxSeedUrls?: number
  fetchImpl?: typeof fetch
}): Promise<HistoricalCollectResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const lender = input.lender
  const collectionDate = input.collectionDate
  const productCap = Math.max(10, Math.min(250, Number(input.productCap ?? 80)))
  const maxSeedUrls = Math.max(1, Math.min(8, Number(input.maxSeedUrls ?? 2)))
  const seedUrls = lender.seed_rate_urls.slice(0, maxSeedUrls)
  const endpointCandidates = Array.from(new Set((input.endpointCandidates ?? []).filter(Boolean))).slice(0, 2)

  const payloads: HistoricalCollectPayload[] = []
  const mortgageRows: NormalizedRateRow[] = []
  const savingsRows: NormalizedSavingsRow[] = []
  const tdRows: NormalizedTdRow[] = []
  let hadSignals = false
  const counters: HistoricalCollectCounters = {
    cdx_requests: 0,
    snapshot_requests: 0,
    mortgage_rows: 0,
    savings_rows: 0,
    td_rows: 0,
  }

  for (const seedUrl of seedUrls) {
    const cdx = await fetchWaybackCdxDay(fetchImpl, seedUrl, collectionDate, 6)
    counters.cdx_requests += 1
    payloads.push({
      sourceUrl: cdx.cdxUrl,
      status: cdx.status,
      payload: cdx.cdxBody,
      notes: `wayback_cdx_day lender=${lender.code} date=${collectionDate}`,
    })
    if (cdx.rows.length > 0) hadSignals = true

    for (const row of cdx.rows.slice(0, 3)) {
      const snapshot = await fetchWaybackSnapshot(fetchImpl, row.timestamp, row.original)
      counters.snapshot_requests += 1
      payloads.push({
        sourceUrl: snapshot.snapshotUrl,
        status: snapshot.status,
        payload: snapshot.body,
        notes: `wayback_day_snapshot lender=${lender.code} date=${collectionDate}`,
      })
      const parsed = extractLenderRatesFromHtml({
        lender,
        html: snapshot.body,
        sourceUrl: snapshot.snapshotUrl,
        collectionDate,
        mode: 'historical',
        qualityFlag: 'parsed_from_wayback_strict',
      })
      if (parsed.inspected > 0 || parsed.rows.length > 0) hadSignals = true
      for (const item of parsed.rows) {
        item.retrievalType = 'historical_scrape'
        mortgageRows.push(item)
      }
    }
  }

  for (const endpointUrl of endpointCandidates) {
    const productsDay = await fetchWaybackCdxDay(fetchImpl, endpointUrl, collectionDate, 4)
    counters.cdx_requests += 1
    payloads.push({
      sourceUrl: productsDay.cdxUrl,
      status: productsDay.status,
      payload: productsDay.cdxBody,
      notes: `wayback_cdr_products_cdx lender=${lender.code} date=${collectionDate}`,
    })
    if (productsDay.rows.length === 0) continue
    hadSignals = true

    const productIdsSavings = new Set<string>()
    const productIdsTd = new Set<string>()

    for (const row of productsDay.rows.slice(0, 2)) {
      const snapshot = await fetchWaybackSnapshot(fetchImpl, row.timestamp, row.original)
      counters.snapshot_requests += 1
      payloads.push({
        sourceUrl: snapshot.snapshotUrl,
        status: snapshot.status,
        payload: snapshot.body,
        notes: `wayback_cdr_products_snapshot lender=${lender.code} date=${collectionDate}`,
      })
      const payload = parseJsonSafe(snapshot.body)
      const products = extractProducts(payload)
      for (const product of products) {
        const productId = String(product.productId || product.id || '').trim()
        if (!productId) continue
        if (isSavingsAccount(product as JsonRecord)) productIdsSavings.add(productId)
        if (isTermDeposit(product as JsonRecord)) productIdsTd.add(productId)
      }

      for (const productId of Array.from(productIdsSavings).slice(0, productCap)) {
        const detailUrl = `${endpointUrl.replace(/\/+$/, '')}/${encodeURIComponent(productId)}`
        const detailSnapshot = await fetchWaybackSnapshot(fetchImpl, row.timestamp, detailUrl)
        counters.snapshot_requests += 1
        payloads.push({
          sourceUrl: detailSnapshot.snapshotUrl,
          status: detailSnapshot.status,
          payload: detailSnapshot.body,
          notes: `wayback_cdr_savings_detail lender=${lender.code} product=${productId}`,
        })
        const parsedDetail = toDetailRecord(parseJsonSafe(detailSnapshot.body))
        if (!parsedDetail) continue
        const parsedRows = parseSavingsRatesFromDetail({
          lender,
          detail: parsedDetail,
          sourceUrl: detailSnapshot.snapshotUrl,
          collectionDate,
        })
        if (parsedRows.length > 0) hadSignals = true
        for (const parsedRow of parsedRows) {
          parsedRow.dataQualityFlag = 'parsed_from_wayback_cdr'
          parsedRow.retrievalType = 'historical_scrape'
          savingsRows.push(parsedRow)
        }
      }

      for (const productId of Array.from(productIdsTd).slice(0, productCap)) {
        const detailUrl = `${endpointUrl.replace(/\/+$/, '')}/${encodeURIComponent(productId)}`
        const detailSnapshot = await fetchWaybackSnapshot(fetchImpl, row.timestamp, detailUrl)
        counters.snapshot_requests += 1
        payloads.push({
          sourceUrl: detailSnapshot.snapshotUrl,
          status: detailSnapshot.status,
          payload: detailSnapshot.body,
          notes: `wayback_cdr_td_detail lender=${lender.code} product=${productId}`,
        })
        const parsedDetail = toDetailRecord(parseJsonSafe(detailSnapshot.body))
        if (!parsedDetail) continue
        const parsedRows = parseTermDepositRatesFromDetail({
          lender,
          detail: parsedDetail,
          sourceUrl: detailSnapshot.snapshotUrl,
          collectionDate,
        })
        if (parsedRows.length > 0) hadSignals = true
        for (const parsedRow of parsedRows) {
          parsedRow.dataQualityFlag = 'parsed_from_wayback_cdr'
          parsedRow.retrievalType = 'historical_scrape'
          tdRows.push(parsedRow)
        }
      }
    }

    if (savingsRows.length > 0 || tdRows.length > 0) {
      break
    }
  }

  counters.mortgage_rows = mortgageRows.length
  counters.savings_rows = savingsRows.length
  counters.td_rows = tdRows.length

  return {
    mortgageRows,
    savingsRows,
    tdRows,
    hadSignals,
    payloads,
    counters,
  }
}
