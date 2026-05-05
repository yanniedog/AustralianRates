import { describe, expect, it } from 'vitest'
import {
  classifyDetailFetchOutcome,
  classifyValidatedRowsOutcome,
  INGEST_OUTCOME_POLICY,
  isNonRetryableDetailFetchStatus,
} from '../src/queue/consumer/ingest-outcomes'
import { isNonRetryableErrorMessage } from '../src/queue/consumer/retry-config'

describe('ingest outcome policy', () => {
  it('pins progress and retry behavior for every outcome', () => {
    expect(INGEST_OUTCOME_POLICY.ok).toEqual({
      retry: 'no',
      markProgress: 'yes',
      preservePreviousLatest: false,
      fatal: false,
      actionable: 'no',
    })
    expect(INGEST_OUTCOME_POLICY.no_rows_currently_available).toMatchObject({
      retry: 'no',
      markProgress: 'yes',
      preservePreviousLatest: true,
      fatal: false,
      actionable: 'no',
    })
    expect(INGEST_OUTCOME_POLICY.upstream_blocked).toMatchObject({
      retry: 'bounded_transient_only',
      markProgress: 'yes',
      preservePreviousLatest: true,
      fatal: false,
      actionable: 'policy',
    })
    expect(INGEST_OUTCOME_POLICY.transient_fetch).toMatchObject({
      retry: 'yes',
      markProgress: 'terminal_retry_only',
      preservePreviousLatest: true,
      fatal: false,
      actionable: 'no',
    })
    expect(INGEST_OUTCOME_POLICY.parser_rejected).toMatchObject({
      retry: 'no',
      markProgress: 'yes',
      preservePreviousLatest: true,
      fatal: false,
      actionable: 'policy',
    })
    expect(INGEST_OUTCOME_POLICY.fatal).toMatchObject({
      retry: 'no',
      markProgress: 'yes',
      preservePreviousLatest: true,
      fatal: true,
      actionable: 'yes',
    })
  })

  it('classifies detail fetch outcomes by status and upstream block state', () => {
    expect(classifyDetailFetchOutcome({ ok: true, status: 200, upstreamBlocked: false })).toBe('ok')
    expect(classifyDetailFetchOutcome({ ok: false, status: 429, upstreamBlocked: false })).toBe('transient_fetch')
    expect(classifyDetailFetchOutcome({ ok: false, status: 503, upstreamBlocked: false })).toBe('transient_fetch')
    expect(classifyDetailFetchOutcome({ ok: false, status: 403, upstreamBlocked: true })).toBe('upstream_blocked')
    expect(classifyDetailFetchOutcome({ ok: false, status: 400, upstreamBlocked: false })).toBe('fatal')
  })

  it('classifies validated row outcomes without relying on business fixtures', () => {
    expect(classifyValidatedRowsOutcome({ fetchedRows: 2, acceptedRows: 1, droppedRows: 1 })).toBe('ok')
    expect(classifyValidatedRowsOutcome({ fetchedRows: 2, acceptedRows: 0, droppedRows: 2 })).toBe('parser_rejected')
    expect(classifyValidatedRowsOutcome({ fetchedRows: 0, acceptedRows: 0, droppedRows: 0 })).toBe('no_rows_currently_available')
  })

  it('keeps transient detail fetches retryable and terminal status failures non-retryable', () => {
    expect(isNonRetryableDetailFetchStatus(400)).toBe(true)
    expect(isNonRetryableDetailFetchStatus(406)).toBe(true)
    expect(isNonRetryableDetailFetchStatus(403)).toBe(true)
    expect(isNonRetryableDetailFetchStatus(429)).toBe(false)
    expect(isNonRetryableDetailFetchStatus(503)).toBe(false)
    expect(isNonRetryableErrorMessage('detail_fetch_failed:term_deposits:TD:status=400:outcome=fatal')).toBe(true)
    expect(isNonRetryableErrorMessage('detail_fetch_failed:term_deposits:TD:status=429:outcome=transient_fetch')).toBe(false)
    expect(isNonRetryableErrorMessage('detail_fetch_failed:home_loans:HL:status=403:outcome=upstream_blocked')).toBe(false)
  })
})
