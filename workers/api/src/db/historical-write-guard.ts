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

  if (requiresFetchEventLineage(row) && row.fetchEventId == null) {
    throw new HistoricalWriteContractError(dataset, 'missing_fetch_event_lineage', lenderCode)
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
