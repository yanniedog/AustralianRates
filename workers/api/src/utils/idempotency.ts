import type { DatasetKind } from '../../../../packages/shared/src'
import { VALIDATE_COMMON } from '../ingest/validate-common'

function normalizeKeyPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

export function buildDailyRunId(collectionDate: string): string {
  return `daily:${collectionDate}`
}

/** Unique run id for interval-based scheduled runs (one per invocation). */
export function buildScheduledRunId(collectionDate: string, scheduledTime?: number): string {
  const scheduledIso = Number.isFinite(scheduledTime)
    ? new Date(Number(scheduledTime)).toISOString()
    : new Date().toISOString()
  return `daily:${collectionDate}:${scheduledIso}`
}

/**
 * Short unique run id for coverage-gap forced daily reconciles.
 * (Legacy pattern `daily:…:coverage-gap-remediate:<uuid>` exceeded MAX_RUN_ID_LENGTH and caused every CDR row to fail validation.)
 */
export function buildCoverageGapRemediationRunId(collectionDate: string): string {
  const hex = crypto.randomUUID().replace(/-/g, '')
  const prefix = `daily:${collectionDate}:cgr:`
  const maxLen = VALIDATE_COMMON.MAX_RUN_ID_LENGTH
  const suffixLen = Math.max(0, maxLen - prefix.length)
  return `${prefix}${hex.slice(0, suffixLen)}`
}

export function buildBackfillRunId(monthCursor: string): string {
  return `backfill:${monthCursor}:${crypto.randomUUID()}`
}

export function buildRunLockKey(runType: 'daily' | 'backfill', dateOrMonth: string): string {
  return `${runType}:${dateOrMonth}`
}

export function buildDailyLenderIdempotencyKey(runId: string, lenderCode: string): string {
  return `daily:${normalizeKeyPart(runId)}:${normalizeKeyPart(lenderCode)}`
}

export function buildProductDetailIdempotencyKey(
  runId: string,
  lenderCode: string,
  dataset: DatasetKind,
  productId: string,
): string {
  return `product:${normalizeKeyPart(runId)}:${normalizeKeyPart(lenderCode)}:${normalizeKeyPart(dataset)}:${normalizeKeyPart(productId)}`
}

export function buildLenderFinalizeIdempotencyKey(runId: string, lenderCode: string, dataset: DatasetKind): string {
  return `finalize:${normalizeKeyPart(runId)}:${normalizeKeyPart(lenderCode)}:${normalizeKeyPart(dataset)}`
}

export function buildBackfillIdempotencyKey(runId: string, lenderCode: string, seedUrl: string, monthCursor: string): string {
  return [
    'backfill',
    normalizeKeyPart(runId),
    normalizeKeyPart(lenderCode),
    normalizeKeyPart(seedUrl),
    normalizeKeyPart(monthCursor),
  ].join(':')
}

export function buildBackfillDayIdempotencyKey(runId: string, lenderCode: string, collectionDate: string): string {
  return [
    'backfill-day',
    normalizeKeyPart(runId),
    normalizeKeyPart(lenderCode),
    normalizeKeyPart(collectionDate),
  ].join(':')
}

export function buildHistoricalTaskIdempotencyKey(runId: string, taskId: number): string {
  return ['historical-task', normalizeKeyPart(runId), String(Math.max(0, Math.floor(taskId)))].join(':')
}

function extensionForSource(sourceType: string): string {
  return sourceType === 'wayback_html' ? 'html' : 'json'
}

export function buildRawR2Key(sourceType: string, fetchedAtIso: string, contentHash: string): string {
  const [datePart] = fetchedAtIso.split('T')
  const [year, month = '00', day = '00'] = (datePart || '1970-01-01').split('-')
  const ext = extensionForSource(sourceType)
  return `raw/${sourceType}/${year}/${month}/${day}/${contentHash}.${ext}`
}
