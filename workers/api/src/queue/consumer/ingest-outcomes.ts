export type IngestOutcome =
  | 'ok'
  | 'no_rows_currently_available'
  | 'upstream_blocked'
  | 'transient_fetch'
  | 'parser_rejected'
  | 'fatal'

export type IngestOutcomePolicy = {
  retry: 'no' | 'yes' | 'bounded_transient_only'
  markProgress: 'yes' | 'terminal_retry_only'
  preservePreviousLatest: boolean
  fatal: boolean
  actionable: 'no' | 'policy' | 'yes'
}

export const INGEST_OUTCOME_POLICY: Record<IngestOutcome, IngestOutcomePolicy> = {
  ok: {
    retry: 'no',
    markProgress: 'yes',
    preservePreviousLatest: false,
    fatal: false,
    actionable: 'no',
  },
  no_rows_currently_available: {
    retry: 'no',
    markProgress: 'yes',
    preservePreviousLatest: true,
    fatal: false,
    actionable: 'no',
  },
  upstream_blocked: {
    retry: 'bounded_transient_only',
    markProgress: 'yes',
    preservePreviousLatest: true,
    fatal: false,
    actionable: 'policy',
  },
  transient_fetch: {
    retry: 'yes',
    markProgress: 'terminal_retry_only',
    preservePreviousLatest: true,
    fatal: false,
    actionable: 'no',
  },
  parser_rejected: {
    retry: 'no',
    markProgress: 'yes',
    preservePreviousLatest: true,
    fatal: false,
    actionable: 'policy',
  },
  fatal: {
    retry: 'no',
    markProgress: 'yes',
    preservePreviousLatest: true,
    fatal: true,
    actionable: 'yes',
  },
}

function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500
}

export function classifyDetailFetchOutcome(input: {
  ok: boolean
  status: number
  upstreamBlocked: boolean
}): IngestOutcome {
  if (input.ok) return 'ok'
  if (input.upstreamBlocked) return 'upstream_blocked'
  if (isTransientStatus(input.status)) return 'transient_fetch'
  return 'fatal'
}

export function classifyValidatedRowsOutcome(input: {
  fetchedRows: number
  acceptedRows: number
  droppedRows: number
}): IngestOutcome {
  if (input.acceptedRows > 0) return 'ok'
  if (input.droppedRows > 0) return 'parser_rejected'
  return 'no_rows_currently_available'
}

export function isNonRetryableDetailFetchStatus(status: number): boolean {
  const outcome = classifyDetailFetchOutcome({
    ok: false,
    status,
    upstreamBlocked: false,
  })
  return isNonRetryableIngestOutcome(outcome)
}

export function isKnownIngestOutcome(value: string): value is IngestOutcome {
  return Object.prototype.hasOwnProperty.call(INGEST_OUTCOME_POLICY, value)
}

export function isNonRetryableIngestOutcome(outcome: IngestOutcome): boolean {
  return INGEST_OUTCOME_POLICY[outcome].retry === 'no'
}
