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

function isHistoricalNoSignalNoise(entry: Record<string, unknown>, source: string, message: string): boolean {
  if (source !== 'consumer') return false
  const context = normalizeValue(entry.context)
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
  const ctxLower = String(entry.context ?? '').toLowerCase()
  if (source === 'pipeline' && message === 'cpi_collection_unavailable' && ctxLower.includes('403')) {
    return true
  }
  // Pre-2026-03-26 stall detector fired on "scanned but none finalized" even when no row was ready to finalize.
  // Current scheduler logs include ready_candidate_rows; keep those actionable.
  const ctx = String(entry.context ?? '')
  if (
    source === 'scheduler' &&
    message === 'run lifecycle reconciliation stalled' &&
    !ctx.includes('ready_candidate_rows')
  ) {
    return true
  }
  if (isHistoricalNoSignalNoise(entry, source, message)) {
    return true
  }
  if (source === 'chart_cache_refresh' && message.startsWith(CHART_CACHE_REFRESH_NOISE_PREFIX)) {
    return true
  }
  return lenderCode === 'ubank' && source === 'consumer' && KNOWN_UBANK_NOISE_MESSAGES.has(message)
}
