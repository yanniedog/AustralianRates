import type { IngestPauseMode } from '../types'

const KNOWN_UBANK_NOISE_MESSAGES = new Set([
  'daily_lender_fetch upstream_block_detected',
  'daily_savings_lender_fetch upstream_block_detected',
  'daily_savings_lender_fetch empty_result',
])
const KNOWN_ADMIN_STATUS_DUPLICATE_MESSAGES = new Set(['cdr_audit_detected_gaps'])
const KNOWN_ADMIN_STATUS_DUPLICATE_CODES = new Set(['cdr_audit_detected_gaps'])
const CHART_CACHE_REFRESH_NOISE_PREFIX = 'failed to refresh'

function normalizeValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

/** Serialize log context for substring checks (D1 may return TEXT as string or parsed JSON). */
function contextToSearchString(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

function isHistoricalNoSignalNoise(entry: Record<string, unknown>, source: string, message: string): boolean {
  if (source !== 'consumer') return false
  const context = contextToSearchString(entry.context).toLowerCase()
  if (message === 'historical_task_execute completed') {
    return context.includes('completion=warn_no_writes') && context.includes('signals(wayback=0,final=0)')
  }
  if (message === 'historical_task_execute empty_result') {
    return context.includes('had_wayback_signals=0') || context.includes('signals(wayback=0,final=0)')
  }
  return false
}

export function shouldIgnoreStatusActionableLog(
  entry: Record<string, unknown>,
  pauseMode: IngestPauseMode,
): boolean {
  const source = normalizeValue(entry.source)
  const message = normalizeValue(entry.message)

  if (pauseMode !== 'repair_pause' && normalizeValue(entry.code) === 'ingest_paused') {
    return true
  }

  const lenderCode = normalizeValue(entry.lender_code ?? entry.lenderCode)
  const runId = normalizeValue(entry.run_id ?? entry.runId)
  const code = normalizeValue(entry.code)
  if (source === 'admin' && (KNOWN_ADMIN_STATUS_DUPLICATE_MESSAGES.has(message) || KNOWN_ADMIN_STATUS_DUPLICATE_CODES.has(code))) {
    return true
  }
  // Expected when the admin UI probes /auth-check without a valid session or token (expired tab, scanners).
  if (source === 'admin' && (message === 'auth_check_failed' || code === 'admin_auth_check_failed')) {
    return true
  }
  // Successful RBA path: fresh fetch failed but a stored snapshot exists (still returns ok from collector).
  if (source === 'pipeline' && message === 'rba_collection_used_stored_rate') {
    return true
  }
  // Legacy CPI warns when both RBA HTML and G1 returned 403 to non-browser fetches (pre–browser-like UA).
  const ctxLower = contextToSearchString(entry.context).toLowerCase()
  if (source === 'pipeline' && message === 'cpi_collection_unavailable' && ctxLower.includes('403')) {
    return true
  }
  // RBA G1 occasionally returns no parseable points despite upstream 200 responses.
  // This is tracked separately in economic health and should not page actionable.
  if (
    source === 'pipeline' &&
    message === 'cpi_collection_unavailable' &&
    ctxLower.includes('reason=no_parseable_points')
  ) {
    return true
  }
  if (
    source === 'pipeline' &&
    message === 'upstream_fetch' &&
    ctxLower.includes('source=rba_csv')
  ) {
    return true
  }
  // Economic RBA CSV/HTML fetches hit the same 403 bot wall without browser-like headers.
  // Each failed series emits markSeriesFailure ("collection failed") then a second warn ("parsing failed");
  // both must be ignored when the underlying error is upstream 403.
  const ctxStr = contextToSearchString(entry.context)
  if (
    source === 'economic' &&
    ctxStr.includes('upstream_not_ok:403') &&
    (code === 'economic_series_parse_failed' ||
      code === 'economic_series_fetch_failed' ||
      message === 'economic series parsing failed' ||
      message === 'economic series collection failed')
  ) {
    return true
  }
  // Economic proxy sources can intermittently return 422/429 from edge mirrors.
  // These are upstream transport failures, not local regressions.
  if (
    source === 'economic' &&
    (ctxStr.includes('upstream_not_ok:422') || ctxStr.includes('upstream_not_ok:429')) &&
    (code === 'economic_series_parse_failed' ||
      code === 'economic_series_fetch_failed' ||
      message === 'economic series parsing failed' ||
      message === 'economic series collection failed')
  ) {
    return true
  }
  // FRED graph CSV occasionally returns 520 from the CDN edge (same class of transient upstream noise as 403).
  if (
    source === 'economic' &&
    ctxStr.includes('fred.stlouisfed.org') &&
    ctxStr.includes('upstream_not_ok:520') &&
    (code === 'economic_series_parse_failed' ||
      code === 'economic_series_fetch_failed' ||
      message === 'economic series parsing failed' ||
      message === 'economic series collection failed')
  ) {
    return true
  }
  // RBNZ decisions page layout vs line-based OCR parser drift: empty parse while HTTP path succeeded.
  if (
    source === 'economic' &&
    ctxStr.includes('No parseable observations for rbnz_ocr') &&
    (code === 'economic_series_parse_failed' ||
      code === 'economic_series_fetch_failed' ||
      message === 'economic series parsing failed' ||
      message === 'economic series collection failed')
  ) {
    return true
  }
  // lender_dataset_runs is WITHOUT ROWID (migration 0022). Reconciliation briefly selected/updated rowid,
  // which D1 rejects; fixed 2026-03-29. Stale global_log rows would otherwise keep actionable red indefinitely.
  if (
    source === 'scheduler' &&
    code === 'run_lifecycle_reconciliation_failed' &&
    ctxLower.includes('no such column: rowid')
  ) {
    return true
  }
  // Pre-2026-03-26 stall detector fired on "scanned but none finalized" even when no row was ready to finalize.
  // Current scheduler logs include ready_candidate_rows; keep those actionable.
  const ctx = contextToSearchString(entry.context)
  if (
    source === 'scheduler' &&
    message === 'run lifecycle reconciliation stalled' &&
    !ctx.includes('ready_candidate_rows')
  ) {
    return true
  }
  // Product-detail rows from CDR could carry a long correlation id in runId; validation ran before the
  // queue job overwrote runId with the canonical short id (fixed 2026-03-27). Historical rows only.
  if (
    source === 'db' &&
    code === 'upsert_failed' &&
    ctxLower.includes('invalid_normalized_rate_row:invalid_run_id')
  ) {
    return true
  }
  // Temporary D1 overload spikes can emit one-off failed queue/upsert logs that self-heal on retry.
  if (
    (source === 'consumer' || source === 'db' || source === 'api') &&
    ctxLower.includes('d1 db is overloaded. requests queued for too long.') &&
    (code === 'queue_message_failed' ||
      code === 'historical_task_execute_failed' ||
      message === 'unhandled internal error' ||
      message.includes('queue_message_failed') ||
      message.includes('historical_task_execute failed') ||
      message.includes('td_upsert_failed'))
  ) {
    return true
  }
  if (source === 'consumer' && message === 'queue_message_retry_scheduled') {
    return true
  }
  if (
    source === 'api' &&
    message === 'unhandled internal error' &&
    ctxLower.includes('"/api/home-loan-rates/admin/') &&
    (ctxLower.includes('/diagnostics/') || ctxLower.includes('/runs/repair-lineage'))
  ) {
    return true
  }
  if (
    source === 'consumer' &&
    (code === 'queue_message_failed' || code === 'queue_message_exhausted' || message === 'replay_queue_scheduled') &&
    runId.startsWith('historical:admin:') &&
    ctxLower.includes('kind=historical_task_execute')
  ) {
    return true
  }
  // Staleness is reported in economic health summaries and should not fail actionable checks.
  if (source === 'economic' && (code === 'economic_series_stale' || message === 'economic series is stale')) {
    return true
  }
  if (isHistoricalNoSignalNoise(entry, source, message)) {
    return true
  }
  if (source === 'chart_cache_refresh' && message.startsWith(CHART_CACHE_REFRESH_NOISE_PREFIX)) {
    return true
  }
  // Economic dashboard falls back to linear scale when rebased series include zero or negative values.
  // This is an intentional UX safeguard, not an operational incident.
  if (
    source === 'client' &&
    message === 'economic chart: log y-axis disabled (non-positive index values); using linear'
  ) {
    return true
  }
  if (
    source === 'client' &&
    (code === 'client_error' || message === 'economic page unhandled error' || message === 'economic page unhandled rejection') &&
    (ctxLower.includes('chrome-extension://') ||
      ctxLower.includes('moz-extension://') ||
      ctxLower.includes('safari-extension://'))
  ) {
    return true
  }
  if (
    source === 'consumer' &&
    KNOWN_UBANK_NOISE_MESSAGES.has(message) &&
    (lenderCode === 'ubank' || lenderCode.length === 0 || message === 'daily_savings_lender_fetch empty_result')
  ) {
    return true
  }
  return false
}
