import type { IngestMessage } from '../../types'

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function isIngestMessage(value: unknown): value is IngestMessage {
  if (!isObject(value) || typeof value.kind !== 'string') {
    return false
  }

  if (value.kind === 'daily_lender_fetch') {
    return typeof value.runId === 'string' && typeof value.lenderCode === 'string' && typeof value.collectionDate === 'string'
  }

  if (value.kind === 'product_detail_fetch') {
    return (
      typeof value.runId === 'string' &&
      typeof value.lenderCode === 'string' &&
      typeof value.dataset === 'string' &&
      typeof value.productId === 'string' &&
      typeof value.collectionDate === 'string'
    )
  }

  if (value.kind === 'lender_finalize') {
    return (
      typeof value.runId === 'string' &&
      typeof value.lenderCode === 'string' &&
      typeof value.dataset === 'string' &&
      typeof value.collectionDate === 'string'
    )
  }

  if (value.kind === 'backfill_snapshot_fetch') {
    return (
      typeof value.runId === 'string' &&
      typeof value.lenderCode === 'string' &&
      typeof value.seedUrl === 'string' &&
      typeof value.monthCursor === 'string'
    )
  }

  if (value.kind === 'backfill_day_fetch') {
    return (
      typeof value.runId === 'string' &&
      typeof value.lenderCode === 'string' &&
      typeof value.collectionDate === 'string'
    )
  }

  if (value.kind === 'daily_savings_lender_fetch') {
    return typeof value.runId === 'string' && typeof value.lenderCode === 'string' && typeof value.collectionDate === 'string'
  }

  if (value.kind === 'historical_task_execute') {
    return typeof value.runId === 'string' && Number.isFinite(Number(value.taskId))
  }

  return false
}

export function extractRunContext(body: unknown): { runId: string | null; lenderCode: string | null } {
  if (!isObject(body)) {
    return { runId: null, lenderCode: null }
  }

  const runId = typeof body.runId === 'string' ? body.runId : null
  const lenderCode = typeof body.lenderCode === 'string' ? body.lenderCode : null
  return { runId, lenderCode }
}
