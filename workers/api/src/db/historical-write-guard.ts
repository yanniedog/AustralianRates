import type { DatasetKind } from '../../../../packages/shared/src'
import { TARGET_LENDERS } from '../constants.js'
import { getLenderPlaybook } from '../ingest/lender-playbooks.js'
import {
  minConfidenceForFlag as minHomeLoanConfidenceForFlag,
  type NormalizedRateRow,
} from '../ingest/normalize.js'
import {
  minConfidenceForFlag as minDepositConfidenceForFlag,
  type NormalizedSavingsRow,
  type NormalizedTdRow,
} from '../ingest/normalize-savings.js'
import type { RetrievalType, RunSource } from '../types.js'
import { recordIngestAnomaly } from './ingest-anomalies.js'

type HistoricalWritableRow = NormalizedRateRow | NormalizedSavingsRow | NormalizedTdRow
type LenderIdentity = (typeof TARGET_LENDERS)[number]
type JsonRecord = Record<string, unknown>

function normalizeKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function resolveLenderCode(bankName: string): string | null {
  const target = normalizeKey(bankName)
  if (!target) return null
  for (const lender of TARGET_LENDERS) {
    const aliases = [
      lender.code,
      lender.name,
      lender.canonical_bank_name,
      lender.register_brand_name,
    ]
    if (aliases.some((alias) => normalizeKey(alias) === target)) {
      return lender.code
    }
  }
  return null
}

function lenderIdentityByCode(code: string): LenderIdentity | null {
  return TARGET_LENDERS.find((lender) => lender.code === code) ?? null
}

function hostnameFromUrl(value: string | null | undefined): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  try {
    return new URL(text).hostname.toLowerCase()
  } catch {
    return null
  }
}

function allowedLenderHosts(lender: LenderIdentity): Set<string> {
  const hosts = new Set<string>()
  const candidates = [lender.products_endpoint, ...(Array.isArray(lender.seed_rate_urls) ? lender.seed_rate_urls : [])]
  for (const candidate of candidates) {
    const host = hostnameFromUrl(candidate)
    if (host) hosts.add(host)
  }
  return hosts
}

function hostMatchesAllowed(host: string | null, allowedHosts: Set<string>): boolean {
  if (!host) return false
  for (const allowed of allowedHosts) {
    if (host === allowed || host.endsWith(`.${allowed}`) || allowed.endsWith(`.${host}`)) {
      return true
    }
  }
  return false
}

function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function unwrapCdrDetailPayload(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null
  if (isRecord(value.data)) return value.data
  return value
}

function pickText(record: JsonRecord | null, keys: string[]): string {
  if (!record) return ''
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function parseCdrDetailContract(json: string): { productId: string; productName: string } | null {
  try {
    const parsed = JSON.parse(json) as unknown
    const detail = unwrapCdrDetailPayload(parsed)
    if (!detail) return null
    const productId = pickText(detail, ['productId', 'id'])
    const productName = pickText(detail, ['name', 'productName'])
    if (!productId) return null
    return { productId, productName }
  } catch {
    return null
  }
}

function resolveRetrievalType(row: HistoricalWritableRow): RetrievalType {
  return row.retrievalType ?? 'present_scrape_same_date'
}

function resolveRunSource(row: HistoricalWritableRow): RunSource {
  return row.runSource ?? 'scheduled'
}

function requiresFetchEventLineage(row: HistoricalWritableRow): boolean {
  return !(resolveRunSource(row) === 'manual' && resolveRetrievalType(row) === 'historical_scrape')
}

function minimumDatasetConfidence(
  dataset: DatasetKind,
  row: HistoricalWritableRow,
  lenderCode: string,
): number {
  if (dataset === 'home_loans') {
    const typedRow = row as NormalizedRateRow
    const playbook = getLenderPlaybook({ code: lenderCode })
    const playbookThreshold =
      resolveRetrievalType(typedRow) === 'historical_scrape'
        ? playbook.historicalMinConfidence
        : playbook.dailyMinConfidence
    return Math.max(playbookThreshold, minHomeLoanConfidenceForFlag(typedRow.dataQualityFlag))
  }
  return minDepositConfidenceForFlag(row.dataQualityFlag)
}

export class HistoricalWriteContractError extends Error {
  readonly reason: string
  readonly dataset: DatasetKind
  readonly lenderCode: string | null

  constructor(dataset: DatasetKind, reason: string, lenderCode: string | null) {
    super(`write_contract_violation:${reason}`)
    this.name = 'HistoricalWriteContractError'
    this.reason = reason
    this.dataset = dataset
    this.lenderCode = lenderCode
  }
}

export function assertHistoricalWriteAllowed(
  dataset: DatasetKind,
  row: HistoricalWritableRow,
): { lenderCode: string } {
  const runId = String(row.runId || '').trim()
  if (!runId) {
    throw new HistoricalWriteContractError(dataset, 'missing_run_id', null)
  }

  const lenderCode = resolveLenderCode(row.bankName)
  if (!lenderCode) {
    throw new HistoricalWriteContractError(dataset, 'unknown_lender_identity', null)
  }
  const lenderIdentity = lenderIdentityByCode(lenderCode)
  if (!lenderIdentity) {
    throw new HistoricalWriteContractError(dataset, 'unknown_lender_identity', lenderCode)
  }

  if (requiresFetchEventLineage(row) && row.fetchEventId == null) {
    throw new HistoricalWriteContractError(dataset, 'missing_fetch_event_lineage', lenderCode)
  }

  const allowedHosts = allowedLenderHosts(lenderIdentity)
  if (!hostMatchesAllowed(hostnameFromUrl(row.sourceUrl), allowedHosts)) {
    throw new HistoricalWriteContractError(dataset, 'source_url_host_mismatch', lenderCode)
  }
  if (row.productUrl != null && row.productUrl !== '' && !hostMatchesAllowed(hostnameFromUrl(row.productUrl), allowedHosts)) {
    throw new HistoricalWriteContractError(dataset, 'product_url_host_mismatch', lenderCode)
  }

  if (row.cdrProductDetailJson != null && row.cdrProductDetailJson.trim() !== '') {
    const detailContract = parseCdrDetailContract(row.cdrProductDetailJson)
    if (!detailContract) {
      throw new HistoricalWriteContractError(dataset, 'invalid_cdr_product_detail_payload', lenderCode)
    }
    if (detailContract.productId !== row.productId) {
      throw new HistoricalWriteContractError(dataset, 'cdr_detail_product_id_mismatch', lenderCode)
    }
  }

  const requiredConfidence = minimumDatasetConfidence(dataset, row, lenderCode)
  if (row.confidenceScore < requiredConfidence) {
    throw new HistoricalWriteContractError(dataset, 'confidence_below_write_contract', lenderCode)
  }

  if (dataset === 'home_loans') {
    const typedRow = row as NormalizedRateRow
    const playbook = getLenderPlaybook({ code: lenderCode })
    if (typedRow.interestRate < playbook.minRatePercent || typedRow.interestRate > playbook.maxRatePercent) {
      throw new HistoricalWriteContractError(dataset, 'interest_rate_outside_lender_playbook', lenderCode)
    }
  }

  return { lenderCode }
}

export function isHistoricalWriteContractError(error: unknown): error is HistoricalWriteContractError {
  return error instanceof HistoricalWriteContractError
}

export async function recordHistoricalWriteContractViolation(
  db: D1Database,
  input: {
    dataset: DatasetKind
    row: HistoricalWritableRow
    lenderCode: string | null
    reason: string
    seriesKey: string | null
  },
): Promise<void> {
  await recordIngestAnomaly(db, {
    fetchEventId: input.row.fetchEventId ?? null,
    runId: input.row.runId ?? null,
    lenderCode: input.lenderCode,
    dataset: input.dataset,
    productId: input.row.productId,
    seriesKey: input.seriesKey,
    collectionDate: input.row.collectionDate,
    reason: `write_contract_violation:${input.reason}`,
    severity: 'error',
    candidateJson: JSON.stringify(input.row),
    normalizedCandidateJson: JSON.stringify(input.row),
  })
}
